import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DevZeroRuntime } from '../src/runtime.js';
import { DurableCommandJournal } from '../src/command-journal.js';

function run(binary, args, cwd) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return (result.stdout || '').trim();
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-zero-test-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  run('git', ['init'], repo);
  run('git', ['config', 'user.email', 'test@example.com'], repo);
  run('git', ['config', 'user.name', 'Dev Zero Test'], repo);
  fs.writeFileSync(path.join(repo, 'README.md'), 'baseline\n');
  run('git', ['add', '.'], repo);
  run('git', ['commit', '-m', 'baseline'], repo);
  return { root, repo };
}

test('logical worker identity survives provider replacement and task recovery', () => {
  const f = fixture();
  try {
    const runtime = new DevZeroRuntime({ home: path.join(f.root, 'home') });
    const repo = runtime.attachRepository(f.repo);
    const worker = runtime.createWorker({ name: 'builder' });
    const qwen = runtime.bindProviderSession(worker.id, { provider: 'qwen', model: 'qwen-test' });
    const codex = runtime.bindProviderSession(worker.id, { provider: 'codex', model: 'codex-test' });
    assert.equal(qwen.worker_id, worker.id);
    assert.equal(codex.worker_id, worker.id);
    assert.notEqual(qwen.id, codex.id);
    const task = runtime.createTask({ repositoryId: repo.id, workerId: worker.id, providerSessionId: codex.id, objective: 'modify safely' });
    assert.ok(fs.existsSync(task.worktree_path));
    runtime.db.prepare("update tasks set status='running' where id=?").run(task.id);
    runtime.close();
    const recovered = new DevZeroRuntime({ home: path.join(f.root, 'home') });
    assert.equal(recovered.getTask(task.id).status, 'recovered');
    recovered.close();
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('governed mutation either executes in isolation or fails closed and restores state', async () => {
  const f = fixture();
  try {
    const runtime = new DevZeroRuntime({ home: path.join(f.root, 'home') });
    const repo = runtime.attachRepository(f.repo);
    const worker = runtime.createWorker({ name: 'builder' });
    const task = runtime.createTask({ repositoryId: repo.id, workerId: worker.id, objective: 'write isolated file' });
    const result = await runtime.executeCommand(task.id, {
      binary: '/usr/bin/touch', args: ['result.txt'], cwd: '.', filesystemScope: ['.'], network: 'deny', timeoutMs: 20_000,
      memoryMb: 128, cpuSeconds: 10, approvalTier: 'operator', mutating: true,
    }, { approved: true });
    assert.ok(result.evidence.some(item => item.kind === 'command-result'));
    assert.ok(result.evidence.some(item => item.kind === 'repository-diff'));
    if (result.success) {
      assert.equal(fs.existsSync(path.join(task.worktree_path, 'result.txt')), true);
      runtime.rollback(task.id);
    } else {
      assert.match(result.stderr || result.failure?.message || '', /(bwrap|permission|operation not permitted|namespace)/i);
    }
    assert.equal(fs.existsSync(path.join(task.worktree_path, 'result.txt')), false);
    runtime.close();
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('network access cannot be requested without an approval tier', () => {
  const f = fixture();
  try {
    const runtime = new DevZeroRuntime({ home: path.join(f.root, 'home') });
    const repo = runtime.attachRepository(f.repo);
    const worker = runtime.createWorker({ name: 'builder' });
    const task = runtime.createTask({ repositoryId: repo.id, workerId: worker.id, objective: 'policy test' });
    assert.throws(() => runtime.validateIntent(task, { binary: 'node', args: [], cwd: '.', filesystemScope: ['.'], network: 'allow', approvalTier: 'none' }), /requires explicit approval/);
    runtime.close();
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('identical dispatch is executed once and replayed from the durable journal', async () => {
  const f = fixture();
  try {
    const runtime = new DevZeroRuntime({ home: path.join(f.root, 'home') });
    const journal = new DurableCommandJournal(runtime);
    const repo = runtime.attachRepository(f.repo);
    const worker = runtime.createWorker({ name: 'builder' });
    const task = runtime.createTask({ repositoryId: repo.id, workerId: worker.id, objective: 'idempotent mutation' });
    const intent = { binary: '/usr/bin/touch', args: ['once.txt'], cwd: '.', filesystemScope: ['.'], network: 'deny', timeoutMs: 20_000, memoryMb: 128, cpuSeconds: 10, approvalTier: 'operator', mutating: true };
    const first = await journal.execute(task.id, intent, { approved: true, idempotencyKey: 'dispatch-test-0001' });
    const second = await journal.execute(task.id, intent, { approved: true, idempotencyKey: 'dispatch-test-0001' });
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.success, first.success);
    assert.equal(second.commandId, first.commandId);
    assert.equal(runtime.db.prepare('select count(*) n from commands where task_id=?').get(task.id).n, 1);
    runtime.close();
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('idempotency key cannot be reused for a different intent', async () => {
  const f = fixture();
  try {
    const runtime = new DevZeroRuntime({ home: path.join(f.root, 'home') });
    const journal = new DurableCommandJournal(runtime);
    const repo = runtime.attachRepository(f.repo);
    const worker = runtime.createWorker({ name: 'builder' });
    const task = runtime.createTask({ repositoryId: repo.id, workerId: worker.id, objective: 'reject collision' });
    const base = { binary: '/usr/bin/true', args: [], cwd: '.', filesystemScope: ['.'], network: 'deny', timeoutMs: 20_000, memoryMb: 128, cpuSeconds: 10, approvalTier: 'operator', mutating: false };
    await journal.execute(task.id, base, { approved: true, idempotencyKey: 'dispatch-test-0002' });
    await assert.rejects(() => journal.execute(task.id, { ...base, binary: '/usr/bin/false' }, { approved: true, idempotencyKey: 'dispatch-test-0002' }), /different command intent/);
    runtime.close();
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

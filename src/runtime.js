import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const now = () => new Date().toISOString();
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function runSync(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${binary} ${args.join(' ')} failed: ${result.stderr || result.stdout}`.trim());
  return (result.stdout || '').trim();
}

function commandExists(binary) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [binary], { encoding: 'utf8' });
  return probe.status === 0;
}

function ensureInside(root, target) {
  const base = fs.realpathSync(root);
  const resolved = fs.realpathSync(target);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error(`path escapes allowed root: ${target}`);
  return resolved;
}

function sanitizeEnv(extra = {}) {
  const denied = /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL/i;
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!denied.test(key) && value != null) env[key] = value;
  for (const [key, value] of Object.entries(extra)) {
    if (denied.test(key)) throw new Error(`secret-like environment variable denied: ${key}`);
    if (typeof value !== 'string') throw new Error(`environment value must be string: ${key}`);
    env[key] = value;
  }
  return env;
}

export class DevZeroRuntime {
  constructor({ home = process.env.DEV_ZERO_HOME || path.join(os.homedir(), '.dev-zero'), maxActiveTasks = Number(process.env.DEV_ZERO_MAX_ACTIVE || 4) } = {}) {
    this.home = path.resolve(home);
    this.maxActiveTasks = Math.max(1, maxActiveTasks);
    this.worktreeRoot = path.join(this.home, 'worktrees');
    fs.mkdirSync(this.worktreeRoot, { recursive: true, mode: 0o700 });
    this.db = new Database(path.join(this.home, 'state.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.active = new Map();
    this.migrate();
    this.recoverInterruptedTasks();
  }

  migrate() {
    this.db.exec(`
      create table if not exists schema_migrations(version integer primary key, name text not null, applied_at text not null);
      create table if not exists repositories(id text primary key, root_path text not null unique, head_sha text not null, created_at text not null, updated_at text not null);
      create table if not exists workers(id text primary key, name text not null, role text not null, status text not null, created_at text not null, updated_at text not null);
      create table if not exists provider_sessions(id text primary key, worker_id text not null, provider text not null, model text, external_session_id text, status text not null, started_at text not null, ended_at text, metadata_json text not null, foreign key(worker_id) references workers(id));
      create table if not exists tasks(id text primary key, repository_id text not null, worker_id text not null, provider_session_id text, objective text not null, status text not null, worktree_path text not null, branch_name text not null, checkpoint_sha text, created_at text not null, updated_at text not null, finished_at text, failure_json text, foreign key(repository_id) references repositories(id), foreign key(worker_id) references workers(id));
      create table if not exists commands(id text primary key, task_id text not null, intent_json text not null, status text not null, pid integer, started_at text, finished_at text, exit_code integer, stdout_digest text, stderr_digest text, failure_json text, foreign key(task_id) references tasks(id));
      create table if not exists evidence(id text primary key, task_id text not null, command_id text, kind text not null, digest text not null, payload_json text not null, created_at text not null, foreign key(task_id) references tasks(id));
      create index if not exists idx_tasks_status on tasks(status, created_at);
      create index if not exists idx_commands_task on commands(task_id, started_at);
      create index if not exists idx_evidence_task on evidence(task_id, created_at);
    `);
    const existing = this.db.prepare('select version from schema_migrations where version=1').get();
    if (!existing) this.db.prepare('insert into schema_migrations(version,name,applied_at) values(1,?,?)').run('initial_governed_runtime', now());
  }

  recoverInterruptedTasks() {
    const interrupted = this.db.prepare("select id from tasks where status='running'").all();
    const failure = JSON.stringify({ category: 'runtime', message: 'Runtime stopped while task was running.', retryable: true, replanRequired: false, rollbackRequired: false });
    const update = this.db.prepare("update tasks set status='recovered', failure_json=?, updated_at=? where id=?");
    for (const row of interrupted) update.run(failure, now(), row.id);
    this.db.prepare("update commands set status='interrupted', finished_at=? where status='running'").run(now());
  }

  attachRepository(rootPath) {
    const root = fs.realpathSync(rootPath);
    if (runSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']) !== 'true') throw new Error('repository path is not a Git work tree');
    const head = runSync('git', ['-C', root, 'rev-parse', 'HEAD']);
    const existing = this.db.prepare('select * from repositories where root_path=?').get(root);
    if (existing) {
      this.db.prepare('update repositories set head_sha=?, updated_at=? where id=?').run(head, now(), existing.id);
      return { ...existing, head_sha: head };
    }
    const row = { id: uid('repo'), root_path: root, head_sha: head, created_at: now(), updated_at: now() };
    this.db.prepare('insert into repositories(id,root_path,head_sha,created_at,updated_at) values(@id,@root_path,@head_sha,@created_at,@updated_at)').run(row);
    return row;
  }

  createWorker({ name, role = 'builder' }) {
    if (typeof name !== 'string' || name.trim().length < 1) throw new Error('worker name required');
    const row = { id: uid('worker'), name: name.trim(), role, status: 'active', created_at: now(), updated_at: now() };
    this.db.prepare('insert into workers(id,name,role,status,created_at,updated_at) values(@id,@name,@role,@status,@created_at,@updated_at)').run(row);
    return row;
  }

  bindProviderSession(workerId, { provider, model = null, externalSessionId = null, metadata = {} }) {
    const worker = this.db.prepare('select * from workers where id=?').get(workerId);
    if (!worker || worker.status !== 'active') throw new Error('active worker not found');
    if (!provider?.trim()) throw new Error('provider required');
    this.db.prepare("update provider_sessions set status='ended', ended_at=? where worker_id=? and status='active'").run(now(), workerId);
    const row = { id: uid('provider'), worker_id: workerId, provider: provider.trim(), model, external_session_id: externalSessionId, status: 'active', started_at: now(), metadata_json: JSON.stringify(metadata || {}) };
    this.db.prepare('insert into provider_sessions(id,worker_id,provider,model,external_session_id,status,started_at,metadata_json) values(@id,@worker_id,@provider,@model,@external_session_id,@status,@started_at,@metadata_json)').run(row);
    return { ...row, metadata };
  }

  createTask({ repositoryId, workerId, objective, providerSessionId = null }) {
    if (this.db.prepare("select count(*) n from tasks where status='running'").get().n >= this.maxActiveTasks) throw new Error('active task limit reached');
    const repo = this.db.prepare('select * from repositories where id=?').get(repositoryId);
    const worker = this.db.prepare('select * from workers where id=?').get(workerId);
    if (!repo) throw new Error('repository not found');
    if (!worker || worker.status !== 'active') throw new Error('active worker not found');
    if (providerSessionId) {
      const session = this.db.prepare('select * from provider_sessions where id=?').get(providerSessionId);
      if (!session || session.worker_id !== workerId || session.status !== 'active') throw new Error('provider session does not belong to worker');
    }
    if (!objective?.trim()) throw new Error('task objective required');
    const taskId = uid('task');
    const branch = `dev-zero/${taskId}`;
    const worktree = path.join(this.worktreeRoot, taskId);
    runSync('git', ['-C', repo.root_path, 'worktree', 'add', '-b', branch, worktree, repo.head_sha]);
    const checkpoint = runSync('git', ['-C', worktree, 'rev-parse', 'HEAD']);
    const row = { id: taskId, repository_id: repositoryId, worker_id: workerId, provider_session_id: providerSessionId, objective: objective.trim(), status: 'ready', worktree_path: fs.realpathSync(worktree), branch_name: branch, checkpoint_sha: checkpoint, created_at: now(), updated_at: now() };
    this.db.prepare('insert into tasks(id,repository_id,worker_id,provider_session_id,objective,status,worktree_path,branch_name,checkpoint_sha,created_at,updated_at) values(@id,@repository_id,@worker_id,@provider_session_id,@objective,@status,@worktree_path,@branch_name,@checkpoint_sha,@created_at,@updated_at)').run(row);
    this.recordEvidence(taskId, null, 'checkpoint', { sha: checkpoint, worktree: row.worktree_path });
    return row;
  }

  getTask(taskId) { return this.db.prepare('select * from tasks where id=?').get(taskId) || null; }

  resumeTask(taskId, providerSessionId = null) {
    const task = this.getTask(taskId);
    if (!task) throw new Error('task not found');
    if (!['ready', 'recovered', 'failed'].includes(task.status)) throw new Error(`task cannot resume from ${task.status}`);
    if (!fs.existsSync(task.worktree_path)) throw new Error('task worktree is missing');
    if (providerSessionId) {
      const session = this.db.prepare('select * from provider_sessions where id=?').get(providerSessionId);
      if (!session || session.worker_id !== task.worker_id || session.status !== 'active') throw new Error('provider session does not belong to task worker');
      this.db.prepare('update tasks set provider_session_id=?, updated_at=? where id=?').run(providerSessionId, now(), taskId);
    }
    return this.getTask(taskId);
  }

  validateIntent(task, intent) {
    if (!intent || typeof intent !== 'object') throw new Error('command intent required');
    if (!intent.binary?.trim()) throw new Error('command binary required');
    if (!Array.isArray(intent.args) || intent.args.some(value => typeof value !== 'string')) throw new Error('command args must be strings');
    const cwd = path.resolve(task.worktree_path, intent.cwd || '.');
    ensureInside(task.worktree_path, cwd);
    const scope = Array.isArray(intent.filesystemScope) && intent.filesystemScope.length ? intent.filesystemScope : ['.'];
    const writable = scope.map(item => {
      const target = path.resolve(task.worktree_path, item);
      if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
      return ensureInside(task.worktree_path, target);
    });
    const timeoutMs = Number(intent.timeoutMs || 300_000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_600_000) throw new Error('timeout outside allowed range');
    const memoryMb = intent.memoryMb == null ? 2048 : Number(intent.memoryMb);
    const cpuSeconds = intent.cpuSeconds == null ? Math.max(1, Math.ceil(timeoutMs / 1000)) : Number(intent.cpuSeconds);
    if (!Number.isFinite(memoryMb) || memoryMb < 64) throw new Error('memory limit invalid');
    if (!Number.isFinite(cpuSeconds) || cpuSeconds < 1) throw new Error('CPU limit invalid');
    const network = intent.network === 'allow' ? 'allow' : 'deny';
    const approvalTier = ['none', 'operator', 'owner'].includes(intent.approvalTier) ? intent.approvalTier : 'operator';
    if (network === 'allow' && approvalTier === 'none') throw new Error('network access requires explicit approval tier');
    if ((intent.env && typeof intent.env !== 'object') || Array.isArray(intent.env)) throw new Error('env must be an object');
    return { ...intent, binary: intent.binary.trim(), args: intent.args, cwd, writable, timeoutMs, memoryMb, cpuSeconds, network, approvalTier, env: sanitizeEnv(intent.env || {}) };
  }

  buildIsolatedCommand(task, intent) {
    if (process.platform !== 'linux' || !commandExists('bwrap')) throw new Error('secure execution unavailable: bubblewrap is required for governed command execution');
    const bwrap = ['--die-with-parent', '--new-session', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
    for (const writable of intent.writable) bwrap.push('--bind', writable, writable);
    bwrap.push('--chdir', intent.cwd);
    if (intent.network === 'deny') bwrap.push('--unshare-net');
    bwrap.push('--', intent.binary, ...intent.args);
    let binary = 'bwrap';
    let args = bwrap;
    if (commandExists('prlimit')) {
      binary = 'prlimit';
      args = [`--as=${Math.floor(intent.memoryMb * 1024 * 1024)}`, `--cpu=${Math.floor(intent.cpuSeconds)}`, '--', 'bwrap', ...bwrap];
    }
    return { binary, args };
  }

  async executeCommand(taskId, rawIntent, { approved = false } = {}) {
    const task = this.getTask(taskId);
    if (!task) throw new Error('task not found');
    if (!['ready', 'recovered', 'failed'].includes(task.status)) throw new Error(`task cannot execute from ${task.status}`);
    const intent = this.validateIntent(task, rawIntent);
    if (intent.approvalTier !== 'none' && !approved) throw new Error(`command requires ${intent.approvalTier} approval`);
    const isolated = this.buildIsolatedCommand(task, intent);
    const commandId = uid('cmd');
    this.db.prepare("update tasks set status='running', failure_json=null, updated_at=? where id=?").run(now(), taskId);
    this.db.prepare("insert into commands(id,task_id,intent_json,status,started_at) values(?,?,?,'running',?)").run(commandId, taskId, JSON.stringify({ ...intent, env: Object.keys(intent.env) }), now());

    const stdout = [];
    const stderr = [];
    const child = spawn(isolated.binary, isolated.args, { cwd: task.worktree_path, env: intent.env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    this.active.set(commandId, child);
    this.db.prepare('update commands set pid=? where id=?').run(child.pid || null, commandId);
    const maxOutput = Number(rawIntent.maxOutputBytes || 4 * 1024 * 1024);
    let outBytes = 0;
    let errBytes = 0;
    child.stdout.on('data', chunk => { if (outBytes < maxOutput) { const kept = chunk.subarray(0, Math.max(0, maxOutput - outBytes)); stdout.push(kept); outBytes += kept.length; } });
    child.stderr.on('data', chunk => { if (errBytes < maxOutput) { const kept = chunk.subarray(0, Math.max(0, maxOutput - errBytes)); stderr.push(kept); errBytes += kept.length; } });

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; this.cancelCommand(commandId); }, intent.timeoutMs);
    const exit = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    clearTimeout(timer);
    this.active.delete(commandId);
    const stdoutText = Buffer.concat(stdout).toString('utf8');
    const stderrText = Buffer.concat(stderr).toString('utf8');
    const success = !timedOut && exit.code === 0;
    const failure = success ? null : { category: timedOut ? 'timeout' : 'command', message: timedOut ? 'command timed out' : `command exited ${exit.code ?? exit.signal}`, retryable: timedOut, replanRequired: !timedOut, rollbackRequired: Boolean(rawIntent.mutating) };
    this.db.prepare('update commands set status=?,finished_at=?,exit_code=?,stdout_digest=?,stderr_digest=?,failure_json=? where id=?').run(success ? 'completed' : 'failed', now(), exit.code, sha256(stdoutText), sha256(stderrText), failure ? JSON.stringify(failure) : null, commandId);
    this.recordEvidence(taskId, commandId, 'command-result', { binary: intent.binary, args: intent.args, exitCode: exit.code, stdoutDigest: sha256(stdoutText), stderrDigest: sha256(stderrText), timedOut });
    const diff = runSync('git', ['-C', task.worktree_path, 'diff', '--binary', 'HEAD']);
    this.recordEvidence(taskId, commandId, 'repository-diff', { digest: sha256(diff), bytes: Buffer.byteLength(diff) });

    if (!success && rawIntent.mutating && rawIntent.rollbackOnFailure !== false) this.rollback(taskId);
    this.db.prepare('update tasks set status=?, failure_json=?, updated_at=?, finished_at=? where id=?').run(success ? 'ready' : 'failed', failure ? JSON.stringify(failure) : null, now(), success ? null : now(), taskId);
    return { commandId, success, exitCode: exit.code, stdout: stdoutText, stderr: stderrText, failure, evidence: this.evidence(taskId, commandId) };
  }

  cancelCommand(commandId) {
    const child = this.active.get(commandId);
    if (!child) return false;
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { child.kill('SIGTERM'); }
    setTimeout(() => { try { if (!child.killed) { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } } catch {} }, 1500).unref();
    return true;
  }

  checkpoint(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error('task not found');
    const sha = runSync('git', ['-C', task.worktree_path, 'rev-parse', 'HEAD']);
    this.db.prepare('update tasks set checkpoint_sha=?,updated_at=? where id=?').run(sha, now(), taskId);
    return this.recordEvidence(taskId, null, 'checkpoint', { sha });
  }

  rollback(taskId) {
    const task = this.getTask(taskId);
    if (!task?.checkpoint_sha) throw new Error('task checkpoint not found');
    runSync('git', ['-C', task.worktree_path, 'reset', '--hard', task.checkpoint_sha]);
    runSync('git', ['-C', task.worktree_path, 'clean', '-fd']);
    this.db.prepare("update tasks set status='ready',failure_json=null,updated_at=?,finished_at=null where id=?").run(now(), taskId);
    return this.recordEvidence(taskId, null, 'rollback', { checkpointSha: task.checkpoint_sha, resultingSha: runSync('git', ['-C', task.worktree_path, 'rev-parse', 'HEAD']) });
  }

  completeTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error('task not found');
    const failed = this.db.prepare("select count(*) n from commands where task_id=? and status in ('failed','interrupted')").get(taskId).n;
    if (failed) throw new Error('task has failed or interrupted commands');
    const evidenceCount = this.db.prepare('select count(*) n from evidence where task_id=?').get(taskId).n;
    if (!evidenceCount) throw new Error('task cannot complete without evidence');
    this.db.prepare("update tasks set status='completed',updated_at=?,finished_at=? where id=?").run(now(), now(), taskId);
    return this.getTask(taskId);
  }

  recordEvidence(taskId, commandId, kind, payload) {
    const body = JSON.stringify(payload);
    const row = { id: uid('evidence'), task_id: taskId, command_id: commandId, kind, digest: sha256(body), payload_json: body, created_at: now() };
    this.db.prepare('insert into evidence(id,task_id,command_id,kind,digest,payload_json,created_at) values(@id,@task_id,@command_id,@kind,@digest,@payload_json,@created_at)').run(row);
    return { ...row, payload };
  }

  evidence(taskId, commandId = null) {
    const rows = commandId ? this.db.prepare('select * from evidence where task_id=? and command_id=? order by created_at').all(taskId, commandId) : this.db.prepare('select * from evidence where task_id=? order by created_at').all(taskId);
    return rows.map(row => ({ ...row, payload: JSON.parse(row.payload_json) }));
  }

  status() {
    return {
      repositories: this.db.prepare('select count(*) n from repositories').get().n,
      workers: this.db.prepare("select count(*) n from workers where status='active'").get().n,
      runningTasks: this.db.prepare("select count(*) n from tasks where status='running'").get().n,
      queuedOrReadyTasks: this.db.prepare("select count(*) n from tasks where status in ('ready','recovered')").get().n,
      isolation: process.platform === 'linux' && commandExists('bwrap') ? 'bubblewrap' : 'unavailable',
    };
  }

  close() { this.db.close(); }
}

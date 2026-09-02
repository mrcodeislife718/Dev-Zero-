import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DevZeroRuntime } from '../src/runtime.js';
import { TeamCoordinator } from '../src/team-coordinator.js';

function run(binary, args, cwd) {
  const result = spawnSync(binary, args, { cwd, encoding:'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return (result.stdout || '').trim();
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'dev-zero-team-'));
  const repoPath = path.join(root,'repo'); fs.mkdirSync(repoPath);
  run('git',['init'],repoPath); run('git',['config','user.email','team@example.com'],repoPath); run('git',['config','user.name','Team Test'],repoPath);
  fs.writeFileSync(path.join(repoPath,'README.md'),'base\n'); run('git',['add','.'],repoPath); run('git',['commit','-m','base'],repoPath);
  const runtime = new DevZeroRuntime({ home:path.join(root,'home'), maxActiveTasks:4 });
  const repo = runtime.attachRepository(repoPath);
  return { root, runtime, repo };
}

test('mission scheduler releases only dependency-ready engineering work', () => {
  const f = fixture();
  try {
    const team = new TeamCoordinator(f.runtime);
    const builder = f.runtime.createWorker({ name:'builder', role:'builder' });
    const tester = f.runtime.createWorker({ name:'tester', role:'tester' });
    const mission = team.createMission({
      repositoryId:f.repo.id,
      objective:'ship verified change',
      acceptanceCriteria:[{id:'implemented',description:'implementation exists'},{id:'verified',description:'tests prove it'}],
      tasks:[
        {id:'build',role:'builder',objective:'implement',criterionIds:['implemented'],requiredVerifierRole:'tester'},
        {id:'test',role:'tester',objective:'verify',dependencies:['build'],criterionIds:['verified']},
      ],
    });
    assert.deepEqual(team.readyTasks(mission.id).map(item=>item.id),['build']);
    const claimed = team.claimTask(mission.id,builder.id); assert.equal(claimed.id,'build'); assert.ok(claimed.runtime_task_id);
    assert.equal(team.readyTasks(mission.id).length,0);
    assert.throws(()=>team.submitVerification('build',{verifierWorkerId:builder.id,status:'passed'}),/independent/);
    const verified = team.submitVerification('build',{verifierWorkerId:tester.id,status:'passed'}); assert.equal(verified.verification.status,'passed');
    f.runtime.completeTask(claimed.runtime_task_id); team.completeTask('build');
    assert.deepEqual(team.readyTasks(mission.id).map(item=>item.id),['test']);
  } finally { f.runtime.close(); fs.rmSync(f.root,{recursive:true,force:true}); }
});

test('expired worker lease returns unfinished work to schedulable state', () => {
  const f = fixture();
  try {
    const team = new TeamCoordinator(f.runtime,{defaultLeaseMs:10_000});
    const worker = f.runtime.createWorker({name:'builder',role:'builder'});
    const mission = team.createMission({repositoryId:f.repo.id,objective:'recover work',tasks:[{id:'one',role:'builder',objective:'one'}]});
    team.claimTask(mission.id,worker.id,{leaseMs:10_000});
    f.runtime.db.prepare("update mission_tasks set lease_expires_at='2000-01-01T00:00:00.000Z' where id='one'").run();
    assert.equal(team.recoverExpiredLeases(),1);
    assert.equal(team.readyTasks(mission.id)[0].id,'one');
  } finally { f.runtime.close(); fs.rmSync(f.root,{recursive:true,force:true}); }
});

test('cyclic mission dependency graphs are rejected before worktrees are created', () => {
  const f = fixture();
  try {
    const team = new TeamCoordinator(f.runtime);
    assert.throws(()=>team.createMission({repositoryId:f.repo.id,objective:'bad graph',tasks:[{id:'a',dependencies:['b']},{id:'b',dependencies:['a']}]}),/cycle/);
    assert.equal(f.runtime.db.prepare('select count(*) n from tasks').get().n,0);
  } finally { f.runtime.close(); fs.rmSync(f.root,{recursive:true,force:true}); }
});

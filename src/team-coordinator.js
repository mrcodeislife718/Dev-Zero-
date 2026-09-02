import crypto from 'node:crypto';

const now = () => new Date().toISOString();
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;

function parseJson(value, fallback) { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } }
function positiveOrZero(value, fallback = 0) { const number = Number(value ?? fallback); return Number.isFinite(number) && number >= 0 ? number : fallback; }

export class TeamCoordinator {
  constructor(runtime, { defaultLeaseMs = 120_000 } = {}) {
    this.runtime = runtime;
    this.db = runtime.db;
    this.defaultLeaseMs = defaultLeaseMs;
    this.migrate();
    this.recoverExpiredLeases();
  }

  migrate() {
    this.db.exec(`
      create table if not exists missions(
        id text primary key,
        repository_id text not null,
        objective text not null,
        status text not null,
        acceptance_json text not null,
        budget_json text not null,
        created_at text not null,
        updated_at text not null,
        finished_at text,
        foreign key(repository_id) references repositories(id)
      );
      create table if not exists mission_tasks(
        id text primary key,
        mission_id text not null,
        title text not null,
        role text not null,
        status text not null,
        objective text not null,
        dependencies_json text not null,
        criterion_ids_json text not null,
        required_verifier_role text,
        runtime_task_id text,
        worker_id text,
        lease_expires_at text,
        attempts integer not null default 0,
        verification_json text,
        created_at text not null,
        updated_at text not null,
        finished_at text,
        foreign key(mission_id) references missions(id),
        foreign key(runtime_task_id) references tasks(id),
        foreign key(worker_id) references workers(id)
      );
      create index if not exists idx_mission_tasks_ready on mission_tasks(mission_id,status,role);
      create index if not exists idx_mission_tasks_worker on mission_tasks(worker_id,status);
    `);
  }

  validateTaskGraph(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('mission requires at least one task');
    const ids = new Set();
    for (const task of tasks) {
      if (!task.id?.trim() || ids.has(task.id)) throw new Error('mission task ids must be unique non-empty strings');
      ids.add(task.id);
    }
    const graph = new Map();
    for (const task of tasks) {
      const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
      for (const dependency of deps) if (!ids.has(dependency)) throw new Error(`unknown mission task dependency: ${dependency}`);
      if (deps.includes(task.id)) throw new Error(`mission task cannot depend on itself: ${task.id}`);
      graph.set(task.id, deps);
    }
    const visiting = new Set(), visited = new Set();
    const visit = id => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error('mission task graph contains a cycle');
      visiting.add(id);
      for (const dependency of graph.get(id) || []) visit(dependency);
      visiting.delete(id); visited.add(id);
    };
    for (const id of ids) visit(id);
  }

  createMission({ repositoryId, objective, acceptanceCriteria = [], budget = {}, tasks }) {
    if (!this.db.prepare('select id from repositories where id=?').get(repositoryId)) throw new Error('repository not found');
    if (!objective?.trim()) throw new Error('mission objective required');
    this.validateTaskGraph(tasks);
    const criteria = acceptanceCriteria.map(item => ({ id: String(item.id), description: String(item.description || item.id), required: item.required !== false }));
    const criterionIds = new Set(criteria.map(item => item.id));
    for (const task of tasks) for (const id of task.criterionIds || []) if (!criterionIds.has(id)) throw new Error(`unknown mission acceptance criterion: ${id}`);
    const created = now();
    const missionBudget = {
      maxActiveWorkers: Math.max(1, positiveOrZero(budget.maxActiveWorkers, this.runtime.maxActiveTasks)),
      maxAttemptsPerTask: Math.max(1, positiveOrZero(budget.maxAttemptsPerTask, 3)),
      maxMissionDurationMs: positiveOrZero(budget.maxMissionDurationMs, 0),
      maxVerifierBacklog: positiveOrZero(budget.maxVerifierBacklog, 0),
    };
    const mission = { id: uid('mission'), repository_id: repositoryId, objective: objective.trim(), status: 'active', acceptance_json: JSON.stringify(criteria), budget_json: JSON.stringify(missionBudget), created_at: created, updated_at: created };
    const transaction = this.db.transaction(() => {
      this.db.prepare('insert into missions(id,repository_id,objective,status,acceptance_json,budget_json,created_at,updated_at) values(@id,@repository_id,@objective,@status,@acceptance_json,@budget_json,@created_at,@updated_at)').run(mission);
      const insert = this.db.prepare('insert into mission_tasks(id,mission_id,title,role,status,objective,dependencies_json,criterion_ids_json,required_verifier_role,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?)');
      for (const task of tasks) insert.run(task.id, mission.id, String(task.title || task.objective || task.id), String(task.role || 'builder'), 'pending', String(task.objective || task.title || task.id), JSON.stringify(task.dependencies || []), JSON.stringify(task.criterionIds || []), task.requiredVerifierRole || null, created, created);
    });
    transaction();
    return this.getMission(mission.id);
  }

  taskRow(row) {
    return row ? { ...row, dependencies: parseJson(row.dependencies_json, []), criterionIds: parseJson(row.criterion_ids_json, []), verification: parseJson(row.verification_json, null) } : null;
  }

  getMission(missionId) {
    const mission = this.db.prepare('select * from missions where id=?').get(missionId);
    if (!mission) return null;
    const tasks = this.db.prepare('select * from mission_tasks where mission_id=? order by created_at,id').all(missionId).map(row => this.taskRow(row));
    return { ...mission, acceptanceCriteria: parseJson(mission.acceptance_json, []), budget: parseJson(mission.budget_json, {}), tasks };
  }

  dependencyReady(task, byId) {
    return task.dependencies.every(id => byId.get(id)?.status === 'completed');
  }

  verificationBacklog(missionId) {
    const row = this.db.prepare(`
      select count(*) n
      from mission_tasks mt
      join tasks rt on rt.id = mt.runtime_task_id
      where mt.mission_id=?
        and mt.required_verifier_role is not null
        and mt.verification_json is null
        and mt.status in ('leased','executing','verifying')
        and rt.status='completed'
    `).get(missionId);
    return Number(row?.n || 0);
  }

  admissionStatus(missionId) {
    const mission = this.getMission(missionId);
    if (!mission) return { allowed:false, reasons:['mission-not-found'], verificationBacklog:0, elapsedMs:0 };
    const elapsedMs = Math.max(0, Date.now() - Date.parse(mission.created_at));
    const verificationBacklog = this.verificationBacklog(missionId);
    const reasons = [];
    const maxDuration = positiveOrZero(mission.budget.maxMissionDurationMs, 0);
    const maxVerifierBacklog = positiveOrZero(mission.budget.maxVerifierBacklog, 0);
    if (mission.status !== 'active') reasons.push(`mission-${mission.status}`);
    if (maxDuration > 0 && elapsedMs >= maxDuration) reasons.push('mission-duration-budget-exhausted');
    if (maxVerifierBacklog > 0 && verificationBacklog >= maxVerifierBacklog) reasons.push('verification-backlog-capacity-reached');
    return { allowed:reasons.length === 0, reasons, verificationBacklog, elapsedMs };
  }

  readyTasks(missionId, role = null) {
    this.recoverExpiredLeases();
    const mission = this.getMission(missionId);
    if (!mission || mission.status !== 'active') return [];
    if (!this.admissionStatus(missionId).allowed) return [];
    const byId = new Map(mission.tasks.map(task => [task.id, task]));
    return mission.tasks.filter(task => task.status === 'pending' && (!role || task.role === role) && this.dependencyReady(task, byId));
  }

  activeMissionWorkers(missionId) { return this.db.prepare("select count(*) n from mission_tasks where mission_id=? and status in ('leased','executing','verifying')").get(missionId).n; }

  claimTask(missionId, workerId, { providerSessionId = null, leaseMs = this.defaultLeaseMs } = {}) {
    const worker = this.db.prepare("select * from workers where id=? and status='active'").get(workerId);
    if (!worker) throw new Error('active worker not found');
    const mission = this.getMission(missionId);
    if (!mission || mission.status !== 'active') throw new Error('active mission not found');
    const admission = this.admissionStatus(missionId);
    if (!admission.allowed) throw new Error(`mission admission blocked: ${admission.reasons.join(', ')}`);
    if (this.activeMissionWorkers(missionId) >= Math.min(Number(mission.budget.maxActiveWorkers || this.runtime.maxActiveTasks), this.runtime.maxActiveTasks)) throw new Error('mission worker capacity reached');
    const candidate = this.readyTasks(missionId, worker.role)[0] || this.readyTasks(missionId)[0];
    if (!candidate) return null;
    const attempts = candidate.attempts + 1;
    if (attempts > Number(mission.budget.maxAttemptsPerTask || 3)) throw new Error(`mission task attempt budget exhausted: ${candidate.id}`);
    const runtimeTask = this.runtime.createTask({ repositoryId: mission.repository_id, workerId, providerSessionId, objective: candidate.objective });
    const leaseExpiresAt = new Date(Date.now() + Math.max(10_000, Number(leaseMs))).toISOString();
    this.db.prepare("update mission_tasks set status='leased',worker_id=?,runtime_task_id=?,lease_expires_at=?,attempts=?,updated_at=? where id=? and status='pending'").run(workerId, runtimeTask.id, leaseExpiresAt, attempts, now(), candidate.id);
    return this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(candidate.id));
  }

  heartbeat(taskId, workerId, leaseMs = this.defaultLeaseMs) {
    const task = this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
    if (!task || task.worker_id !== workerId || !['leased','executing','verifying'].includes(task.status)) throw new Error('active leased task not found for worker');
    const leaseExpiresAt = new Date(Date.now() + Math.max(10_000, Number(leaseMs))).toISOString();
    this.db.prepare('update mission_tasks set lease_expires_at=?,updated_at=? where id=?').run(leaseExpiresAt, now(), taskId);
    return this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
  }

  markExecuting(taskId, workerId) {
    const task = this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
    if (!task || task.worker_id !== workerId || task.status !== 'leased') throw new Error('leased task not found for worker');
    this.db.prepare("update mission_tasks set status='executing',updated_at=? where id=?").run(now(), taskId);
    return this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
  }

  submitVerification(taskId, { verifierWorkerId, status, evidenceIds = [], notes = null }) {
    const task = this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
    if (!task || !task.runtime_task_id) throw new Error('mission task has no runtime work');
    const verifier = this.db.prepare("select * from workers where id=? and status='active'").get(verifierWorkerId);
    if (!verifier) throw new Error('active verifier not found');
    if (verifierWorkerId === task.worker_id) throw new Error('task verifier must be independent from builder');
    if (task.required_verifier_role && verifier.role !== task.required_verifier_role) throw new Error(`task requires verifier role ${task.required_verifier_role}`);
    const runtimeTask = this.runtime.getTask(task.runtime_task_id);
    if (!runtimeTask || runtimeTask.status !== 'completed') throw new Error('runtime task must be completed before verification');
    const validEvidence = new Set(this.runtime.evidence(task.runtime_task_id).map(item => item.id));
    for (const id of evidenceIds) if (!validEvidence.has(id)) throw new Error(`verification evidence does not belong to runtime task: ${id}`);
    const verification = { verifierWorkerId, verifierRole: verifier.role, status: status === 'passed' ? 'passed' : 'failed', evidenceIds, notes, at: now() };
    this.db.prepare("update mission_tasks set status=?,verification_json=?,updated_at=? where id=?").run(verification.status === 'passed' ? 'verifying' : 'failed', JSON.stringify(verification), now(), taskId);
    return this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
  }

  completeTask(taskId) {
    const task = this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
    if (!task || !task.runtime_task_id) throw new Error('mission task has no runtime task');
    if (task.required_verifier_role && task.verification?.status !== 'passed') throw new Error('mission task requires independent verification before completion');
    const runtimeTask = this.runtime.getTask(task.runtime_task_id);
    if (!runtimeTask) throw new Error('runtime task not found');
    if (runtimeTask.status !== 'completed') this.runtime.completeTask(task.runtime_task_id);
    this.db.prepare("update mission_tasks set status='completed',lease_expires_at=null,updated_at=?,finished_at=? where id=?").run(now(), now(), taskId);
    this.updateMissionCompletion(task.mission_id);
    return this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
  }

  failTask(taskId, reason) {
    const task = this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
    if (!task) throw new Error('mission task not found');
    this.db.prepare("update mission_tasks set status='failed',lease_expires_at=null,verification_json=?,updated_at=?,finished_at=? where id=?").run(JSON.stringify({ status:'failed', reason:String(reason), at:now() }), now(), now(), taskId);
    return this.taskRow(this.db.prepare('select * from mission_tasks where id=?').get(taskId));
  }

  recoverExpiredLeases() {
    const expired = this.db.prepare("select * from mission_tasks where status in ('leased','executing','verifying') and lease_expires_at is not null and lease_expires_at < ?").all(now());
    for (const row of expired) {
      const runtimeTask = row.runtime_task_id ? this.runtime.getTask(row.runtime_task_id) : null;
      const nextStatus = runtimeTask?.status === 'completed' ? 'verifying' : 'pending';
      this.db.prepare('update mission_tasks set status=?,worker_id=null,lease_expires_at=null,updated_at=? where id=?').run(nextStatus, now(), row.id);
    }
    return expired.length;
  }

  updateMissionCompletion(missionId) {
    const mission = this.getMission(missionId);
    if (!mission) return null;
    const allCompleted = mission.tasks.length > 0 && mission.tasks.every(task => task.status === 'completed');
    const covered = new Set(mission.tasks.filter(task => task.status === 'completed').flatMap(task => task.criterionIds));
    const missingCriteria = mission.acceptanceCriteria.filter(item => item.required && !covered.has(item.id));
    if (allCompleted && missingCriteria.length === 0) this.db.prepare("update missions set status='completed',updated_at=?,finished_at=? where id=?").run(now(), now(), missionId);
    return { allCompleted, missingCriteria: missingCriteria.map(item => item.id), mission: this.getMission(missionId) };
  }
}

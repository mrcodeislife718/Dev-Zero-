import crypto from 'node:crypto';
import { DevZeroRuntime } from './runtime.js';

export class IntegratedDevZeroRuntime extends DevZeroRuntime {
  constructor(options = {}) {
    super(options);
    this.sessionsUrl = options.sessionsUrl ?? process.env.SESSIONS_URL ?? null;
    this.sessionsToken = options.sessionsToken ?? process.env.SESSIONS_TOKEN ?? null;
    this.db.exec(`
      create table if not exists task_integrations(
        task_id text primary key,
        sessions_session_id text,
        sessions_correlation_id text,
        last_event_id text,
        foreign key(task_id) references tasks(id)
      );
    `);
    const columns = this.db.prepare('pragma table_info(workers)').all().map(row => row.name);
    if (!columns.includes('axion_identity_id')) this.db.exec('alter table workers add column axion_identity_id text');
  }

  createWorker(input) {
    const worker = super.createWorker(input);
    if (input.axionIdentityId) {
      this.db.prepare('update workers set axion_identity_id=?,updated_at=? where id=?').run(String(input.axionIdentityId), new Date().toISOString(), worker.id);
    }
    return this.db.prepare('select * from workers where id=?').get(worker.id);
  }

  async emitTaskEvent(taskId, type, payload) {
    const integration = this.db.prepare('select * from task_integrations where task_id=?').get(taskId);
    if (!integration?.sessions_session_id || !this.sessionsUrl || !this.sessionsToken) return null;
    const eventId = `event_${crypto.randomUUID()}`;
    const response = await fetch(`${this.sessionsUrl.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(integration.sessions_session_id)}/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.sessionsToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: eventId, type, correlationId: integration.sessions_correlation_id || taskId, causationId: integration.last_event_id || undefined, payload }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Sessions ${response.status}: ${body.error || body.message || 'lineage write failed'}`);
    this.db.prepare('update task_integrations set last_event_id=? where task_id=?').run(body.id, taskId);
    return body;
  }

  async createTask(input) {
    const task = super.createTask(input);
    this.db.prepare('insert into task_integrations(task_id,sessions_session_id,sessions_correlation_id) values(?,?,?)').run(task.id, input.sessionsSessionId || null, input.sessionsCorrelationId || task.id);
    const worker = this.db.prepare('select * from workers where id=?').get(task.worker_id);
    if (input.sessionsSessionId && this.sessionsUrl && this.sessionsToken) {
      try {
        await this.emitTaskEvent(task.id, 'TaskCreated', { taskId: task.id, objectiveId: input.objectiveId || null, summary: task.objective });
        await this.emitTaskEvent(task.id, 'WorkerAssigned', { taskId: task.id, logicalWorkerId: task.worker_id, role: worker.role, metadata: { axionIdentityId: worker.axion_identity_id || null } });
        if (task.provider_session_id) {
          const provider = this.db.prepare('select * from provider_sessions where id=?').get(task.provider_session_id);
          if (provider) await this.emitTaskEvent(task.id, 'ProviderSessionBound', { taskId: task.id, logicalWorkerId: task.worker_id, providerSessionId: provider.id, provider: provider.provider, model: provider.model });
        }
        await this.emitTaskEvent(task.id, 'WorktreeCreated', { taskId: task.id, worktree: task.worktree_path, branch: task.branch_name, checkpointId: task.checkpoint_sha });
      } catch (error) {
        this.recordEvidence(task.id, null, 'lineage-delivery-failure', { message: error.message });
        throw error;
      }
    }
    return { ...task, axion_identity_id: worker.axion_identity_id || null };
  }

  async executeCommand(taskId, intent, options = {}) {
    const task = this.getTask(taskId);
    await this.emitTaskEvent(taskId, 'AuthorityEvaluated', { taskId, authorityDecision: options.approved || intent.approvalTier === 'none' ? 'allowed' : 'approval_required', commandClass: intent.commandClass || intent.binary });
    try {
      const result = await super.executeCommand(taskId, { ...intent, rollbackOnFailure: false }, options);
      await this.emitTaskEvent(taskId, 'CommandExecuted', { taskId, logicalWorkerId: task.worker_id, commandClass: intent.commandClass || intent.binary, tool: intent.binary, args: intent.args, evidenceIds: result.evidence.map(item => item.id), outcome: result.success ? 'success' : 'failed', failureCategory: result.failure?.category, retryable: result.failure?.retryable, replanRequired: result.failure?.replanRequired, rollbackRequired: result.failure?.rollbackRequired });
      if (intent.commandClass === 'test') await this.emitTaskEvent(taskId, 'TestExecuted', { taskId, logicalWorkerId: task.worker_id, evidenceIds: result.evidence.map(item => item.id), outcome: result.success ? 'passed' : 'failed' });
      if (!result.success && intent.mutating && intent.rollbackOnFailure !== false) {
        await this.emitTaskEvent(taskId, 'RollbackTriggered', { taskId, summary: 'Dev-Zero rollback after failed mutating command' });
        const rollbackEvidence = super.rollback(taskId);
        await this.emitTaskEvent(taskId, 'RollbackCompleted', { taskId, checkpointId: rollbackEvidence.payload.checkpointSha, evidenceIds: [rollbackEvidence.id] });
      }
      if (!result.success) await this.emitTaskEvent(taskId, 'TaskFailed', { taskId, logicalWorkerId: task.worker_id, evidenceIds: this.evidence(taskId).map(item => item.id), failureCategory: result.failure?.category, outcome: 'failed' });
      return result;
    } catch (error) {
      await this.emitTaskEvent(taskId, 'TaskFailed', { taskId, logicalWorkerId: task.worker_id, evidenceIds: this.evidence(taskId).map(item => item.id), failureCategory: 'runtime', outcome: error.message });
      throw error;
    }
  }

  async checkpointWithLineage(taskId) {
    const evidence = super.checkpoint(taskId);
    await this.emitTaskEvent(taskId, 'SnapshotCreated', { taskId, checkpointId: evidence.payload.sha, evidenceIds: [evidence.id] });
    return evidence;
  }

  async rollbackWithLineage(taskId) {
    await this.emitTaskEvent(taskId, 'RollbackTriggered', { taskId, summary: 'Dev-Zero rollback requested' });
    const evidence = super.rollback(taskId);
    await this.emitTaskEvent(taskId, 'RollbackCompleted', { taskId, checkpointId: evidence.payload.checkpointSha, evidenceIds: [evidence.id] });
    return evidence;
  }

  async completeTask(taskId) {
    const task = super.completeTask(taskId);
    const evidenceIds = this.evidence(taskId).map(item => item.id);
    await this.emitTaskEvent(taskId, 'TaskCompleted', { taskId, logicalWorkerId: task.worker_id, evidenceIds, outcome: 'completed' });
    return task;
  }
}

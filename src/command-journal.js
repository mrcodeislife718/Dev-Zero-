import crypto from 'node:crypto';

const now = () => new Date().toISOString();

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

export class DurableCommandJournal {
  constructor(runtime) {
    this.runtime = runtime;
    runtime.db.exec(`
      create table if not exists command_dispatches(
        idempotency_key text primary key,
        task_id text not null,
        intent_digest text not null,
        mutating integer not null,
        status text not null,
        command_id text,
        result_json text,
        created_at text not null,
        updated_at text not null,
        foreign key(task_id) references tasks(id)
      );
      create index if not exists idx_command_dispatches_task on command_dispatches(task_id, created_at);
    `);
    runtime.db.prepare("update command_dispatches set status='ambiguous',updated_at=? where status='running'").run(now());
  }

  async execute(taskId, intent, { approved = false, idempotencyKey } = {}) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,256}$/.test(idempotencyKey)) {
      throw Object.assign(new Error('valid idempotency key required'), { statusCode: 400 });
    }
    const intentDigest = digest({ taskId, intent });
    const existing = this.runtime.db.prepare('select * from command_dispatches where idempotency_key=?').get(idempotencyKey);
    if (existing) {
      if (existing.task_id !== taskId || existing.intent_digest !== intentDigest) {
        throw Object.assign(new Error('idempotency key was already used for a different command intent'), { statusCode: 409 });
      }
      if (existing.status === 'completed' || existing.status === 'failed') {
        const result = JSON.parse(existing.result_json);
        return { ...result, idempotencyKey, replayed: true };
      }
      if (existing.status === 'ambiguous') {
        throw Object.assign(new Error('previous dispatch outcome is ambiguous after runtime interruption; operator reconciliation required before retry'), { statusCode: 409 });
      }
      throw Object.assign(new Error('command with this idempotency key is already running'), { statusCode: 409 });
    }

    const timestamp = now();
    this.runtime.db.prepare(`insert into command_dispatches(idempotency_key,task_id,intent_digest,mutating,status,created_at,updated_at)
      values(?,?,?,?,?,?,?)`).run(idempotencyKey, taskId, intentDigest, intent?.mutating ? 1 : 0, 'running', timestamp, timestamp);

    try {
      const result = await this.runtime.executeCommand(taskId, intent, { approved });
      const status = result.success ? 'completed' : 'failed';
      this.runtime.db.prepare('update command_dispatches set status=?,command_id=?,result_json=?,updated_at=? where idempotency_key=?')
        .run(status, result.commandId || null, JSON.stringify(result), now(), idempotencyKey);
      return { ...result, idempotencyKey, replayed: false };
    } catch (error) {
      this.runtime.db.prepare("update command_dispatches set status='ambiguous',updated_at=? where idempotency_key=?").run(now(), idempotencyKey);
      throw error;
    }
  }

  reconcile(idempotencyKey, resolution) {
    const row = this.runtime.db.prepare('select * from command_dispatches where idempotency_key=?').get(idempotencyKey);
    if (!row) throw Object.assign(new Error('dispatch not found'), { statusCode: 404 });
    if (row.status !== 'ambiguous') throw Object.assign(new Error(`dispatch cannot be reconciled from ${row.status}`), { statusCode: 409 });
    if (!['retryable', 'completed', 'failed'].includes(resolution)) throw Object.assign(new Error('invalid reconciliation resolution'), { statusCode: 400 });
    if (resolution === 'retryable') {
      this.runtime.db.prepare('delete from command_dispatches where idempotency_key=?').run(idempotencyKey);
      return { idempotencyKey, status: 'retryable' };
    }
    this.runtime.db.prepare('update command_dispatches set status=?,result_json=?,updated_at=? where idempotency_key=?')
      .run(resolution, JSON.stringify({ success: resolution === 'completed', evidence: [], reconciled: true }), now(), idempotencyKey);
    return { idempotencyKey, status: resolution };
  }
}

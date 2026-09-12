import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DomainError, type Audit, type Job, type Task } from './domain.js';

/** Single-host MVP storage. Mutations, jobs, and audit records commit together. */
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, source TEXT NOT NULL,
        external_id TEXT NOT NULL, data TEXT NOT NULL,
        UNIQUE(organization_id, source, external_id)
      );
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY);
    `);
  }
  close() { this.db.close(); }
  hasReceipt(id: string): boolean { return !!this.db.prepare('SELECT id FROM receipts WHERE id=?').get(id); }
  recordReceipt(id: string) { this.db.prepare('INSERT OR IGNORE INTO receipts VALUES (?)').run(id); }
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id: string, organizationId: string): Task {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id=? AND organization_id=?').get(id, organizationId);
    if (!row) throw new DomainError('Task not found in this organization.');
    return JSON.parse(String(row.data)) as Task;
  }
  list(organizationId: string): Task[] {
    return this.db.prepare('SELECT data FROM tasks WHERE organization_id=? ORDER BY rowid DESC')
      .all(organizationId).map(row => JSON.parse(String(row.data)) as Task);
  }
  create(task: Task): { task: Task; duplicate: boolean } {
    return this.tx(() => {
      const row = this.db.prepare('SELECT data FROM tasks WHERE organization_id=? AND source=? AND external_id=?')
        .get(task.organizationId, task.feedback.source, task.feedback.externalId);
      if (row) {
        const existing = JSON.parse(String(row.data)) as Task;
        if (JSON.stringify(existing.feedback) !== JSON.stringify(task.feedback)) {
          throw new DomainError('This source ID already exists with different content. Submit a new source ID for an update.');
        }
        return { task: existing, duplicate: true };
      }
      this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?)').run(task.id, task.organizationId,
        task.feedback.source, task.feedback.externalId, JSON.stringify(task));
      this.addAudit(task.id, { type: 'feedback.received', actor: 'intake', at: task.createdAt });
      this.addJob(task.id, 'investigate');
      return { task, duplicate: false };
    });
  }
  mutate(id: string, org: string, audit: Audit, fn: (task: Task) => void, job?: Job['kind'], receiptId?: string): Task {
    return this.tx(() => {
      const task = this.get(id, org);
      if (receiptId && this.hasReceipt(receiptId)) return task;
      fn(task);
      task.revision += 1;
      task.updatedAt = audit.at;
      this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(task), id);
      this.addAudit(id, audit);
      if (job) this.addJob(id, job);
      if (receiptId) this.recordReceipt(receiptId);
      return task;
    });
  }
  private addAudit(taskId: string, audit: Audit) {
    this.db.prepare('INSERT INTO audit(task_id, data) VALUES (?, ?)').run(taskId, JSON.stringify(audit));
  }
  audit(id: string, org: string): Audit[] {
    this.get(id, org);
    return this.db.prepare('SELECT data FROM audit WHERE task_id=? ORDER BY seq').all(id)
      .map(row => JSON.parse(String(row.data)) as Audit);
  }
  private addJob(taskId: string, kind: Job['kind']) {
    const job: Job = { id: randomUUID(), taskId, kind, status: 'pending', createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO jobs VALUES (?, ?, ?)').run(job.id, taskId, JSON.stringify(job));
  }
  jobs(org: string): Job[] {
    return this.db.prepare('SELECT jobs.data FROM jobs JOIN tasks ON jobs.task_id=tasks.id WHERE tasks.organization_id=? ORDER BY jobs.rowid')
      .all(org).map(row => JSON.parse(String(row.data)) as Job);
  }
  claimJob(id: string, org: string): Job | undefined {
    return this.tx(() => {
      const job = this.jobs(org).find(job => job.id === id);
      if (!job || job.status !== 'pending') return;
      job.status = 'running';
      job.workerPid = process.pid;
      this.db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job), id);
      return job;
    });
  }
  finishJob(job: Job, error?: string) {
    this.db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify({ ...job,
      status: error ? 'failed' : 'done', ...(error ? { error } : {}) }), job.id);
  }
  recoverInterrupted(org: string): string {
    let recovered = 0;
    for (const job of this.jobs(org).filter(job => job.status === 'running')) {
      if (!job.workerPid) continue;
      try { process.kill(job.workerPid, 0); continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
      this.tx(() => {
        const task = this.get(job.taskId, org);
        const message = 'Worker stopped during execution. Inspect any partial workspace, then request a new proposal and approval.';
        // A worker may have persisted its successful result just before dying.
        if (task.status !== 'changes_ready' && task.status !== 'discussing') {
          task.status = 'failed'; task.error = message; task.revision += 1;
          task.updatedAt = new Date().toISOString();
          this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(task), task.id);
        }
        this.addAudit(task.id, { type: 'worker.recovered', actor: 'local-operator', at: new Date().toISOString(), detail: message });
        this.finishJob(job, task.status === 'failed' ? message : undefined);
        recovered += 1;
      });
    }
    return `Recovered ${recovered} interrupted job(s). No implementation was automatically retried.`;
  }
}

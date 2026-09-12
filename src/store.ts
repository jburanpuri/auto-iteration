import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DomainError, TaskNotFoundError, type Audit, type Job, type Task, type FeedbackInput, type Issue, type ProductLog, type DemoReview } from './domain.js';

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
      CREATE TABLE IF NOT EXISTS discord_messages (
        scope TEXT NOT NULL, message_id TEXT NOT NULL, task_id TEXT NOT NULL,
        PRIMARY KEY(scope, message_id)
      );
      CREATE TABLE IF NOT EXISTS complaints (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, repository_id TEXT NOT NULL,
        external_id TEXT NOT NULL, issue TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL, task_id TEXT,
        UNIQUE(organization_id, repository_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS product_logs (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, repository_id TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS demo_reviews (
        organization_id TEXT NOT NULL, repository_id TEXT NOT NULL, external_id TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(organization_id, repository_id, external_id)
      );
    `);
  }
  close() { this.db.close(); }
  reviews(org: string, repo: string): DemoReview[] {
    return this.db.prepare('SELECT data FROM demo_reviews WHERE organization_id=? AND repository_id=? ORDER BY rowid DESC')
      .all(org, repo).map(row => JSON.parse(String(row.data)) as DemoReview);
  }
  demoReview(org: string, repo: string, review: DemoReview, makeTask: (reports: DemoReview[]) => Task) {
    return this.tx(() => {
      const reviews = this.reviews(org, repo);
      const existing = reviews.find(item => item.feedback.externalId === review.feedback.externalId);
      if (existing) {
        if (JSON.stringify(existing.feedback) !== JSON.stringify(review.feedback) || existing.issue !== review.issue || existing.sample !== review.sample) {
          throw new DomainError('This source ID already exists with different content.');
        }
        return { review: existing, duplicate: true };
      }
      if (review.disposition === 'investigating') {
        // An intake category is not an issue identity. In particular, never merge all
        // unclassified feedback (or every mention of an export) into one task.
        const reportText = (item: DemoReview) => item.feedback.text.replace(/^Reported by [^\n]*\n/, '').trim().replace(/\s+/g, ' ').toLowerCase();
        const linked = reviews.find(item => item.sample === review.sample && (!review.sample || item.feedback.source === review.feedback.source) && item.feedback.category === review.feedback.category && reportText(item) === reportText(review) && item.taskId &&
          ['received', 'investigating', 'discussing', 'revising'].includes(this.get(item.taskId, org).status));
        if (linked) {
          review.taskId = linked.taskId; review.disposition = 'grouped';
          review.reason = 'An identical report already has an open investigation. Original report retained.';
          const task = this.get(linked.taskId!, org);
          // A synchronous batch finishes collecting evidence before any investigation starts.
          if (task.status === 'received') {
            task.feedback.text = `${task.feedback.text}\n\n${review.sample ? '[Sample]' : '[Submitted]'} ${review.feedback.text}`.slice(0, 12000);
            if (task.signal) { task.signal.reportIds.push(review.id); task.signal.reportCount++; }
            task.revision++; task.updatedAt = review.at;
            this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(task), task.id);
            this.addAudit(task.id, { type: 'feedback.grouped', actor: 'intake', at: review.at });
          }
        } else {
          const samples = reviews.filter(item => item.feedback.category === review.feedback.category && reportText(item) === reportText(review) && item.disposition === 'sample');
          const task = makeTask([...samples, review]);
          this.createInside(task); review.taskId = task.id;
          for (const sample of samples) {
            sample.taskId = task.id; sample.disposition = 'grouped';
            sample.reason = 'Sample evidence attached to the live report.';
            this.db.prepare('UPDATE demo_reviews SET data=? WHERE organization_id=? AND repository_id=? AND external_id=?')
              .run(JSON.stringify(sample), org, repo, sample.feedback.externalId);
          }
        }
      }
      this.db.prepare('INSERT INTO demo_reviews VALUES (?, ?, ?, ?)').run(org, repo, review.feedback.externalId, JSON.stringify(review));
      return { review, duplicate: false };
    });
  }
  hasReceipt(id: string): boolean { return !!this.db.prepare('SELECT id FROM receipts WHERE id=?').get(id); }
  recordReceipt(id: string) { this.db.prepare('INSERT OR IGNORE INTO receipts VALUES (?)').run(id); }
  linkDiscordMessage(scope: string, messageId: string, taskId: string) {
    this.db.prepare('INSERT OR IGNORE INTO discord_messages VALUES (?, ?, ?)').run(scope, messageId, taskId);
  }
  discordTask(scope: string, messageId: string, organizationId: string): Task | undefined {
    const row = this.db.prepare('SELECT task_id FROM discord_messages WHERE scope=? AND message_id=?').get(scope, messageId);
    return row ? this.get(String(row.task_id), organizationId) : undefined;
  }
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id: string, organizationId: string): Task {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id=? AND organization_id=?').get(id, organizationId);
    if (!row) throw new TaskNotFoundError('Task not found in this organization.');
    return JSON.parse(String(row.data)) as Task;
  }
  list(organizationId: string): Task[] {
    return this.db.prepare('SELECT data FROM tasks WHERE organization_id=? ORDER BY rowid DESC')
      .all(organizationId).map(row => JSON.parse(String(row.data)) as Task);
  }
  create(task: Task): { task: Task; duplicate: boolean } {
    return this.tx(() => this.createInside(task));
  }
  private createInside(task: Task): { task: Task; duplicate: boolean } {
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
  }
  recordLog(org: string, repositoryId: string, log: ProductLog) {
    this.db.prepare('INSERT OR IGNORE INTO product_logs VALUES (?, ?, ?, ?, ?)').run(log.id, org, repositoryId, log.at, JSON.stringify(log));
  }
  logs(org: string, repositoryId: string, since: string): ProductLog[] {
    return this.db.prepare('SELECT data FROM product_logs WHERE organization_id=? AND repository_id=? AND at>=? ORDER BY at DESC LIMIT 50')
      .all(org, repositoryId, since).map(row => JSON.parse(String(row.data)) as ProductLog);
  }
  complaintCounts(org: string, repositoryId: string, since: string) {
    return this.db.prepare('SELECT issue, COUNT(*) AS reports FROM complaints WHERE organization_id=? AND repository_id=? AND at>=? AND task_id IS NULL GROUP BY issue')
      .all(org, repositoryId, since).map(row => ({ issue: String(row.issue), reports: Number(row.reports) }));
  }
  escalate(org: string, repositoryId: string, feedback: FeedbackInput, issue: Issue, at: string,
    makeTask: (feedback: FeedbackInput, signal: NonNullable<Task['signal']>) => Task) {
    return this.tx(() => {
      const existing = this.db.prepare('SELECT * FROM complaints WHERE organization_id=? AND repository_id=? AND external_id=?')
        .get(org, repositoryId, feedback.externalId);
      if (existing && (String(existing.data) !== JSON.stringify(feedback) || existing.issue !== issue)) {
        throw new DomainError('This source ID already exists with different content.');
      }
      if (existing?.task_id) {
        const task = this.get(String(existing.task_id), org);
        return { task, duplicate: true, reportCount: task.signal?.reportCount ?? 1 };
      }
      if (!existing) this.db.prepare('INSERT INTO complaints VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
        .run(randomUUID(), org, repositoryId, feedback.externalId, issue, at, JSON.stringify(feedback));
      const since = new Date(Date.parse(at) - 30 * 60_000).toISOString();
      // Demo issue keys are explicit product categories, not a claim of semantic clustering.
      const rows = this.db.prepare(`SELECT id, data FROM complaints WHERE organization_id=? AND repository_id=? AND issue=?
        AND at>=? AND task_id IS NULL ORDER BY at, rowid`).all(org, repositoryId, issue, since);
      const threshold = issue === 'other' ? 1 : 3;
      if (rows.length < threshold) return { task: undefined, duplicate: !!existing, reportCount: rows.length };
      const batch = rows.slice(0, threshold);
      const reports = batch.map(row => JSON.parse(String(row.data)) as FeedbackInput);
      const signal = { issue, reportCount: batch.length, windowMinutes: 30, reportIds: batch.map(row => String(row.id)) };
      const task = makeTask({ source: 'complaint-surge', externalId: String(batch[0]!.id), title: reports[0]!.title,
        text: `${batch.length} customer report(s) in 30 minutes about ${issue}.\n\n${reports.map((report, i) => `Report ${i + 1}: ${report.text.slice(0, 3000)}`).join('\n\n')}` }, signal);
      this.createInside(task);
      for (const row of batch) this.db.prepare('UPDATE complaints SET task_id=? WHERE id=?').run(task.id, String(row.id));
      return { task, duplicate: !!existing, reportCount: batch.length };
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

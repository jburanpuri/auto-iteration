import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { DomainError, inputSchema, latestPlan, proposalSchema, requireState,
  type Actor, type Repository, type Task, type Job } from './domain.js';
import type { EngineeringProvider } from './providers.js';
import { baseCommit, collectChanges, isolatedCheckout } from './git.js';

export class Engine {
  constructor(readonly store: Store, readonly organizationId: string, readonly repo: Repository,
    readonly provider: EngineeringProvider, readonly root: string,
    private clock: () => Date = () => new Date()) {}
  private at() { return this.clock().toISOString(); }
  private authorize(actor: Actor) {
    if (actor.organizationId !== this.organizationId) throw new DomainError('Actor belongs to another organization.');
  }
  submit(input: unknown) {
    const feedback = inputSchema.parse(input);
    const task: Task = { id: randomUUID(), organizationId: this.organizationId, repositoryId: this.repo.id,
      feedback, status: 'received', revision: 0, createdAt: this.at(), updatedAt: this.at(), comments: [], plans: [] };
    return this.store.create(task);
  }
  get(id: string) { return this.store.get(id, this.organizationId); }
  comment(id: string, actor: Actor, text: string, receiptId?: string) {
    this.authorize(actor);
    if (!text.trim() || text.length > 8000) throw new DomainError('Comments must contain 1–8000 characters.');
    return this.store.mutate(id, this.organizationId, { type: 'discussion.comment', actor: actor.id, at: this.at() }, task => {
      requireState(task, ['discussing']);
      task.comments.push({ author: actor.id, text: text.trim(), at: this.at() });
    }, undefined, receiptId);
  }
  revise(id: string, actor: Actor, expectedVersion: number) {
    this.authorize(actor);
    return this.store.mutate(id, this.organizationId, { type: 'proposal.revision_requested', actor: actor.id, at: this.at() }, task => {
      requireState(task, ['discussing', 'failed']);
      if ((task.plans.at(-1)?.version ?? 0) !== expectedVersion) throw new DomainError('Outdated plan version. Refresh the task.');
      task.status = 'revising';
      delete task.approval;
      delete task.error;
    }, 'investigate');
  }
  approve(id: string, actor: Actor, expectedVersion: number) {
    this.authorize(actor);
    if (!actor.canApprove) throw new DomainError('This engineer is not an authorized approver.');
    const current = this.get(id);
    // Re-delivered approval is a no-op, never a second execution.
    if (current.approval?.version === expectedVersion && ['approved', 'implementing', 'changes_ready'].includes(current.status)) return current;
    return this.store.mutate(id, this.organizationId, { type: 'proposal.approved', actor: actor.id, at: this.at() }, task => {
      requireState(task, ['discussing']);
      const plan = latestPlan(task);
      if (plan.disposition !== 'code_change') throw new DomainError('This proposal is not an actionable code change. Clarify or decline it.');
      if (plan.version !== expectedVersion) throw new DomainError('Outdated plan version. Approve the latest proposal.');
      if (Date.parse(plan.expiresAt) <= this.clock().getTime()) throw new DomainError('Proposal expired. Request a revised proposal.');
      if (task.comments.length !== plan.commentCount) throw new DomainError('New discussion is not reflected in this plan. Revise it before approval.');
      task.approval = { actorId: actor.id, version: plan.version, at: this.at() };
      task.status = 'approved';
    }, 'implement');
  }
  decline(id: string, actor: Actor) {
    this.authorize(actor);
    return this.store.mutate(id, this.organizationId, { type: 'proposal.declined', actor: actor.id, at: this.at() }, task => {
      requireState(task, ['discussing']);
      task.status = 'declined';
    });
  }
  attachSlack(id: string, thread: string) {
    return this.store.mutate(id, this.organizationId, { type: 'slack.thread_attached', actor: 'slack', at: this.at() }, task => {
      if (task.slackThread && task.slackThread !== thread) throw new DomainError('Task already belongs to another Slack thread.');
      task.slackThread = thread;
    });
  }
  pendingJobs() { return this.store.jobs(this.organizationId).filter(job => job.status === 'pending'); }
  async drain() {
    for (const job of this.pendingJobs()) await this.runJob(job.id);
  }
  async runJob(id: string): Promise<Task | undefined> {
    const job = this.store.claimJob(id, this.organizationId);
    if (!job) return; // Another delivery or worker already claimed it.
    try {
      let task = this.get(job.taskId);
      if (task.repositoryId !== this.repo.id) throw new DomainError('Task repository does not match the configured executor.');
      if (job.kind === 'investigate') {
        task = this.transition(job, ['received', 'revising'], 'investigating');
        const commit = await baseCommit(this.repo);
        // Revision investigations must use the current base, not the previous proposal's checkout.
        const snapshot = { ...task, plans: [] };
        const workspace = await isolatedCheckout(this.repo, snapshot, this.root, `investigate-${job.id}`);
        const proposal = proposalSchema.parse(await this.provider.investigate(task, workspace));
        if (await baseCommit(this.repo) !== commit) throw new DomainError('Repository base moved during investigation. Revise again.');
        this.store.mutate(task.id, this.organizationId, { type: 'proposal.prepared', actor: this.provider.label, at: this.at() }, task => {
          requireState(task, ['investigating']);
          task.plans.push({ ...proposal, version: task.plans.length + 1, baseCommit: commit,
            expiresAt: new Date(this.clock().getTime() + 24 * 60 * 60_000).toISOString(), commentCount: task.comments.length });
          task.status = 'discussing';
        });
      } else {
        const plan = latestPlan(task);
        if (!task.approval || task.approval.version !== plan.version) throw new DomainError('No approval for this plan version.');
        if (Date.parse(plan.expiresAt) <= this.clock().getTime()) throw new DomainError('Approved plan expired before execution. Revise and approve again.');
        if (await baseCommit(this.repo) !== plan.baseCommit) throw new DomainError('Repository base changed since investigation. Revise and approve again.');
        task = this.transition(job, ['approved'], 'implementing');
        const workspace = await isolatedCheckout(this.repo, task, this.root, `implement-${job.id}`);
        await this.provider.implement(task, workspace);
        const result = await collectChanges(this.repo, task, workspace, this.root);
        this.store.mutate(task.id, this.organizationId, { type: 'changes.ready', actor: 'executor', at: this.at() }, task => {
          requireState(task, ['implementing']);
          task.result = result;
          task.status = 'changes_ready';
        });
      }
      this.store.finishJob(job);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown worker failure';
      this.store.mutate(job.taskId, this.organizationId, { type: 'job.failed', actor: 'executor', at: this.at(), detail: message }, task => {
        task.status = 'failed'; task.error = message;
      });
      this.store.finishJob(job, message);
    }
    return this.get(job.taskId);
  }
  private transition(job: Job, from: Task['status'][], status: Task['status']) {
    return this.store.mutate(job.taskId, this.organizationId, { type: `job.${job.kind}_started`, actor: 'worker', at: this.at() }, task => {
      requireState(task, from); task.status = status;
    });
  }
}

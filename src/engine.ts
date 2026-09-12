import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { DomainError, inputSchema, latestPlan, proposalSchema, requireState,
  type Actor, type Repository, type Task, type Job, type FeedbackInput, type Issue } from './domain.js';
import type { EngineeringProvider } from './providers.js';
import type { ConversationProvider } from './conversation.js';
import { baseCommit, collectChanges, isolatedCheckout } from './git.js';

export class Engine {
  constructor(readonly store: Store, readonly organizationId: string, readonly repo: Repository,
    readonly provider: EngineeringProvider, readonly root: string,
    private clock: () => Date = () => new Date(), readonly conversation?: ConversationProvider) {}
  private at() { return this.clock().toISOString(); }
  private authorize(actor: Actor) {
    if (actor.organizationId !== this.organizationId) throw new DomainError('Actor belongs to another organization.');
  }
  submit(input: unknown) {
    const feedback = inputSchema.parse(input);
    return this.store.create(this.newTask(feedback));
  }
  demoReview(input: unknown, issue: Issue, sample = false, investigateOther = false) {
    const feedback = inputSchema.parse(input);
    // Transparent demo rules, not an AI-authorship detector or production spam classifier.
    const spam = /guaranteed.{0,20}(profit|income)|buy followers|click here.{0,40}crypto/i.test(`${feedback.title} ${feedback.text}`);
    const disposition = spam ? 'quarantined' : issue !== 'csv_export' && (!investigateOther || sample) ? 'backlog' : sample ? 'sample' : 'investigating';
    return this.store.demoReview(this.organizationId, this.repo.id, {
      id: randomUUID(), feedback, issue, sample, at: this.at(), disposition,
      reason: spam ? 'Promotional spam phrase matched a demo rule; retained for review.' : disposition === 'backlog'
        ? 'Feature request saved for product review; outside this bug walkthrough.' : sample
          ? 'Labeled sample report. Waiting for your submission to start investigation.'
          : 'One report starts investigation in this demo. Implementation still requires engineer approval.',
    }, reports => ({ ...this.newTask({ ...feedback, text: reports.map(report =>
      `${report.sample ? '[Sample]' : '[Submitted]'} ${report.feedback.title}\n${report.feedback.text}`).join('\n\n').slice(0, 12000) }),
      signal: { issue, reportCount: reports.length, windowMinutes: 30, reportIds: reports.map(report => report.id) } }));
  }
  private newTask(feedback: FeedbackInput): Task {
    const task: Task = { id: randomUUID(), organizationId: this.organizationId, repositoryId: this.repo.id,
      feedback, status: 'received', revision: 0, createdAt: this.at(), updatedAt: this.at(), comments: [], plans: [] };
    return task;
  }
  report(input: unknown, issue: Issue) {
    const feedback = inputSchema.parse(input);
    return this.store.escalate(this.organizationId, this.repo.id, feedback, issue, this.at(),
      (feedback, signal) => ({ ...this.newTask(feedback), signal }));
  }
  evidence(task: Task) {
    const logs = this.store.logs(this.organizationId, this.repo.id, new Date(this.clock().getTime() - 30 * 60_000).toISOString());
    return { signal: task.signal ?? null, logs: task.signal && task.signal.issue !== 'other' ? logs.filter(log => log.issue === task.signal!.issue) : logs };
  }
  async answer(task: Task) {
    if (this.conversation) {
      const result = await this.conversation.answer(task, this.evidence(task));
      this.store.mutate(task.id, this.organizationId, { type: 'conversation.reply', actor: this.conversation.label, at: this.at() }, current => {
        current.agentNotes ??= [];
        current.agentNotes.push({ ...result, at: this.at(), commentCount: task.comments.length });
      });
      return result.reply;
    }
    let reply = 'Scripted rehearsal: your comment is saved. Request a revised plan to include it; mentioning headers selects the header-preserving fixture.';
    if (this.provider.discuss) {
      const workspace = await isolatedCheckout(this.repo, task, this.root, `discussion-${randomUUID()}`);
      reply = await this.provider.discuss(task, workspace, this.evidence(task));
    }
    this.store.mutate(task.id, this.organizationId, { type: 'conversation.reply', actor: this.provider.label, at: this.at() }, current => {
      current.agentNotes ??= [];
      current.agentNotes.push({ reply, codexBrief: '', at: this.at(), commentCount: task.comments.length });
    });
    return reply;
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
  attachDiscord(id: string, location: NonNullable<Task['discord']>) {
    return this.store.mutate(id, this.organizationId, { type: 'discord.attached', actor: 'discord', at: this.at() }, task => {
      if (task.discord && JSON.stringify(task.discord) !== JSON.stringify(location)) {
        throw new DomainError('Task already belongs to another Discord message.');
      }
      task.discord = location;
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
        const proposal = proposalSchema.parse(await this.provider.investigate(task, workspace, this.evidence(task)));
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

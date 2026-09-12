import { DomainError, type Task } from './domain.js';
import type { Engine } from './engine.js';
import { formatTask } from './format.js';

export type DiscordInput = {
  id: string; guildId: string | null; channelId: string; authorId: string;
  bot: boolean; webhook?: boolean; content: string; replyTo?: string;
};
export type DiscordConfig = { guildId: string; channelId: string; approverIds: Set<string>; botId: string;
  route?: (task: Task) => string; consoleUrl?: string };
export type DiscordTransport = { send(text: string, replyTo?: string, controls?: { taskId: string; version: number }): Promise<string[]> };
type Command = { kind: 'feedback'; text: string } |
  { kind: 'changes'; version: number; text: string } |
  { kind: 'revise' | 'approve'; version: number } | { kind: 'status' | 'help' | 'decline' };

export function parseDiscordCommand(text: string, botId: string): Command | undefined {
  const prefix = new RegExp(`^<@!?${botId}>\\s*`);
  if (!prefix.test(text.trim())) return;
  const input = text.trim().replace(prefix, '');
  if (/^feedback\s+\S/i.test(input)) return { kind: 'feedback', text: input.replace(/^feedback\s+/i, '') };
  const changes = /^changes\s+v?(\d+)\s+([\s\S]+)$/i.exec(input);
  if (changes && Number.isSafeInteger(Number(changes[1]))) return { kind: 'changes', version: Number(changes[1]), text: changes[2]! };
  const match = /^(revise|approve)\s+v?(\d+)$/i.exec(input);
  if (match && Number.isSafeInteger(Number(match[2]))) {
    return { kind: match[1]!.toLowerCase() as 'revise' | 'approve', version: Number(match[2]) };
  }
  if (/^(help|status|decline)$/i.test(input)) return { kind: input.toLowerCase() as 'help' | 'status' | 'decline' };
  throw new DomainError('Use @bot feedback <report>, status, revise <version>, approve <version>, or decline. Approval needs an exact version.');
}

/** All five engineers and the bot use the same channel; replies identify a task. */
export class DiscordController {
  readonly scope: string;
  private conversations = new Map<string, Promise<void>>();
  constructor(readonly engine: Engine, readonly config: DiscordConfig, private transport: DiscordTransport) {
    this.scope = `${config.guildId}:${config.channelId}`;
  }
  private tasks() {
    return this.engine.store.list(this.engine.organizationId).filter(task => task.repositoryId === this.engine.repo.id);
  }
  private attached(task: Task) {
    return task.discord?.guildId === this.config.guildId && task.discord.channelId === this.config.channelId;
  }
  private async post(text: string, task?: Task, replyTo?: string, controls = false) {
    const ids = await this.transport.send(text, replyTo ?? task?.discord?.messageId,
      controls && task?.plans.at(-1) ? { taskId: task.id, version: task.plans.at(-1)!.version } : undefined);
    if (task) for (const id of ids) this.engine.store.linkDiscordMessage(this.scope, id, task.id);
    return ids;
  }
  async announce(task: Task) {
    if (task.discord) return;
    const ids = await this.post(`New customer feedback: ${task.feedback.title}\n${task.feedback.text}\n\nTask: ${task.id}\n${this.engine.provider.label}\nI will post a proposal here. Reply to its message to discuss this task.`, task);
    if (!ids[0]) throw new Error('Discord did not return a message ID.');
    this.engine.attachDiscord(task.id, { guildId: this.config.guildId, channelId: this.config.channelId, messageId: ids[0] });
  }
  private findTask(message: DiscordInput): Task | undefined {
    if (message.replyTo) {
      const task = this.engine.store.discordTask(this.scope, message.replyTo, this.engine.organizationId);
      if (!task || !this.attached(task) || task.repositoryId !== this.engine.repo.id) {
        throw new DomainError('That reply is not linked to a feedback task. Reply to a proposal from this bot.');
      }
      return task;
    }
    const active = this.tasks().filter(task => this.attached(task) && !['changes_ready', 'declined'].includes(task.status));
    if (active.length === 1) return active[0];
    if (active.length > 1) throw new DomainError('Several feedback tasks are open. Use Discord Reply on the relevant proposal so I know which task you mean.');
    return undefined;
  }
  async handle(message: DiscordInput) {
    if (message.guildId !== this.config.guildId || message.channelId !== this.config.channelId ||
        message.bot || message.webhook || !message.content.trim()) return;
    const receipt = `discord-in:${this.scope}:${message.id}`;
    if (this.engine.store.hasReceipt(receipt)) return;
    let task: Task | undefined;
    try {
      const command = parseDiscordCommand(message.content, this.config.botId);
      if (command?.kind === 'help') {
        await this.post(`Submit feedback on the CRM page, or @bot feedback <report>.\nReply to a proposal to discuss it. @bot revise 1 incorporates comments; @bot approve 2 approves exactly v2.\nOther commands: @bot status, @bot decline. Only configured engineers can approve.\n${this.engine.provider.label}`, undefined, message.id);
      } else if (command?.kind === 'feedback') {
        task = this.engine.submit({ source: `discord:${this.scope}`, externalId: message.id,
          title: command.text.slice(0, 180), text: command.text }).task;
        await this.post(`Feedback accepted. Codex will investigate and post the proposal in its owning team's channel.\nTask: ${task.id}`, undefined, message.id);
      } else {
        task = this.findTask(message);
        if (!task) {
          if (command) throw new DomainError('Reply to a feedback proposal, or start with @bot feedback <report>.');
          return;
        }
        const actor = { id: message.authorId, organizationId: this.engine.organizationId,
          canApprove: this.config.approverIds.has(message.authorId) };
        if (!command) {
          this.engine.comment(task.id, actor, message.content, receipt);
          this.engine.store.linkDiscordMessage(this.scope, message.id, task.id);
          await this.post('Discussion recorded. Request a revised plan before approving.', task, message.id);
          const taskId = task.id;
          const discussionSnapshot = this.engine.get(taskId);
          const previous = this.conversations.get(taskId) ?? Promise.resolve();
          const response = previous.then(async () => {
            const answer = await this.engine.answer(discussionSnapshot);
            await this.post(answer, this.engine.get(taskId), message.id);
          }).catch(async error => {
            await this.post(`Your comment is saved, but I could not answer: ${error.message}`, this.engine.get(taskId), message.id);
          });
          this.conversations.set(taskId, response);
          void response.finally(() => { if (this.conversations.get(taskId) === response) this.conversations.delete(taskId); }).catch(() => {});
        } else {
          if (command.kind === 'changes') {
            if (task.plans.at(-1)?.version !== command.version) throw new DomainError('Outdated plan version. Request changes against the latest proposal.');
            this.engine.comment(task.id, actor, command.text, receipt);
            await this.conversations.get(task.id)?.catch(() => undefined);
            try { await this.engine.answer(this.engine.get(task.id)); }
            catch { await this.post('Your requested changes are saved. The conversation provider is unavailable; Codex will receive your original feedback.', task); }
            this.engine.revise(task.id, actor, command.version);
          }
          if (command.kind === 'revise') {
            // Finish the conversational handoff before Codex snapshots its next investigation.
            await this.conversations.get(task.id)?.catch(() => undefined);
            this.engine.revise(task.id, actor, command.version);
          }
          if (command.kind === 'approve') this.engine.approve(task.id, actor, command.version);
          if (command.kind === 'decline') this.engine.decline(task.id, actor);
          await this.post(formatTask(this.engine.get(task.id)), task, message.id);
        }
      }
      this.engine.store.recordReceipt(receipt);
    } catch (error) {
      await this.post(error instanceof Error ? error.message : 'Could not process that message.', task, message.id);
      this.engine.store.recordReceipt(receipt);
    }
  }
  async sync() {
    for (let task of this.tasks().reverse()) {
      const investigatingKey = `discord-investigating:${this.scope}:${task.id}:${task.plans.length}`;
      if (['received', 'investigating', 'revising'].includes(task.status) &&
          (task.discord ? this.attached(task) : (this.config.route?.({ ...task, plans: [] }) ?? this.config.channelId) === this.config.channelId) &&
          !this.engine.store.hasReceipt(investigatingKey)) {
        await this.post(`${task.signal ? `${task.signal.reportCount} customer reports in ${task.signal.windowMinutes} minutes. ` : ''}I'm investigating: ${task.feedback.title}\nI'll check the repository and available product logs, then post the evidence and proposed fix in the owning team's channel.`, task);
        this.engine.store.recordReceipt(investigatingKey);
      }
      // HTTP feedback needs an announcement too. Do not mirror Slack conversations.
      const destination = this.config.route?.(task) ?? this.config.channelId;
      if (!task.discord && !task.slackThread && destination === this.config.channelId &&
          ['discussing', 'failed'].includes(task.status)) {
        await this.announce(task);
        task = this.engine.get(task.id);
      }
      if (!this.attached(task) || !['discussing', 'changes_ready', 'failed', 'declined'].includes(task.status)) continue;
      const signature = `discord-state:${this.scope}:${task.id}:${task.status}:${task.plans.at(-1)?.version ?? 0}:${task.error ?? ''}`;
      if (this.engine.store.hasReceipt(signature)) continue;
      const instructions = task.status === 'discussing'
        ? `\n\nApprove plan v${task.plans.at(-1)?.version} or request changes using the buttons below. You can also reply here to discuss the implementation.`
        : task.status === 'changes_ready' ? `\n\nInspect the patch, tests, and fixed preview in the engineer console on the demo laptop: ${this.config.consoleUrl ?? 'http://127.0.0.1:4319/'}` : '';
      await this.post(`${formatTask(task)}${instructions}`, task, undefined, task.status === 'discussing');
      this.engine.store.recordReceipt(signature);
    }
  }
  async stop() { await Promise.allSettled(this.conversations.values()); }
}

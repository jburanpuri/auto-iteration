import { DomainError, type Task } from './domain.js';
import type { Engine } from './engine.js';
import { formatDiscordTask } from './format.js';

export type DiscordInput = {
  id: string; guildId: string | null; channelId: string; authorId: string;
  bot: boolean; webhook?: boolean; content: string; replyTo?: string;
};
export type DiscordConfig = { guildId: string; channelId: string; approverIds: Set<string>; botId: string;
  route?: (task: Task) => string; consoleUrl?: string };
export type DiscordControls = { taskId: string; version: number; canApprove: boolean; needsClarification: boolean };
export type DiscordTransport = { send(text: string, replyTo?: string, controls?: DiscordControls): Promise<string[]> };
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
  private async post(text: string, task?: Task, replyTo?: string, showControls = false) {
    const plan = task?.plans.at(-1);
    const controls = showControls && task && plan && task.status === 'discussing' && plan.disposition !== 'non_code'
      ? { taskId: task.id, version: plan.version, needsClarification: plan.disposition === 'needs_clarification',
          canApprove: plan.disposition === 'code_change' && plan.commentCount === task.comments.length && Date.parse(plan.expiresAt) > Date.now() }
      : undefined;
    const ids = await this.transport.send(text, replyTo ?? task?.discord?.messageId, controls);
    if (task) for (const id of ids) this.engine.store.linkDiscordMessage(this.scope, id, task.id);
    return ids;
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
        await this.post(`Submit feedback on the Northstar page, or @bot feedback <report>.\nReply to a proposal to discuss it. @bot revise 1 incorporates comments; @bot approve 2 approves exactly v2.\nOther commands: @bot status, @bot decline. Only configured engineers can approve.\n${this.engine.provider.label}`, undefined, message.id);
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
          if (command.kind === 'status') await this.post(formatDiscordTask(this.engine.get(task.id), this.config.consoleUrl), task, message.id, true);
          else if (command.kind === 'approve') await this.post(`Plan v${command.version} approved. Implementation and tests are queued.`, task, message.id);
          else if (command.kind === 'revise' || command.kind === 'changes') await this.post('Updating the proposal with your feedback. I’ll post the revised plan here.', task, message.id);
        }
      }
      this.engine.store.recordReceipt(receipt);
    } catch (error) {
      await this.post(error instanceof Error ? error.message : 'Could not process that message.', task, message.id);
      this.engine.store.recordReceipt(receipt);
    }
  }
  async sync() {
    if(this.engine.maintenance)return;
    for (let task of this.tasks().reverse()) {
      if (task.slackThread || !['discussing', 'changes_ready', 'failed', 'declined'].includes(task.status)) continue;
      const destination = this.config.route?.(task) ?? this.config.channelId;
      if (task.discord ? !this.attached(task) : destination !== this.config.channelId) continue;
      // Keep the existing receipt key so restarting does not replay old proposals.
      const signature = `discord-state:${this.scope}:${task.id}:${task.status}:${task.plans.at(-1)?.version ?? 0}:${task.error ?? ''}${task.publication ? `:${task.publication.status}` : ''}`;
      if (this.engine.store.hasReceipt(signature)) continue;
      const prefix = /SCRIPTED/.test(this.engine.provider.label) ? '[Scripted rehearsal]\n' : '';
      const ids = await this.post(`${prefix}${formatDiscordTask(task, this.config.consoleUrl)}`, task, undefined, true);
      if (!task.discord) {
        if (!ids[0]) throw new Error('Discord did not return a message ID.');
        this.engine.attachDiscord(task.id, { guildId: this.config.guildId, channelId: this.config.channelId, messageId: ids[0] });
      }
      this.engine.store.recordReceipt(signature);
    }
  }
  async stop() { await Promise.allSettled(this.conversations.values()); }
}

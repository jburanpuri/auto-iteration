import { DomainError } from './domain.js';
export type SlackCommand = { kind: 'feedback'; text: string } |
  { kind: 'revise' | 'approve'; version: number } | { kind: 'status' | 'decline' | 'help' };
export function parseSlackCommand(text: string): SlackCommand {
  const input = text.replace(/<@[A-Z0-9]+>/g, '').trim();
  if (/^feedback\s+/i.test(input)) {
    const body = input.replace(/^feedback\s+/i, '').trim();
    if (body.length > 12_000) throw new DomainError('Feedback must be at most 12000 characters.');
    return { kind: 'feedback', text: body };
  }
  const versioned = /^(approve|revise)\s+v?(\d+)$/i.exec(input);
  if (versioned) return { kind: versioned[1]!.toLowerCase() as 'approve' | 'revise', version: Number(versioned[2]) };
  if (/^(status|decline|help)$/i.test(input)) return { kind: input.toLowerCase() as 'status' | 'decline' | 'help' };
  throw new DomainError('Use feedback <report>, status, revise <version>, approve <version>, or decline. Approval requires an explicit version.');
}
// Disable Slack control syntax in customer/LLM text (e.g. <!channel>).
export function escapeSlack(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

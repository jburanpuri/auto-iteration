import { z } from 'zod';

export class DomainError extends Error {}
export const inputSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(12_000),
}).strict();
export type FeedbackInput = z.infer<typeof inputSchema>;
export type DemoReview = {
  id: string; feedback: FeedbackInput; issue: string; at: string; sample: boolean;
  disposition: 'sample' | 'investigating' | 'grouped' | 'backlog' | 'quarantined';
  reason: string; taskId?: string;
};
export const issueSchema = z.enum(['csv_export', 'filter_reset', 'search_latency', 'other']);
export type Issue = z.infer<typeof issueSchema>;
export const logSchema = z.object({
  id: z.string().uuid(), issue: issueSchema, event: z.enum(['export_failed', 'export_succeeded', 'search_completed']),
  message: z.string().max(1000), durationMs: z.number().nonnegative().max(60000).optional(),
  rowCount: z.number().int().nonnegative().max(100000).optional(), stack: z.string().max(3000).optional(),
}).strict();
export type ProductLog = z.infer<typeof logSchema> & { at: string };
export const proposalSchema = z.object({
  disposition: z.enum(['code_change', 'needs_clarification', 'non_code']),
  team: z.enum(['engineering', 'ui_ux', 'performance']),
  routingReason: z.string().min(1).max(1000),
  summary: z.string().min(1).max(4000),
  evidence: z.array(z.string().max(2000)).min(1).max(20),
  steps: z.array(z.string().max(2000)).min(1).max(20),
  acceptanceCriteria: z.array(z.string().max(2000)).min(1).max(20),
}).strict();
export type Proposal = z.infer<typeof proposalSchema>;
export type Status = 'received' | 'investigating' | 'discussing' | 'revising' |
  'approved' | 'implementing' | 'changes_ready' | 'failed' | 'declined';
export type Actor = { id: string; organizationId: string; canApprove: boolean };
export type Comment = { author: string; text: string; at: string };
export type Plan = Proposal & {
  version: number; baseCommit: string; expiresAt: string; commentCount: number;
};
export type ChangeResult = {
  branch: string; workspace: string; patchPath: string; summaryPath: string;
  testOutputPath: string; testCommand: string[];
};
export type Task = {
  id: string; organizationId: string; repositoryId: string;
  feedback: FeedbackInput; status: Status; revision: number;
  createdAt: string; updatedAt: string; comments: Comment[]; plans: Plan[];
  approval?: { actorId: string; version: number; at: string };
  result?: ChangeResult; error?: string; slackThread?: string;
  discord?: { guildId: string; channelId: string; messageId: string };
  signal?: { issue: Issue; reportCount: number; windowMinutes: number; reportIds: string[] };
  agentNotes?: { reply: string; codexBrief: string; at: string; commentCount: number }[];
};
export type Job = {
  id: string; taskId: string; kind: 'investigate' | 'implement';
  status: 'pending' | 'running' | 'done' | 'failed';
  createdAt: string; error?: string; workerPid?: number;
};
export type Audit = { type: string; actor: string; at: string; detail?: string };
export type Repository = { id: string; path: string; baseRef: string; testCommand: string[] };

export function latestPlan(task: Task): Plan {
  const plan = task.plans.at(-1);
  if (!plan) throw new DomainError('This task has no proposal yet.');
  return plan;
}
export function requireState(task: Task, states: Status[]) {
  if (!states.includes(task.status)) throw new DomainError(`Task is ${task.status}; expected ${states.join(' or ')}.`);
}

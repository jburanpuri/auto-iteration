import type { Task } from './domain.js';
export function formatTask(task: Task): string {
  const plan = task.plans.at(-1);
  return [
    `${task.feedback.title} [${task.status}]`, `Task: ${task.id}`,
    ...(plan ? [`Proposed solution · v${plan.version}: ${plan.summary}`,
      ...(plan.classification ? [`Classification: ${plan.classification.kind} — ${plan.classification.issue}`] : []),
      ...(plan.team ? [`Suggested team: ${plan.team}. ${plan.routingReason}`] : []), '', 'Acceptance criteria:',
      ...plan.acceptanceCriteria.map(item => `- ${item}`), '', 'Code evidence:', ...plan.evidence.map(item => `- ${item}`),
      '', 'Implementation plan:', ...plan.steps.map(item => `- ${item}`),
      `Expires: ${plan.expiresAt}`,
      ...(plan.commentCount < task.comments.length ? ['New discussion needs to be incorporated. Request revise before approving.'] : [])] : []),
    ...(task.error ? [`Failure: ${task.error}`] : []),
    ...(task.result ? [`Review: ${task.result.summaryPath}`, `Patch: ${task.result.patchPath}`,
      `Tests: ${task.result.testOutputPath}`, 'Local changes ready; no remote PR created.'] : []),
  ].join('\n');
}

function brief(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`;
}

/** A decision-sized Discord message. Full evidence and test plans stay in the console. */
export function formatDiscordTask(task: Task, consoleUrl?: string): string {
  const plan = task.plans.at(-1);
  const title = brief(task.feedback.title, 160);
  const confidence = plan?.confidence;
  const trust = confidence ? `• **Non-spam confidence:** ${confidence.legitimacy === 'sample' ? 'Sample data — authenticity not scored' : confidence.legitimacy}. ${brief(confidence.legitimacyReason, 140)}\n• **Issue confidence:** ${confidence.issue}. ${brief(confidence.issueReason, 170)}` : '• **Confidence:** Not assessed in this older proposal. Request a revised plan.';
  const detailLink = consoleUrl ? `\n\nFull details: ${consoleUrl}` : '';
  if (task.status === 'failed') return `**Needs attention**\n${title}\n\n${brief(task.error || 'The investigation could not finish.', 600)}${detailLink}`;
  if (task.publication?.status === 'published') return `**Fix is live**\n${title}\n\nRepository tests passed.\n${task.publication.url}`;
  if (task.publication?.status === 'failed') return `**Tests passed; publication needs attention**\n${title}\n\n${brief(task.publication.error || 'Deployment failed.', 400)}${detailLink}`;
  if (task.status === 'changes_ready') return `**Tested change ready**\n${title}\n\n${brief(plan?.summary || 'The approved change is ready for review.', 400)}\nRepository tests passed. Open the preview and patch in the engineer console.${detailLink}`;
  if (task.status === 'declined') return `**Closed without implementation**\n${title}`;
  if (task.status === 'approved' || task.status === 'implementing') return `Plan v${plan?.version} approved. Implementation and tests are ${task.status === 'approved' ? 'queued' : 'running'}.`;
  if (!plan) return `Feedback received: ${title}`;
  if (plan.disposition === 'needs_clarification') {
    const questions = plan.steps.filter(step => /\?|clarif|which |what |where |please provide/i.test(step)).slice(0, 2);
    return [`**Needs clarification · v${plan.version}**`, title, '', brief(plan.summary, 300), trust, '',
      ...questions.map(question => `• ${brief(question.replace(/^Clarify:\s*/i, ''), 240)}`),
      '', 'Add details below so Codex can investigate further. No code change is ready to approve.', detailLink].join('\n');
  }
  if (plan.disposition === 'non_code') return `**For team review · v${plan.version}**\n${title}\n\n${brief(plan.summary, 350)}\n${trust}\n\nNo code change proposed. Reply to discuss.${detailLink}`;
  // Prefer a concrete code finding over missing-telemetry boilerplate when available.
  const finding = plan.evidence.find(item => /\.(?:[cm]?[jt]sx?|py|go|rs|html|css|sql)(?::\d+)?/i.test(item)) ?? plan.evidence[0];
  const stale = plan.commentCount !== task.comments.length || Date.parse(plan.expiresAt) <= Date.now();
  return [`**Proposed fix · v${plan.version}**`, title, '', `• **Issue:** ${brief(plan.classification?.issue || title, 140)} (${task.signal?.reportCount || 1} reports)`, `• **Proposed fix:** ${brief(plan.summary, 280)}`,
    `• **Code evidence:** ${brief(finding || 'See the investigation details.', 240)}`, trust,
    `• **Validation planned:** ${brief(plan.acceptanceCriteria.slice(0, 2).join(' '), 180)}`, '',
    stale ? 'The plan needs updating before approval. Request changes below.' : `Approve v${plan.version} or request changes below.`, detailLink].join('\n');
}

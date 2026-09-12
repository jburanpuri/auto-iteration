import type { Task } from './domain.js';
export function formatTask(task: Task): string {
  const plan = task.plans.at(-1);
  return [
    `${task.feedback.title} [${task.status}]`, `Task: ${task.id}`,
    ...(plan ? [`Plan v${plan.version} (${plan.disposition}): ${plan.summary}`, '', 'Acceptance criteria:',
      ...plan.acceptanceCriteria.map(item => `- ${item}`), '', 'Evidence:', ...plan.evidence.map(item => `- ${item}`),
      `Expires: ${plan.expiresAt}`,
      ...(plan.commentCount < task.comments.length ? ['New discussion needs to be incorporated. Request revise before approving.'] : [])] : []),
    ...(task.error ? [`Failure: ${task.error}`] : []),
    ...(task.result ? [`Review: ${task.result.summaryPath}`, `Patch: ${task.result.patchPath}`,
      `Tests: ${task.result.testOutputPath}`, 'Local changes ready; no remote PR created.'] : []),
  ].join('\n');
}

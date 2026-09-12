import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DomainError, type Repository, type Task, latestPlan, type ChangeResult } from './domain.js';

const exec = promisify(execFile);
export async function command(cwd: string, executable: string, args: string[], timeout = 120_000) {
  const { stdout, stderr } = await exec(executable, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024,
    env: { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']
      .flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), GIT_TERMINAL_PROMPT: '0', CI: 'true' } });
  return `${stdout}${stderr}`;
}
export async function baseCommit(repo: Repository) {
  if (!/^[\w./-]+$/.test(repo.baseRef) || repo.baseRef.startsWith('-')) throw new DomainError('Invalid base ref.');
  return (await command(repo.path, 'git', ['rev-parse', '--verify', `${repo.baseRef}^{commit}`])).trim();
}
export async function isolatedCheckout(repo: Repository, task: Task, root: string, suffix: string) {
  const workspace = resolve(root, 'workspaces', `${task.id}-${suffix}`);
  await mkdir(resolve(root, 'workspaces'), { recursive: true });
  // Clone committed content only. Never edit the customer's original working tree.
  await command(root, 'git', ['clone', '--no-hardlinks', '--no-checkout', '--', resolve(repo.path), workspace]);
  const commit = task.plans.at(-1)?.baseCommit ?? await baseCommit(repo);
  await command(workspace, 'git', ['checkout', '--detach', commit]);
  // Agent/test processes don't need a push remote. Publication is a separate human action.
  await command(workspace, 'git', ['remote', 'remove', 'origin']);
  return workspace;
}
export async function collectChanges(repo: Repository, task: Task, workspace: string, root: string): Promise<ChangeResult> {
  const plan = latestPlan(task);
  if ((await command(workspace, 'git', ['rev-parse', 'HEAD'])).trim() !== plan.baseCommit) {
    throw new DomainError('Executor changed Git history; manual review required.');
  }
  const [program, ...args] = repo.testCommand;
  if (!program) throw new DomainError('A trusted repository test command is required.');
  const artifacts = resolve(root, 'artifacts', task.id);
  await mkdir(artifacts, { recursive: true });
  const testOutputPath = join(artifacts, 'tests.txt');
  let output: string;
  try { output = await command(workspace, program, args); }
  catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    await writeFile(testOutputPath, `${failure.stdout ?? ''}${failure.stderr ?? ''}`);
    throw new DomainError(`Tests failed or timed out. Logs: ${testOutputPath}. No changes marked ready.`);
  }
  await writeFile(testOutputPath, output);
  // Include newly added files in the review patch without committing anything.
  await command(workspace, 'git', ['add', '--all']);
  const patch = await command(workspace, 'git', ['diff', '--cached', '--binary']);
  if (!patch.trim()) throw new DomainError('Executor produced no changes.');
  const branch = `codex/feedback-${task.id}-v${plan.version}`;
  await command(workspace, 'git', ['checkout', '-b', branch]);
  const patchPath = join(artifacts, 'changes.patch');
  const summaryPath = join(artifacts, 'review.md');
  await writeFile(patchPath, patch);
  await writeFile(summaryPath, [
    `# ${task.feedback.title}`, '', plan.summary, '',
    `Approved by ${task.approval?.actorId}, plan v${plan.version}.`,
    `Base commit: ${plan.baseCommit}`, '', '## Acceptance criteria',
    ...plan.acceptanceCriteria.map(item => `- ${item}`), '',
    '## Validation', `Test command: ${JSON.stringify(repo.testCommand)}`, 'Exit code: 0',
    `Full output: ${testOutputPath}`, '', '## Review',
    `Workspace: ${workspace}`, `Branch: ${branch}`, `Patch: ${patchPath}`, '',
    'This is a local review bundle. No remote PR has been created, merged, or deployed.',
  ].join('\n'));
  return { branch, workspace, patchPath, summaryPath, testOutputPath, testCommand: repo.testCommand };
}

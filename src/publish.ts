import { createHash } from 'node:crypto';
import { writeCloud } from './cloud-storage.js';
import { writeFile, readFile, cp, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { Repository, Task } from './domain.js';
import { DomainError, latestPlan } from './domain.js';
import { command, baseCommit } from './git.js';
import { buildHosted } from '../scripts/build-hosted.js';
const exec = promisify(execFile);
export async function publishApproved(repo: Repository, task: Task, root: string, deployment?: { deploy: (staging: string) => Promise<string>; verify: (url: string, id: string) => Promise<void> }) {
  if(task.status!=='changes_ready'||!task.result||task.approval?.version!==latestPlan(task).version)throw new DomainError('A tested, approved change is required.');
  if(await baseCommit(repo)!==latestPlan(task).baseCommit)throw new DomainError('The live product changed. Revise the proposal before publishing.');
  if((await command(repo.path,'git',['status','--porcelain'])).trim())throw new DomainError('The local product has uncommitted edits. Publication paused.');
  const files=(await command(task.result.workspace,'git',['diff','--cached','--name-only'])).trim().split('\n');
  // Only this small static product is eligible for automatic production publication.
  if(files.some(file=>!['index.html','app.mjs','styles.css','export.mjs'].includes(file)&&!/^[-\w]+\.test\.mjs$/.test(file)))throw new DomainError('The patch includes files outside the static demo release scope.');
  await command(task.result.workspace, repo.testCommand[0]!, repo.testCommand.slice(1));
  const staging=await mkdtemp(join(root,'release-'));
  for(const file of ['package.json','vercel.json'])await cp(resolve('hosted',file),join(staging,file));
  await cp(resolve('hosted/api'),join(staging,'api'),{recursive:true});
  await cp(resolve('hosted/.vercel'),join(staging,'.vercel'),{recursive:true});
  await buildHosted(task.result.workspace,staging);
  const record = { taskId:task.id, proposalVersion:latestPlan(task).version, approvedBy:task.approval.actorId,
    baseCommit:latestPlan(task).baseCommit, model:process.env.CODEX_MODEL || 'gpt-6-astra', reasoning:process.env.CODEX_REASONING_EFFORT || 'low',
    codexRun:task.implementationRun, tests:'passed', testCommand:repo.testCommand, publishedAt:new Date().toISOString(),
    patchSha256:createHash('sha256').update(await readFile(task.result.patchPath)).digest('hex'),
    testsSha256:createHash('sha256').update(await readFile(task.result.testOutputPath)).digest('hex') };
  await writeFile(join(staging,'public','release.json'),JSON.stringify(record,null,2));
  if(process.env.HOSTED_DEMO === '1') {
    await writeCloud(`releases/${task.id}/record.json`,record);
    await writeCloud(`releases/${task.id}/patch.json`,{text:await readFile(task.result.patchPath,'utf8')});
    await writeCloud(`releases/${task.id}/tests.json`,{text:await readFile(task.result.testOutputPath,'utf8')});
  }
  // The orchestrator invokes a fixed deployment command. Agent-provided shell commands are never used.
  const output = deployment ? await deployment.deploy(staging) : (await exec('npx',['--yes','vercel@59.16.0','deploy','--prod','--yes','--cwd',staging],{timeout:180000,maxBuffer:2*1024*1024,env:process.env})).stdout;
  const url=output.match(/https:\/\/[^\s]+\.vercel\.app/)?.[0];
  if(!url)throw new DomainError('Deployment returned no URL; inspect Vercel before retrying.');
  const liveUrl=process.env.PUBLIC_DEMO_URL || url;
  if(deployment)await deployment.verify(liveUrl,task.id);
  else {
    const response=await fetch(`${liveUrl}/release.json?task=${task.id}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok || (await response.json() as {taskId?:string}).taskId!==task.id)throw new DomainError('Deployment completed but the live release record could not be verified.');
  }
  // Advance the investigated base so later fixes build on the published version.
  await command(repo.path,'git',['apply','--index',task.result.patchPath]);
  await command(repo.path,'git',['-c','user.name=Northstar release','-c','user.email=demo@example.test','-c','commit.gpgsign=false','commit','-m',`Apply approved fix ${task.id}`]);
  return `${process.env.PUBLIC_DEMO_URL || url}/product/`;
}

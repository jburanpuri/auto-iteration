import { mkdir, readFile, writeFile, readdir, cp, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { REST, Routes } from 'discord.js';
import type { Engine } from './engine.js';
import { DomainError } from './domain.js';
import { command, baseCommit } from './git.js';
import { seedRepository } from './seed.js';
import { buildHosted } from '../scripts/build-hosted.js';
import { discordSettings } from './discord.js';
const exec=promisify(execFile);
export type ResetState={id:string;status:'running'|'complete'|'failed';at:string;message:string;deletedMessages?:number;archive?:string};
export async function clearDemoMessages(archive:string) {
  if(!process.env.DISCORD_BOT_TOKEN)return 0;
  const settings=discordSettings();const rest=new REST({version:'10'}).setToken(settings.token);
  const me=await rest.get(Routes.user()) as {id:string};
  const archived:unknown[]=[];let count=0;
  for(const channel of new Set(Object.values(settings.channels))) {
    let before:string|undefined;
    for(;;) {
      const query=new URLSearchParams({limit:'100',...(before?{before}:{})});
      const messages=await rest.get(Routes.channelMessages(channel),{query}) as {id:string;author:{id:string};content:string}[];
      if(!messages.length)break;
      for(const message of messages)if(message.author.id===me.id) {
        archived.push({channel,...message});
        await writeFile(join(archive,'discord-messages.json'),JSON.stringify(archived,null,2));
        await rest.delete(Routes.channelMessage(channel,message.id));count++;
      }
      before=messages.at(-1)!.id;if(messages.length<100)break;
    }
  }
  return count;
}
export async function resetDemo(engine:Engine,id:string,options:{publish?:boolean;siteDirectory?:string;notify?:(state:ResetState)=>Promise<void>;clearMessages?:(archive:string)=>Promise<number>}={}) {
  if(engine.maintenance)throw new DomainError('A demo reset is already running.');
  if(engine.activeDiscussions || engine.store.jobs(engine.organizationId).some(j=>['pending','running'].includes(j.status)) || engine.store.batches(engine.organizationId,engine.repo.id).some(b=>['pending','summarizing'].includes(b.status)))throw new DomainError('Wait for the current investigation or implementation to finish before resetting.');

  // A persistent receipt prevents redelivery of a completed reset from erasing a subsequent demo.
  if(engine.store.hasReceipt(`reset-complete:${id}`))return engine.resetState;
  engine.maintenance=true;
  const siteDirectory=options.siteDirectory || resolve('hosted');
  const archive=resolve(engine.root,'archives',`${Date.now()}-${id}`);
  let original='';let committed=false;let changed=false;
  const set=async(status:ResetState['status'],message:string,deletedMessages?:number)=>{
    engine.resetState={id,status,message,at:new Date().toISOString(),deletedMessages,archive};
    await writeFile(resolve(engine.root,'reset-state.json'),JSON.stringify(engine.resetState));await options.notify?.(engine.resetState);
  };
  try {
    await mkdir(archive,{recursive:true});original=await baseCommit(engine.repo);
    if((await command(engine.repo.path,'git',['status','--porcelain'])).trim())throw new DomainError('The demo repository has uncommitted edits. Reset paused.');
    await set('running','Restoring the demo bugs…');
    await writeFile(join(archive,'workflow.json'),JSON.stringify(engine.store.archiveDemo(engine.organizationId,engine.repo.id),null,2));
    await writeFile(join(archive,'previous-commit'),original);
    const baselineRoot=await mkdtemp(join(engine.root,'reset-baseline-'));const baseline=await seedRepository(baselineRoot,true);
    changed=true;await command(engine.repo.path,'git',['rm','-r','--ignore-unmatch','.']);
    for(const file of await readdir(baseline.path))if(file!=='.git')await cp(join(baseline.path,file),join(engine.repo.path,file),{recursive:true});
    await command(engine.repo.path,engine.repo.testCommand[0]!,engine.repo.testCommand.slice(1));
    await command(engine.repo.path,'git',['add','--all']);
    await command(engine.repo.path,'git',['-c','user.name=Northstar Demo','-c','user.email=demo@example.test','-c','commit.gpgsign=false','commit','--allow-empty','-m',`Reset demo ${id}`]);committed=true;
    const record={kind:'demo-reset',resetId:id,at:new Date().toISOString(),bugs:['Empty contact CSV export','Contact status filter does not apply','Contact search waits two seconds']};
    await buildHosted(engine.repo.path,siteDirectory);await writeFile(resolve(siteDirectory,'public/release.json'),JSON.stringify(record,null,2));
    if(options.publish) {
      await set('running','Publishing the restored demo…');
      await exec('npx',['--yes','vercel@59.16.0','deploy','--prod','--yes','--cwd',siteDirectory],{timeout:180000,maxBuffer:2*1024*1024,env:process.env});
      let verified=false;
      for(let attempt=0;attempt<8;attempt++) {
        try {const response=await fetch(`${process.env.PUBLIC_DEMO_URL}/release.json?reset=${id}&check=${attempt}`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
          if(response.ok)verified=(await response.json() as {resetId?:string}).resetId===id;}catch{}
        if(verified)break;await new Promise(resolve=>setTimeout(resolve,3000));
      }
      if(!verified)throw new Error('The reset deployment could not be verified. Previous workflow records are preserved; retry reset.');
    }
    await set('running','Archiving the old workflow and clearing demo bot messages…');
    const deleted=await (options.clearMessages??clearDemoMessages)(archive);
    engine.store.clearDemo(engine.organizationId,engine.repo.id);
    engine.store.recordReceipt(`reset-complete:${id}`);
    await set('complete','Demo reset. The bugs are back and all 120 sample reviews are ready for a new workflow.',deleted);
    return engine.resetState;
  } catch(error) {
    // Before publication is attempted, restore the previously clean checkout on a failed reset.
    if(changed&&!committed)await command(engine.repo.path,'git',['reset','--hard',original]);
    await set('failed',error instanceof Error?error.message:'Demo reset failed.');throw error;
  } finally {engine.maintenance=false;}
}

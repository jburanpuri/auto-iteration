import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { DemoProvider } from '../src/providers.js';
import { seedRepository } from '../src/seed.js';
import { baseCommit, command } from '../src/git.js';
import { publishApproved } from '../src/publish.js';

test('release requires approval, passing tests and the current base; verified release advances the local product',async t=>{
  const root=await mkdtemp(join(tmpdir(),'northstar-release-'));const repo=await seedRepository(root,true);const store=new Store(join(root,'db.sqlite'));
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const engine=new Engine(store,'org',repo,new DemoProvider(),root);
  const task=engine.submit({source:'test',externalId:'release',title:'Empty CSV export fails',text:'CSV export fails with no contacts.'}).task;
  let deploys=0;
  const deployment={deploy:async(staging:string)=>{deploys++;const record=JSON.parse(await readFile(join(staging,'public/release.json'),'utf8'));assert.equal(record.taskId,task.id);assert.equal(record.tests,'passed');assert.match(await readFile(join(staging,'public/product/export.mjs'),'utf8'),/rows.length === 0/);return 'https://verified-fixture.vercel.app';},verify:async(_url:string,id:string)=>{assert.equal(id,task.id);}};
  await assert.rejects(publishApproved(repo,task,root,deployment),/approved/);
  await engine.drain();engine.approve(task.id,{id:'test-engineer',organizationId:'org',canApprove:true},1);await engine.drain();
  const ready=engine.get(task.id), before=await baseCommit(repo);
  await writeFile(join(ready.result!.workspace,'release-failure.test.mjs'),"import test from 'node:test';test('fail',()=>{throw new Error('release must stop')});");
  await assert.rejects(publishApproved(repo,ready,root,deployment));assert.equal(deploys,0);
  await rm(join(ready.result!.workspace,'release-failure.test.mjs'));
  const live=await publishApproved(repo,ready,root,deployment);assert.match(live,/\/product\/$/);assert.equal(deploys,1);assert.notEqual(await baseCommit(repo),before);
  assert.match(await readFile(join(repo.path,'export.mjs'),'utf8'),/rows.length === 0/);
  await assert.rejects(publishApproved(repo,ready,root,deployment),/changed/);assert.equal(deploys,1);
});

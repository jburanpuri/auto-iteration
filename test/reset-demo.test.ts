import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { DemoProvider } from '../src/providers.js';
import { seedRepository, fixtureBug } from '../src/seed.js';
import { resetDemo } from '../src/reset-demo.js';

test('reset restores bugs, archives history, clears only the target demo, and preserves delivery receipts',async t=>{
 const root=await mkdtemp(join(tmpdir(),'northstar-reset-'));const repo=await seedRepository(root,true);const store=new Store(join(root,'state.sqlite'));const engine=new Engine(store,'org',repo,new DemoProvider(),root);
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const task=engine.submit({externalId:'report',source:'test',title:'CSV export fails',text:'Empty CSV export fails'}).task;
 let cleared=0;const opts={siteDirectory:join(root,'site'),clearMessages:async()=>{cleared++;return 4;}};
 await assert.rejects(resetDemo(engine,'busy',opts),/Wait/);assert.equal(cleared,0);
 await engine.drain();store.recordReceipt('old-webhook');
 const other=new Engine(store,'other-org',repo,new DemoProvider(),root);other.collect({externalId:'keep',source:'test',title:'Keep',text:'Keep this other tenant report'});
 await resetDemo(engine,'reset-one',opts);
 assert.equal(engine.resetState?.status,'complete');assert.equal(engine.maintenance,false);assert.equal(cleared,1);
 assert.equal(store.list('org').length,0);assert.equal(store.reviews('other-org',repo.id).length,1);assert.equal(store.hasReceipt('old-webhook'),true);
 assert.equal(await readFile(join(repo.path,'export.mjs'),'utf8'),fixtureBug);
 const archives=await readdir(join(root,'archives'));const snapshot=JSON.parse(await readFile(join(root,'archives',archives[0]!,'workflow.json'),'utf8'));
 assert.equal(snapshot.tasks[0].id,task.id);
 await resetDemo(engine,'reset-one',opts);assert.equal(cleared,1);
 engine.collect({externalId:'new-report',source:'test',category:'general',title:'CSV export fails again',text:'Empty export fails'});
 assert.equal(store.queueBatch('org',repo.id,'new-batch').reportIds.length,1);
});

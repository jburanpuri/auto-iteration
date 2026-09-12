import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { DemoProvider } from '../src/providers.js';
import { seedRepository } from '../src/seed.js';
import { validateGrouping } from '../src/review-batch.js';
import type { DemoReview } from '../src/domain.js';
import { formatDiscordTask } from '../src/format.js';

class SummaryProvider extends DemoProvider {
  async summarize(reviews: DemoReview[]) {
    return {groups:[{title:'Empty export fails',category:'general' as const,summary:'Empty contact exports fail.',spam:false,reason:'Two reports describe the same failure.',reportIds:reviews.filter(r=>!r.feedback.text.includes('promotion')).map(r=>r.id)},
      {title:'Promotion',category:'general' as const,summary:'Unrelated promotion.',spam:true,reason:'Unsolicited promotion unrelated to the product.',reportIds:reviews.filter(r=>r.feedback.text.includes('promotion')).map(r=>r.id)}]};
  }
}
test('manual summary groups paraphrases, accounts for all reports, retains spam, and never auto-approves',async t=>{
  const root=await mkdtemp(join(tmpdir(),'northstar-batch-'));const repo=await seedRepository(root,true);const store=new Store(join(root,'db.sqlite'));
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const engine=new Engine(store,'org',repo,new SummaryProvider(),root);
  for(const [i,text] of ['CSV export fails on an empty list','No contacts: export crashes','Unrelated promotion'].entries())engine.collect({externalId:`r${i}`,source:'test',category:'general',title:'Feedback',text});
  assert.equal(engine.pendingJobs().length,0);
  const batch=store.queueBatch('org',repo.id,'batch-one');assert.equal(batch.reportIds.length,3);
  assert.deepEqual(store.queueBatch('org',repo.id,'batch-one'),batch);
  assert.equal(store.queueBatch('org',repo.id,'batch-two').reportIds.length,0);
  await engine.summarizePending();
  const result=store.batches('org',repo.id).find(b=>b.id==='batch-one')!;
  assert.equal(result.status,'ready');assert.equal(result.taskIds.length,1);
  const task=engine.get(result.taskIds[0]!);assert.equal(task.status,'received');assert.equal(task.signal?.reportCount,2);
  assert.equal(store.reviews('org',repo.id).filter(r=>r.disposition==='quarantined').length,1);
  await engine.drain();assert.equal(engine.get(task.id).status,'discussing');assert.equal(engine.get(task.id).approval,undefined);
  const plan=engine.get(task.id);plan.plans[0]!.confidence={legitimacy:'medium',legitimacyReason:'Relevant reports; identities unverified.',issue:'high',issueReason:'Empty rows access throws in export.mjs.'};
  const text=formatDiscordTask(plan);assert.match(text,/Non-spam confidence/);assert.match(text,/Issue confidence/);assert.match(text,/2 reports/);
  const reports=store.reviews('org',repo.id);
  assert.throws(()=>validateGrouping({groups:[]},reports),/omitted/);
  assert.throws(()=>validateGrouping({groups:[{title:'Bad',summary:'Bad',spam:false,reason:'Bad',category:'ui_ux',reportIds:[reports[0]!.id]}]},reports),/category/);
});

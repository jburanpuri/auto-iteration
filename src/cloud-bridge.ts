import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Engine } from './engine.js';
import { inputSchema } from './domain.js';
import { feedbackBatchScenarios } from './demo-feedback.js';
import { listCloud, readCloud, writeCloud } from './cloud-storage.js';

export function cloudBridge(engine: Engine, discordConnected: () => boolean, reset?: (id:string)=>Promise<unknown>) {
  let active = false;
  return async () => {
    if (active) return; active = true;
    try {
      if(reset)for(const blob of await listCloud('inbox/reset/')) {
        if(engine.store.hasReceipt(blob.pathname))continue;
        const {resetId}=z.object({resetId:z.string().uuid()}).parse(await readCloud(blob.pathname));
        try {
          await reset(resetId);
          // Retire earlier queued commands without discarding submissions made after this reset request.
          for(const prefix of ['inbox/feedback/','inbox/start/'])for(const old of await listCloud(prefix))if(old.uploadedAt<=blob.uploadedAt)engine.store.recordReceipt(old.pathname);
        } catch(error) {console.error('Reset request failed:',error instanceof Error?error.message:error);}
        engine.store.recordReceipt(blob.pathname);
      }
      for (const blob of await listCloud('inbox/feedback/')) {
        if (engine.store.hasReceipt(blob.pathname)) continue;
        const input = inputSchema.safeParse(await readCloud(blob.pathname));
        if(input.success)engine.demoReview(input.data, 'other'); engine.store.recordReceipt(blob.pathname);
      }
      for (const blob of await listCloud('inbox/start/')) {
        if (engine.store.hasReceipt(blob.pathname)) continue;
        const { batchId } = z.object({batchId:z.string().uuid()}).parse(await readCloud(blob.pathname));
        for (const [group, scenario] of feedbackBatchScenarios.entries()) for (const [index, review] of scenario.reviews.entries()) {
          engine.collect({ source: 'demo-samples', externalId: `sample-${group}-${index}`, title: scenario.title,
            text: `Reported by ${review.name} (sample participant).\n${review.text}`, category: scenario.category }, true);
        }
        engine.store.queueBatch(engine.organizationId, engine.repo.id, batchId);
        engine.store.recordReceipt(blob.pathname);
      }
      const tasks = engine.store.list(engine.organizationId).filter(t => t.repositoryId === engine.repo.id).map(t => ({
        taskId: t.id, status: t.status, createdAt: t.createdAt, batchId: t.batchId,
        feedback: { title:t.feedback.title, source:t.feedback.source, category:t.feedback.category },
        plan: t.plans.at(-1) ? { summary:t.plans.at(-1)!.summary, disposition:t.plans.at(-1)!.disposition, confidence:t.plans.at(-1)!.confidence } : null,
        signal: { reportCount: t.signal?.reportCount || 1 }, discord: t.discord, publication: t.publication,
        error: t.error ? 'Investigation needs attention. See the local worker log.' : null,
      }));
      await writeCloud('state/snapshot.json', { mode:'codex', discord:discordConnected(), operator:false, hosted:true,
        productUrl:process.env.PUBLIC_DEMO_URL ? `${process.env.PUBLIC_DEMO_URL}/product` : '/product',
        reset:engine.resetState ? {...engine.resetState,archive:undefined} : undefined, workerAt:new Date().toISOString(), tasks, batches:engine.store.batches(engine.organizationId,engine.repo.id),
        reviews:engine.store.reviews(engine.organizationId,engine.repo.id).filter(r=>!r.sample).map(r=>({id:r.id,at:r.at,sample:false,feedback:r.feedback,disposition:r.disposition})),
      });
    } finally { active = false; }
  };
}

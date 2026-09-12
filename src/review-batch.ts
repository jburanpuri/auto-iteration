import { z } from 'zod';
import { feedbackCategorySchema, type DemoReview } from './domain.js';

export const groupingSchema = z.object({ groups: z.array(z.object({
  title: z.string().min(1).max(160), category: feedbackCategorySchema,
  summary: z.string().min(1).max(1600), reportIds: z.array(z.string()).min(1),
  spam: z.boolean(), reason: z.string().min(1).max(600),
}).strict()).max(100) }).strict();
export type ReviewGrouping = z.infer<typeof groupingSchema>;
export type ReviewBatch = { id: string; at: string; status: 'pending' | 'summarizing' | 'ready' | 'failed';
  reportIds: string[]; taskIds: string[]; error?: string };
export function validateGrouping(result: ReviewGrouping, reviews: DemoReview[]) {
  const expected = new Set(reviews.map(review => review.id));
  const seen = new Set<string>();
  for (const group of result.groups) for (const id of group.reportIds) {
    if (!expected.has(id) || seen.has(id)) throw new Error('Summary must account for each report exactly once.');
    const review = reviews.find(item => item.id === id)!;
    if (review.feedback.category && review.feedback.category !== group.category) throw new Error('Summary changed a selected routing category.');
    seen.add(id);
  }
  if (seen.size !== expected.size) throw new Error('Summary omitted reports.');
  return result;
}

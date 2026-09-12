import { DomainError } from './domain.js';

export type SearchResult = { title: string; url: string; description: string };
/** Explicit public queries only; feedback and private code are never sent automatically. */
export async function braveSearch(query: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<SearchResult[]> {
  if (!query.trim() || query.length > 600 || query.trim().split(/\s+/).length > 75) {
    throw new DomainError('Search query must contain 1–600 characters and at most 75 words.');
  }
  if (!apiKey) throw new DomainError('Set BRAVE_SEARCH_API_KEY to enable web research.');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  const response = await fetcher(url, { headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new DomainError(`Brave Search returned HTTP ${response.status}. Research was not attached.`);
  const body = await response.json() as { web?: { results?: unknown[] } };
  return (body.web?.results ?? []).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const result = item as Record<string, unknown>;
    if (typeof result.url !== 'string' || typeof result.title !== 'string' || typeof result.description !== 'string') return [];
    try { if (new URL(result.url).protocol !== 'https:') return []; } catch { return []; }
    return [{ url: result.url, title: result.title.slice(0, 300), description: result.description.slice(0, 800) }];
  }).slice(0, 5);
}

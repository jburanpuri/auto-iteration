import { get, put, list, BlobNotFoundError } from '@vercel/blob';
export async function readCloud<T>(path: string): Promise<T | undefined> {
  try {
    const result = await get(path, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return undefined;
    return JSON.parse(await new Response(result.stream).text()) as T;
  } catch (error) { if (error instanceof BlobNotFoundError) return undefined; throw error; }
}
export async function writeCloud(path: string, value: unknown) {
  await put(path, JSON.stringify(value), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 0 });
}
export async function listCloud(prefix: string) {
  const blobs = []; let cursor: string | undefined;
  do { const result = await list({ prefix, cursor, limit: 1000 }); blobs.push(...result.blobs); cursor = result.hasMore ? result.cursor : undefined; } while (cursor);
  return blobs;
}

/** Explicit, read-only access to Sunfly's documented protected-v2 changes endpoint.
 * No polling, caching, downloading, licensing or playback is performed here.
 */
const ORIGIN = 'https://api.sunflykaraoke.com';
const MAX_BYTES = 4 * 1024 * 1024;
const VIDEO_TEXT_LIMIT = 2048;
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SunflyCatalogItem = {
  id: number;
  artist: string | null;
  title: string | null;
  type: string | null;
  sku: string | null;
  deleted: boolean;
  updatedAt: string;
};
export type SunflyCatalogResult =
  | { status: 'ok'; items: SunflyCatalogItem[]; nextCursor: string; hasMore: boolean }
  | { status: 'unauthorized' | 'rate-limited' | 'unavailable' | 'timed-out' | 'invalid-response' | 'invalid-input' };
export type SunflyCatalogQuery = { since?: string; directoryId?: number; limit?: number };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const cursor = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const expected = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
  return parsed.toISOString() === expected;
};
const text = (value: unknown): value is string | null =>
  value === null || typeof value === 'string' && value.length <= VIDEO_TEXT_LIMIT && !/[\x00-\x1f\x7f]/u.test(value);

function project(value: unknown, limit: number): Extract<SunflyCatalogResult, { status: 'ok' }> | null {
  if (!object(value) || ('success' in value && value.success !== true) || !object(value.result)) return null;
  const { items, nextCursor, hasMore } = value.result;
  if (!Array.isArray(items) || items.length > limit || !cursor(nextCursor) || typeof hasMore !== 'boolean') return null;
  const safe: SunflyCatalogItem[] = [];
  for (const item of items) {
    if (!object(item) || !Number.isSafeInteger(item.id) || (item.id as number) <= 0 ||
        typeof item.deleted !== 'boolean' || !cursor(item.updatedAt)) return null;
    const artist = item.artist ?? null, title = item.title ?? null, type = item.type ?? null, sku = item.sku ?? null;
    if (![artist, title, type, sku].every(text)) return null;
    // The API's published example has these fields. Deleted records may only
    // retain an id; never infer that the surviving metadata grants playback.
    if (!item.deleted && (!artist || !title)) return null;
    safe.push({ id: item.id as number, artist: artist as string | null, title: title as string | null,
      type: type as string | null, sku: sku as string | null, deleted: item.deleted, updatedAt: item.updatedAt });
  }
  return { status: 'ok', items: safe, nextCursor, hasMore };
}

async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error('Invalid response');
  }
  if (!response.body) throw new Error('Invalid response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new Error('Invalid response');
      chunks.push(part.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** Fetch precisely one page, with the key only in the documented header. */
export async function inspectSunflyCatalogPage(key: string, query: SunflyCatalogQuery = {},
  options: { fetch?: FetchFn; timeoutMs?: number } = {}): Promise<SunflyCatalogResult> {
  if (!object(query) || !object(options)) return { status: 'invalid-input' };
  const limit = query.limit ?? 100, timeoutMs = options.timeoutMs ?? 10_000;
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(key) ||
      Object.keys(query).some(name => !['since', 'directoryId', 'limit'].includes(name)) ||
      query.since !== undefined && !cursor(query.since) ||
      query.directoryId !== undefined && (!Number.isSafeInteger(query.directoryId) || query.directoryId < 1) ||
      !Number.isInteger(limit) || limit < 1 || limit > 500 ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return { status: 'invalid-input' };
  const url = new URL('/api/v2/catalogue/changes', ORIGIN);
  url.searchParams.set('limit', String(limit));
  if (query.since !== undefined) url.searchParams.set('since', query.since);
  if (query.directoryId !== undefined) url.searchParams.set('directoryId', String(query.directoryId));
  const controller = new AbortController(); let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SunflyCatalogResult>(resolve => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); resolve({ status: 'timed-out' }); }, timeoutMs);
  });
  const work = (async (): Promise<SunflyCatalogResult> => {
    try {
      const response = await (options.fetch ?? fetch)(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { 'X-Sunfly-Access-Key': key, Accept: 'application/json' }, signal: controller.signal });
      if (response.status !== 200) {
        if (response.body) void response.body.cancel().catch(() => {});
        return { status: response.status === 401 ? 'unauthorized' : response.status === 429 ? 'rate-limited' : 'unavailable' };
      }
      try {
        const page = project(await readBody(response, controller.signal), limit);
        // Even an unexpected provider response must not echo the credential.
        if (!page || page.nextCursor.includes(key) || page.items.some(item =>
          [item.artist, item.title, item.type, item.sku, item.updatedAt].some(field => field?.includes(key))))
          return { status: 'invalid-response' };
        return page;
      }
      catch { return { status: timedOut ? 'timed-out' : 'invalid-response' }; }
    } catch { return { status: timedOut ? 'timed-out' : 'unavailable' }; }
  })();
  try { return await Promise.race([work, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

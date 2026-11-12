/** Read-only shared-catalog client. Upstream provider and database keys never belong here. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

const MAX_BODY = 1024 * 1024, MAX_CACHE_BYTES = 20 * 1024 * 1024, MAX_CACHE_ENTRIES = 100;
const DAY = 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9._~-]{32,256}$/, CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f\ufffd]/u.test(v);
const instant = (v: unknown): v is number | null => v === null || Number.isSafeInteger(v) && (v as number) >= 0;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type SharedCatalogMetadata = { revision: string | null; lastSuccess: number | null; lastAttempt: number | null };
export type SharedCatalogTrack = { artist: string; title: string; brandSlug: string; brandCode?: string; youtubeId: string; uploadDate: string | null };
export type SharedCatalogQuery = { query: string; artist?: string; brandSlug?: string; cursor?: string | null; limit?: number };
type Page = SharedCatalogMetadata & { items: SharedCatalogTrack[]; nextCursor: string | null };
type ServiceStatus = SharedCatalogMetadata & { recordCount: number; searchableCount: number };
type FailureCode = 'unauthorized' | 'forbidden' | 'rate-limited' | 'unavailable' | 'timed-out' | 'invalid-request' | 'invalid-response';
type Failure = { status: FailureCode };
type Ready<T> = T & { status: 'ready'; source: 'remote' | 'cache'; fetchedAt: number; stale: boolean; cachePersisted: boolean; offlineReason: 'rate-limited' | 'unavailable' | 'timed-out' | null };
export type SharedCatalogSearchResult = Ready<Page> | Failure;
export type SharedCatalogStatusResult = Ready<ServiceStatus> | Failure;
type Kind = 'search' | 'status';
type CacheEntry = { key: string; kind: Kind; fetchedAt: number; value: Page | ServiceStatus; persisted: boolean };
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function metadata(value: unknown, optional = false): SharedCatalogMetadata | null {
  if (value === undefined && optional) return { revision: null, lastSuccess: null, lastAttempt: null };
  if (!record(value) || !(value.revision === null || typeof value.revision === 'string' && /^\d{1,64}$/.test(value.revision)) || !instant(value.lastSuccess) || !instant(value.lastAttempt)) return null;
  return { revision: value.revision as string | null, lastSuccess: value.lastSuccess, lastAttempt: value.lastAttempt };
}
function date(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(value + 'T00:00:00Z'); return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value;
}
function page(value: unknown, limit = 100): Page | null {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > limit || !(value.nextCursor === null || typeof value.nextCursor === 'string' && CURSOR.test(value.nextCursor))) return null;
  const meta = metadata(value.metadata, true); if (!meta) return null;
  const items: SharedCatalogTrack[] = [];
  for (const item of value.items) {
    if (!record(item) || !text(item.artist, 500) || !text(item.title, 500) || typeof item.brandSlug !== 'string' ||
        (item.brandSlug !== '' && (!text(item.brandSlug, 200) || item.brandSlug === '.' || item.brandSlug === '..' || /[\/\\?#%]/.test(item.brandSlug))) ||
        (item.brandCode !== undefined && !text(item.brandCode, 200)) || typeof item.youtubeId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(item.youtubeId) || !date(item.uploadDate)) return null;
    items.push({ artist: item.artist, title: item.title, brandSlug: item.brandSlug, ...(item.brandCode !== undefined ? { brandCode: item.brandCode } : {}), youtubeId: item.youtubeId, uploadDate: item.uploadDate });
  }
  return { ...meta, items, nextCursor: value.nextCursor };
}
function status(value: unknown): ServiceStatus | null {
  const meta = metadata(value);
  if (!meta || !record(value) || !Number.isSafeInteger(value.recordCount) || (value.recordCount as number) < 0 || !Number.isSafeInteger(value.searchableCount) || (value.searchableCount as number) < 0 || (value.searchableCount as number) > (value.recordCount as number)) return null;
  return { ...meta, recordCount: value.recordCount as number, searchableCount: value.searchableCount as number };
}
function cacheValue(value: unknown, kind: Kind): Page | ServiceStatus | null {
  if (!record(value)) return null;
  return kind === 'search' ? page({ ...value, metadata: { revision: value.revision, lastSuccess: value.lastSuccess, lastAttempt: value.lastAttempt } }) : status(value);
}

/** A single bounded file. Account/endpoint changes cannot read another scope's cache. */
class QueryCache {
  private entries = new Map<string, CacheEntry>();
  private loaded: Promise<void> | null = null;
  private updates: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly scope: string, private readonly now: () => number) {}
  private load(): Promise<void> {
    return this.loaded ??= (async () => {
      try {
        const before = await lstat(this.file);
        if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_CACHE_BYTES) return;
        const file = await open(this.file, 'r'); let raw: Buffer;
        try {
          const start = await file.stat(); if (start.dev !== before.dev || start.ino !== before.ino || start.size !== before.size) return;
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) { size += chunk.length; if (size > MAX_CACHE_BYTES) return; chunks.push(chunk as Buffer); }
          const end = await file.stat(), named = await lstat(this.file);
          if (end.size !== start.size || end.mtimeMs !== start.mtimeMs || named.isSymbolicLink() || named.dev !== start.dev || named.ino !== start.ino || size !== start.size) return;
          raw = Buffer.concat(chunks, size);
        } finally { await file.close(); }
        const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        if (!record(data) || data.format !== 1 || data.scope !== this.scope || !Array.isArray(data.entries) || data.entries.length > MAX_CACHE_ENTRIES) return;
        const parsed = new Map<string, CacheEntry>();
        for (const item of data.entries) {
          if (!record(item) || typeof item.key !== 'string' || !/^[a-f0-9]{64}$/.test(item.key) || (item.kind !== 'search' && item.kind !== 'status') || !Number.isSafeInteger(item.fetchedAt) || (item.fetchedAt as number) < 0 || (item.fetchedAt as number) > this.now() + 300000 || parsed.has(item.key)) return;
          const value = cacheValue(item.value, item.kind); if (!value) return;
          parsed.set(item.key, { key: item.key, kind: item.kind, fetchedAt: item.fetchedAt as number, value, persisted: true });
        }
        this.entries = parsed;
      } catch { /* Missing, incompatible or corrupt caches are never authoritative. */ }
    })();
  }
  async get(key: string, kind: Kind): Promise<CacheEntry | null> {
    await this.load(); const entry = this.entries.get(key); return entry?.kind === kind ? structuredClone(entry) : null;
  }
  private async persist(): Promise<boolean> {
    let temporary: string | undefined;
    let expectedParent: { path: string; dev: number; ino: number } | undefined;
    let expectedFile: { dev: number; ino: number } | undefined;
    try {
      await mkdir(dirname(this.file), { recursive: true });
      const directory = await realpath(dirname(this.file));
      const parent = await lstat(directory);
      if (!parent.isDirectory() || parent.isSymbolicLink()) return false;
      expectedParent = { path: directory, dev: parent.dev, ino: parent.ino };
      const bytes = () => Buffer.from(JSON.stringify({ format: 1, scope: this.scope, entries: [...this.entries.values()].map(({ persisted, ...entry }) => entry) }));
      let data = bytes();
      while (data.length > MAX_CACHE_BYTES && this.entries.size > 1) {
        this.entries.delete(this.entries.keys().next().value!);
        data = bytes();
      }
      if (data.length > MAX_CACHE_BYTES) return false;
      temporary = join(directory, `.tpv-catalog-cache-${randomUUID()}.json`);
      const file = await open(temporary, 'wx', 0o600);
      try { const info = await file.stat(); expectedFile = { dev: info.dev, ino: info.ino }; await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      const current = await lstat(directory);
      if (current.dev !== parent.dev || current.ino !== parent.ino || current.isSymbolicLink() || await realpath(dirname(this.file)) !== directory) return false;
      await rename(temporary, this.file); temporary = undefined;
      for (const entry of this.entries.values()) entry.persisted = true;
      return true;
    } catch { return false; }
    finally {
      if (temporary && expectedParent && expectedFile) {
        try {
          const parent = await lstat(expectedParent.path), file = await lstat(temporary);
          if (!parent.isSymbolicLink() && parent.dev === expectedParent.dev && parent.ino === expectedParent.ino &&
              await realpath(expectedParent.path) === expectedParent.path && !file.isSymbolicLink() && file.dev === expectedFile.dev && file.ino === expectedFile.ino) await unlink(temporary);
        } catch { /* Preserve uncertain staging instead of deleting another file. */ }
      }
    }
  }
  private update(work: () => Promise<boolean>): Promise<boolean> {
    const next = this.updates.then(work, work); this.updates = next; return next;
  }
  put(key: string, kind: Kind, value: Page | ServiceStatus, fetchedAt: number): Promise<boolean> {
    return this.update(async () => {
      await this.load(); this.entries.delete(key); this.entries.set(key, { key, kind, fetchedAt, value: structuredClone(value), persisted: false });
      while (this.entries.size > MAX_CACHE_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
      return this.persist();
    });
  }
  invalidate(): Promise<boolean> { return this.update(async () => { await this.load(); this.entries.clear(); return this.persist(); }); }
}

export class SharedCatalogClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly routePrefix: string;
  private readonly cache: QueryCache;
  private readonly fetcher: FetchFn;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private accessDenied: 'unauthorized' | 'forbidden' | null = null;
  private authorizationEpoch = 0;
  constructor(options: { baseUrl: string; token?: string; public?: boolean; cacheFile: string; fetch?: FetchFn; timeoutMs?: number; now?: () => number }) {
    try {
      const url = new URL(options.baseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || options.baseUrl.length > 2048 ||
          (options.public === true ? options.token !== undefined : typeof options.token !== 'string' || !TOKEN.test(options.token)) ||
          (options.public !== undefined && typeof options.public !== 'boolean') || !isAbsolute(options.cacheFile) || /[\x00-\x1f\x7f]/.test(options.cacheFile) || (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000))) throw new Error();
      this.baseUrl = url.href.replace(/\/+$/, ''); this.token = options.public === true ? null : options.token!; this.now = options.now ?? Date.now;
      this.routePrefix = options.public === true ? '/v1/catalog/public' : '/v1/catalog';
      // Keep the established private scope format; public caches cannot inherit
      // entries belonging to a private authority, or contain a bundled token.
      this.cache = new QueryCache(options.cacheFile, digest(JSON.stringify(this.token === null ? ['public',this.baseUrl] : [this.baseUrl,this.token])), this.now);
      this.fetcher = options.fetch ?? fetch; this.timeoutMs = options.timeoutMs ?? 10000;
    } catch { throw new Error('Invalid shared catalog configuration.'); }
  }
  async search(input: SharedCatalogQuery): Promise<SharedCatalogSearchResult> {
    if (!record(input) || Object.keys(input).some(key => !['query', 'artist', 'brandSlug', 'cursor', 'limit'].includes(key)) || !text(input.query, 200) || input.query.trim().length < 2 ||
        (input.artist !== undefined && input.artist !== '' && !text(input.artist, 200)) || (input.brandSlug !== undefined && input.brandSlug !== '' && (!text(input.brandSlug, 200) || input.brandSlug === '.' || input.brandSlug === '..' || /[\/\\?#%]/.test(input.brandSlug))) ||
        (input.cursor !== undefined && input.cursor !== null && (typeof input.cursor !== 'string' || !CURSOR.test(input.cursor))) || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100))) return { status: 'invalid-request' };
    const values = { q: input.query.trim(), artist: input.artist ?? '', brand: input.brandSlug ?? '', cursor: input.cursor ?? null, limit: input.limit ?? 50 };
    const params = new URLSearchParams({ q: values.q, limit: String(values.limit) });
    if (values.artist) params.set('artist', values.artist); if (values.brand) params.set('brand', values.brand); if (values.cursor) params.set('cursor', values.cursor);
    return this.request('search', digest(JSON.stringify(values)), this.routePrefix + '/tracks?' + params, value => page(value, values.limit)) as Promise<SharedCatalogSearchResult>;
  }
  status(): Promise<SharedCatalogStatusResult> {
    return this.request('status', digest('status'), this.routePrefix + '/status', status) as Promise<SharedCatalogStatusResult>;
  }
  private async request(kind: Kind, key: string, path: string, parse: (value: unknown) => Page | ServiceStatus | null): Promise<Ready<Page | ServiceStatus> | Failure> {
    const authorizationEpoch = this.authorizationEpoch;
    const controller = new AbortController(); let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Failure>(resolve => { timer = setTimeout(() => { expired = true; controller.abort(); resolve({ status: 'timed-out' }); }, this.timeoutMs); });
    const work = (async (): Promise<{ status: 'ok'; value: Page | ServiceStatus } | Failure> => {
      let received = false;
      try {
        const response = await this.fetcher(this.baseUrl + path, { method: 'GET', headers: { ...(this.token === null ? {} : {Authorization: `Bearer ${this.token}`}), Accept: 'application/json' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        received = true;
        if (expired) { void response.body?.cancel().catch(() => {}); return { status: 'timed-out' }; }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          return { status: response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'unavailable' : 'invalid-response' };
        }
        if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length') ?? 0) > MAX_BODY) throw new Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        const abort = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', abort, { once: true });
        try {
          for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY) throw new Error(); chunks.push(part.value); }
        } finally { controller.signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (expired) return { status: 'timed-out' };
        const value = parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))));
        return value ? { status: 'ok', value } : { status: 'invalid-response' };
      } catch { return { status: expired || controller.signal.aborted ? 'timed-out' : received ? 'invalid-response' : 'unavailable' }; }
    })();
    let result: Awaited<typeof work>;
    try { result = await Promise.race([work, deadline]); }
    finally { if (timer) clearTimeout(timer); }
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) return { status: 'invalid-response' };
    if (result.status === 'ok') {
      if (authorizationEpoch !== this.authorizationEpoch && this.accessDenied) return { status: this.accessDenied };
      this.accessDenied = null;
      const persisted = await this.cache.put(key, kind, result.value, now);
      if (authorizationEpoch !== this.authorizationEpoch && this.accessDenied) return { status: this.accessDenied };
      return { ...result.value, status: 'ready', source: 'remote', fetchedAt: now, stale: result.value.lastSuccess === null || now - result.value.lastSuccess > DAY, cachePersisted: persisted, offlineReason: null };
    }
    if (result.status === 'unauthorized' || result.status === 'forbidden') { this.accessDenied = result.status; ++this.authorizationEpoch; await this.cache.invalidate(); }
    if (!this.accessDenied && ['unavailable', 'timed-out', 'rate-limited'].includes(result.status)) {
      const cached = await this.cache.get(key, kind);
      // Loading a cold cache may yield while another request revokes access.
      // A copied entry must not escape after that authority has changed.
      if (authorizationEpoch !== this.authorizationEpoch || this.accessDenied) return this.accessDenied ? { status: this.accessDenied } : result;
      if (cached) return { ...cached.value, status: 'ready', source: 'cache', fetchedAt: cached.fetchedAt, stale: true, cachePersisted: cached.persisted, offlineReason: result.status as 'unavailable' | 'timed-out' | 'rate-limited' };
    }
    return result;
  }
}

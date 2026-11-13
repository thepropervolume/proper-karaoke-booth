/** Public Sunfly shop metadata, kept separate from protected streaming identities. */
import { parse, parseFragment } from 'parse5';
import type { ProviderCatalogSearchResult, ProviderCatalogSearchStatus, ProviderCatalogSong } from '../domain/provider-catalog';

const ORIGIN = 'https://www.sunflykaraoke.com';
const PRODUCTS = ORIGIN + '/wp-json/wc/store/v1/products';
const MAX_BODY = 512 * 1024;
const LIMIT = 5;
const QUERY_TTL = 5 * 60_000;
const DETAIL_TTL = 24 * 60 * 60_000;
const FAILURE_TTL = 60_000;
const NON_SONG_CATEGORIES = new Set(['album', 'albums', 'compilation', 'compilations', 'pack', 'packs', 'merch', 'merchandise', 'backing-only', 'backing-tracks-only']);
const MESSAGE = 'Sunfly Store title/SKU search, first-page individual songs only. Artist search is not verified. Store IDs are not streaming IDs; playback is not connected.';
const TEXT = /^[^\x00-\x1f\x7f\ufffd]*$/u;
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Failure = Exclude<ProviderCatalogSearchStatus, 'ok' | 'not-configured' | 'invalid-input'>;
type Reply = { status: 'ok'; body: string } | { status: Failure };
type Product = { id: number; sku: string; title: string; url: string };
type Detail = { artist: string | null; durationSeconds: number | null; language: string | null };
type Cache<T> = { expires: number; value: T };
type HtmlNode = { nodeName: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const field = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= limit && TEXT.test(value) && !/https?:\/\//iu.test(value);

function text(node: HtmlNode): string {
  if (['script', 'style', 'template'].includes(node.nodeName)) throw new Error('Invalid text');
  return node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(text).join('');
}

function title(value: unknown): string | null {
  if (!field(value, 1024) || /[<>]/u.test(value)) return null;
  const decoded = text(parseFragment(value) as unknown as HtmlNode).trim();
  return field(decoded, 512) ? decoded : null;
}

function productUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024) return null;
  try {
    const url = new URL(value);
    if (url.origin !== ORIGIN || url.username || url.password || url.port || url.search || url.hash ||
        /%2f|%5c|%2e/i.test(url.pathname) || !/^\/(?:karaoke|custom-discs)\/[a-z0-9%_-]+\/[a-z0-9%_-]+\/$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function products(value: unknown, expectedSku?: string): Product[] | null {
  if (!Array.isArray(value) || value.length > LIMIT) return null;
  const rows: Product[] = [], seen = new Set<number>();
  for (const item of value) {
    if (!object(item) || !Number.isSafeInteger(item.id) || (item.id as number) < 1 ||
        typeof item.type !== 'string' || !Array.isArray(item.categories) || !Array.isArray(item.grouped_products)) return null;
    if (expectedSku !== undefined && item.sku !== expectedSku) return null;
    const categories = item.categories;
    if (categories.some(category => !object(category) || typeof category.slug !== 'string')) return null;
    // Albums, compilations, variations, backing-only products and merchandise are not karaoke songs.
    if (item.type !== 'variable' || item.grouped_products.length !== 0 || item.parent !== 0 ||
        categories.some(category => NON_SONG_CATEGORIES.has((category as Record<string, string>).slug)) ||
        !categories.some(category => (category as Record<string, unknown>).slug === 'songs') ||
        !categories.some(category => (category as Record<string, unknown>).slug === 'karaoke')) continue;
    if (typeof item.sku !== 'string' || !/^SF\d{4,12}$/.test(item.sku)) continue;
    const name = title(item.name), url = productUrl(item.permalink);
    if (!name || !url || seen.has(item.id as number)) return null;
    seen.add(item.id as number);
    rows.push({ id: item.id as number, sku: item.sku, title: name, url });
  }
  return rows;
}

function duration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^PT(?:(\d{1,2})H)?(?:(\d{1,2})M)?(?:(\d{1,2}(?:\.\d{1,3})?)S)?$/.exec(value);
  if (!match || !match.slice(1).some(Boolean)) return null;
  const hours = Number(match[1] ?? 0), minutes = Number(match[2] ?? 0), seconds = Number(match[3] ?? 0);
  return minutes < 60 && seconds < 60 && hours <= 12 ? hours * 3600 + minutes * 60 + seconds : null;
}

function artist(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  if (values.length < 1 || values.length > 10 || values.some(entry => !object(entry) || !field(entry.name, 256))) return null;
  const name = values.map(entry => (entry as Record<string, string>).name).join(' & ');
  return field(name, 512) ? name : null;
}

/** Enrichment never derives names from URL slugs or accepts another recording's JSON-LD. */
export function parseSunflyStoreDetail(html: string, product: { sku: string; title: string; url: string }): Detail | null {
  if (Buffer.byteLength(html, 'utf8') > MAX_BODY) return null;
  const scripts: string[] = [];
  const visit = (node: HtmlNode) => {
    if (node.nodeName === 'script' && node.attrs?.some(attr => attr.name === 'type' && attr.value.toLowerCase() === 'application/ld+json')) {
      scripts.push((node.childNodes ?? []).filter(child => child.nodeName === '#text').map(child => child.value ?? '').join(''));
      if (scripts.length > 20) throw new Error('Too many metadata blocks');
    } else for (const child of node.childNodes ?? []) visit(child);
  };
  try {
    visit(parse(html) as unknown as HtmlNode);
    const matches: Record<string, unknown>[] = [];
    const inspect = (value: unknown, depth = 0) => {
      if (depth > 5) return;
      if (Array.isArray(value)) { if (value.length > 100) return; for (const entry of value) inspect(entry, depth + 1); return; }
      if (!object(value)) return;
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (types.includes('Product') && types.includes('MusicRecording')) matches.push(value);
      if (value['@graph']) inspect(value['@graph'], depth + 1);
    };
    for (const script of scripts) { try { inspect(JSON.parse(script)); } catch { /* Ignore unrelated invalid metadata blocks. */ } }
    if (matches.length !== 1) return null;
    const item = matches[0];
    if (item.sku !== product.sku || title(item.name) !== product.title || productUrl(item.url) !== product.url) return null;
    return { artist: artist(item.byArtist), durationSeconds: duration(item.duration), language: field(item.inLanguage, 80) ? item.inLanguage : null };
  } catch { return null; }
}

async function body(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length');
  if (!response.body || length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
    void response.body?.cancel().catch(() => {}); throw new Error('Invalid response size');
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, result = '', finished = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new Error('Cancelled');
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > MAX_BODY) throw new Error('Response too large');
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode(); finished = true; return result;
  } finally { signal.removeEventListener('abort', cancel); if (!finished || signal.aborted) cancel(); reader.releaseLock(); }
}

export class SunflyStoreCatalogClient {
  #fetch: Fetch;
  #now: () => number;
  #timeout: number;
  #queries = new Map<string, Cache<ProviderCatalogSearchResult>>();
  #queryPending = new Map<string, Promise<ProviderCatalogSearchResult>>();
  #details = new Map<string, Cache<Detail | null>>();
  #detailPending = new Map<string, Promise<Detail | null>>();

  constructor(options: { fetch?: Fetch; now?: () => number; timeoutMs?: number } = {}) {
    this.#fetch = options.fetch ?? fetch; this.#now = options.now ?? Date.now; this.#timeout = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.#timeout) || this.#timeout < 1 || this.#timeout > 60_000) throw new Error('Invalid store timeout');
  }

  private cached<T>(cache: Map<string, Cache<T>>, key: string): Cache<T> | undefined {
    const hit = cache.get(key); if (!hit) return;
    if (hit.expires <= this.#now()) { cache.delete(key); return; }
    cache.delete(key); cache.set(key, hit); return hit;
  }

  private save<T>(cache: Map<string, Cache<T>>, key: string, value: T, ttl: number, limit: number): void {
    cache.delete(key); cache.set(key, { value, expires: this.#now() + ttl });
    while (cache.size > limit) cache.delete(cache.keys().next().value!);
  }

  private async request(url: string, format: 'json' | 'html', signal: AbortSignal): Promise<Reply> {
    if (signal.aborted) return { status: 'timed-out' };
    let cancel!: () => void;
    const aborted = new Promise<Reply>(resolve => { cancel = () => resolve({ status: 'timed-out' }); signal.addEventListener('abort', cancel, { once: true }); });
    const work = (async (): Promise<Reply> => {
      try {
        const response = await this.#fetch(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
          headers: { Accept: format === 'json' ? 'application/json' : 'text/html' } });
        if (signal.aborted) { void response.body?.cancel().catch(() => {}); return { status: 'timed-out' }; }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          return { status: response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate-limited' : 'unavailable' };
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!(format === 'json' ? /^application\/json(?:;|$)/i : /^text\/html(?:;|$)/i).test(contentType)) {
          void response.body?.cancel().catch(() => {}); return { status: 'invalid-response' };
        }
        try { return { status: 'ok', body: await body(response, signal) }; }
        catch { return { status: signal.aborted ? 'timed-out' : 'invalid-response' }; }
      } catch { return { status: signal.aborted ? 'timed-out' : 'unavailable' }; }
    })();
    try { return await Promise.race([work, aborted]); }
    finally { signal.removeEventListener('abort', cancel); }
  }

  private async detail(product: Product, signal: AbortSignal): Promise<Detail | null> {
    const key = JSON.stringify([product.id, product.url, product.sku, product.title]);
    const cached = this.cached(this.#details, key); if (cached) return cached.value;
    const existing = this.#detailPending.get(key); if (existing) return existing;
    const promise = (async () => {
      const response = await this.request(product.url, 'html', signal);
      const value = response.status === 'ok' ? parseSunflyStoreDetail(response.body, product) : null;
      if (!signal.aborted) this.save(this.#details, key, value, value ? DETAIL_TTL : FAILURE_TTL, 128);
      return value;
    })();
    this.#detailPending.set(key, promise);
    try { return await promise; } finally { if (this.#detailPending.get(key) === promise) this.#detailPending.delete(key); }
  }

  private async run(query: string): Promise<ProviderCatalogSearchResult> {
    const base = { provider: 'sunfly' as const, label: 'Sunfly Store' };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ProviderCatalogSearchResult>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ ...base, status: 'timed-out', songs: [], message: 'Sunfly Store search timed out. Other sources remain available.' }); }, this.#timeout);
    });
    const work = (async (): Promise<ProviderCatalogSearchResult> => {
      const params = new URLSearchParams({ per_page: String(LIMIT), page: '1' });
      const expectedSku = /^SF\d{4,12}$/i.test(query) ? query.toUpperCase() : undefined;
      if (expectedSku) params.set('sku', expectedSku); else params.set('search', query);
      const reply = await this.request(PRODUCTS + '?' + params, 'json', controller.signal);
      if (reply.status !== 'ok') return { ...base, status: reply.status, songs: [], message: 'Sunfly Store search is unavailable. Other sources remain available.' };
      let entries: Product[] | null;
      try { entries = products(JSON.parse(reply.body), expectedSku); } catch { entries = null; }
      if (!entries) return { ...base, status: 'invalid-response', songs: [], message: 'Sunfly Store returned an unexpected catalog response.' };
      const songs: ProviderCatalogSong[] = [];
      // At most two public product pages are loaded concurrently; the query itself has one deadline.
      for (let offset = 0; offset < entries.length; offset += 2) {
        const group = entries.slice(offset, offset + 2);
        const values = await Promise.all(group.map(product => this.detail(product, controller.signal)));
        if (controller.signal.aborted) return { ...base, status: 'timed-out', songs: [], message: 'Sunfly Store search timed out. Other sources remain available.' };
        for (let index = 0; index < group.length; index++) {
          const product = group[index], info = values[index];
          songs.push({ provider: 'sunfly', id: 'store:' + product.id, providerSku: product.sku, title: product.title, artist: info?.artist ?? null,
            durationSeconds: info?.durationSeconds ?? null, language: info?.language ?? null, webUrl: product.url, playbackAvailable: false });
        }
      }
      return { ...base, status: 'ok', songs, message: MESSAGE + (songs.some(song => song.artist === null) ? ' Some artist details could not be verified.' : '') };
    })();
    try { return await Promise.race([work, timeout]); } finally { if (timer) clearTimeout(timer); }
  }

  async search(query: string): Promise<ProviderCatalogSearchResult> {
    const failure = (message: string): ProviderCatalogSearchResult => ({ provider: 'sunfly', label: 'Sunfly Store', status: 'invalid-input', songs: [], message });
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 160 || !TEXT.test(query)) return failure('Enter 2–160 characters to search Sunfly Store.');
    if (!Number.isFinite(this.#now())) return { ...failure('Sunfly Store search is unavailable.'), status: 'unavailable' };
    const normalized = query.normalize('NFKC').trim(), key = normalized.toLocaleLowerCase('en');
    if (normalized.length < 2 || normalized.length > 160 || !TEXT.test(normalized)) return failure('Enter 2–160 characters to search Sunfly Store.');
    const cached = this.cached(this.#queries, key);
    if (cached) return structuredClone(cached.value);
    const existing = this.#queryPending.get(key); if (existing) return structuredClone(await existing);
    if (this.#queryPending.size >= 4) return { ...failure('Sunfly Store search is busy. Try again shortly.'), status: 'rate-limited' };
    const promise = this.run(normalized); this.#queryPending.set(key, promise);
    try {
      const result = await promise;
      this.save(this.#queries, key, result, result.status === 'ok' ? QUERY_TTL : FAILURE_TTL, 32);
      return structuredClone(result);
    } finally { if (this.#queryPending.get(key) === promise) this.#queryPending.delete(key); }
  }
}

const publicStore = new SunflyStoreCatalogClient();
export function searchSunflyStoreCatalog(query: string): Promise<ProviderCatalogSearchResult> { return publicStore.search(query); }

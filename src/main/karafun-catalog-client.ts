/** Search the official public CSV catalog. No account, session, media or client key is used. */
import { parse } from 'parse5';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { validProviderQuery, type ProviderCatalogSearchResult, type ProviderCatalogSong } from '../domain/provider-catalog';

const CATALOG_PAGE = 'https://www.karafun.com/karaoke-song-list.html';
const DAY = 86_400_000, MAX_BYTES = 24 * 1024 * 1024, MAX_ROWS = 120_000;
const HEADER = ['Id', 'Title', 'Artist', 'Year', 'Duo', 'Explicit', 'Date Added', 'Styles', 'Languages'];
type Failure = Exclude<ProviderCatalogSearchResult['status'], 'ok' | 'not-configured' | 'invalid-input'>;
class CatalogError extends Error { constructor(readonly status: Failure) { super(status); } }
const text = (s: string, max = 500) => s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f\ufffd]/.test(s);
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US');

/** Quoted semicolons, doubled quotes and CRLF are handled without executing provider data. */
export async function parseKaraFunCatalog(csv: string, signal?: AbortSignal): Promise<ProviderCatalogSong[]> {
  if (Buffer.byteLength(csv, 'utf8') > MAX_BYTES) throw new CatalogError('invalid-response');
  csv = csv.replace(/^\ufeff/, '');
  const songs: ProviderCatalogSong[] = [], seen = new Set<string>();
  let row: string[] = [], field = '', quoted = false, endedQuote = false, header = false;
  function cell() { row.push(field); field = ''; endedQuote = false; }
  function record() {
    cell();
    if (row.length === 1 && row[0] === '') { row = []; return; }
    if (!header) { if (JSON.stringify(row) !== JSON.stringify(HEADER)) throw new CatalogError('invalid-response'); header = true; row = []; return; }
    if (row.length !== HEADER.length || !/^\d{1,12}$/.test(row[0]) || !text(row[1]) || !text(row[2]) || !['0', '1'].includes(row[5]) || !text(row[8], 200) || seen.has(row[0]) || songs.length >= MAX_ROWS) throw new CatalogError('invalid-response');
    seen.add(row[0]);
    songs.push({ provider: 'karafun', id: row[0], title: row[1], artist: row[2], explicit: row[5] === '1', language: row[8], durationSeconds: null, webUrl: null, playbackAvailable: false });
    row = [];
  }
  for (let i = 0; i < csv.length; i++) {
    if (i > 0 && i % 65_536 === 0) { await yieldTurn(); if (signal?.aborted) throw new CatalogError('timed-out'); }
    const c = csv[i];
    if (quoted) {
      if (c === '"') { if (csv[i + 1] === '"') { field += '"'; i++; } else { quoted = false; endedQuote = true; } }
      else field += c;
    } else if (c === ';') cell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && csv[i + 1] === '\n') i++; record(); }
    else if (c === '"' && field === '' && !endedQuote) quoted = true;
    else { if (endedQuote || c === '"') throw new CatalogError('invalid-response'); field += c; }
    if (field.length > 4096 || row.length > HEADER.length) throw new CatalogError('invalid-response');
  }
  if (quoted) throw new CatalogError('invalid-response');
  if (field || row.length || endedQuote) record();
  if (!header || !songs.length) throw new CatalogError('invalid-response');
  return songs;
}

function csvLink(html: string): string {
  const doc = parse(html), candidates = new Set<string>();
  function content(n: any): string { return n.nodeName === '#text' ? n.value : (n.childNodes ?? []).map(content).join(' '); }
  function walk(n: any): void {
    if (n.tagName === 'a' && /\bcsv\b/i.test(content(n))) {
      const href = n.attrs?.find((a: any) => a.name === 'href')?.value;
      if (typeof href === 'string') {
        const url = new URL(href, CATALOG_PAGE);
        if (url.origin === 'https://www.karafun.com' && /^\/cl\/\d+\/[a-f0-9]{32}\/$/.test(url.pathname) && !url.search && !url.hash) candidates.add(url.href);
      }
    }
    for (const child of n.childNodes ?? []) walk(child);
  }
  walk(doc);
  if (candidates.size !== 1) throw new CatalogError('invalid-response');
  return [...candidates][0];
}

export class KaraFunCatalogClient {
  private snapshot: { songs: ProviderCatalogSong[]; index: string[]; fetchedAt: number } | null = null;
  private pending: Promise<void> | null = null;
  private retryAt = 0;
  private lastFailure: Failure = 'unavailable';
  constructor(private readonly options: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number } = {}) {
    const timeout = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000) throw new Error('Invalid catalog timeout.');
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private async load(): Promise<void> {
    if (this.snapshot && this.now() - this.snapshot.fetchedAt < DAY) return;
    if (this.now() < this.retryAt) throw new CatalogError(this.lastFailure);
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CatalogError('timed-out')); }, this.options.timeoutMs ?? 30_000); });
      const read = async (url: string, max: number, mime: RegExp): Promise<string> => {
        const r = await (this.options.fetch ?? fetch)(url, { redirect: 'manual', credentials: 'omit', signal: controller.signal });
        if (controller.signal.aborted) { void r.body?.cancel().catch(() => {}); throw new CatalogError('timed-out'); }
        if (!r.ok) { await r.body?.cancel(); throw new CatalogError(r.status === 429 ? 'rate-limited' : r.status === 401 || r.status === 403 ? 'unauthorized' : 'unavailable'); }
        if (Number(r.headers.get('content-length')) > max) { await r.body?.cancel(); throw new CatalogError('invalid-response'); }
        if (!r.body || !mime.test(r.headers.get('content-type') ?? '')) { void r.body?.cancel().catch(() => {}); throw new CatalogError('invalid-response'); }
        const reader = r.body.getReader(), parts: Uint8Array[] = []; let size = 0;
        const cancel = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        try {
          while (true) { if (controller.signal.aborted) throw new CatalogError('timed-out'); const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > max) throw new CatalogError('invalid-response'); parts.push(chunk.value); }
          try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)); } catch { throw new CatalogError('invalid-response'); }
        } finally { controller.signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
      };
      try {
        const load = (async () => {
          const html = await read(CATALOG_PAGE, 512 * 1024, /^text\/html(?:;|$)/i);
          const csv = await read(csvLink(html), MAX_BYTES, /^text\/(?:csv|plain)(?:;|$)/i);
          const songs = await parseKaraFunCatalog(csv, controller.signal), index: string[] = [];
          for (let i = 0; i < songs.length; i++) { if (i % 1024 === 0) { await yieldTurn(); if (controller.signal.aborted) throw new CatalogError('timed-out'); } index.push(fold(`${songs[i].id} ${songs[i].artist} ${songs[i].title}`)); }
          return { songs, index };
        })();
        const loaded = await Promise.race([load, timeout]);
        this.snapshot = { ...loaded, fetchedAt: this.now() }; this.retryAt = 0;
      } catch (error) {
        this.lastFailure = controller.signal.aborted ? 'timed-out' : error instanceof CatalogError ? error.status : error instanceof TypeError ? 'unavailable' : 'invalid-response';
        this.retryAt = this.now() + 60_000; throw new CatalogError(this.lastFailure);
      } finally { clearTimeout(timer!); }
    })();
    try { await this.pending; } finally { this.pending = null; }
  }
  async search(query: string): Promise<ProviderCatalogSearchResult> {
    const result = (status: ProviderCatalogSearchResult['status'], songs: ProviderCatalogSong[], message: string): ProviderCatalogSearchResult => ({ provider: 'karafun', label: 'KaraFun', status, songs, message });
    if (!validProviderQuery(query)) return result('invalid-input', [], 'Enter 2–200 characters to search KaraFun.');
    const normalized = fold(query.trim());
    if (normalized.trim().length < 2) return result('invalid-input', [], 'Enter at least two searchable characters.');
    let stale = false;
    try { await this.load(); }
    catch {
      if (!this.snapshot || this.lastFailure === 'unauthorized') return result(this.lastFailure, [], 'KaraFun catalog could not be loaded. Local songs and other sources remain available.');
      stale = true;
    }
    const words = normalized.split(/\s+/), songs: ProviderCatalogSong[] = [], snapshot = this.snapshot!;
    for (let i = 0; i < snapshot.songs.length && songs.length < 50; i++) {
      if (i % 4096 === 0) await yieldTurn();
      if (words.every(w => snapshot.index[i].includes(w))) songs.push({ ...snapshot.songs[i] });
    }
    return result('ok', songs, `${stale ? 'Saved catalog; refresh unavailable. ' : 'Public catalog cached for up to 24 hours while the app is open. '}Search only; subscription playback is not connected.`);
  }
}

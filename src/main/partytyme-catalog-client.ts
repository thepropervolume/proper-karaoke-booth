/** Public Party Tyme catalog metadata. No login, media URLs or playback requests. */
import { parseFragment } from 'parse5';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { ProviderCatalogSearchResult, ProviderCatalogSong } from '../domain/provider-catalog';

export const PARTY_TYME_CATALOG_URL = 'https://www.partytyme.com/Party_Tyme_Pro_update.htm';
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_ROWS = 60_000;
const MAX_RESULTS = 50;
const DAY = 24 * 60 * 60 * 1000;
const RETRY_GAP = 15 * 60 * 1000;
const HEADINGS = ['New', 'Date of Release', 'HD Code', 'SONG TITLE', 'ARTIST', 'GENRE', 'LANG', 'SONG KEY', 'COVER TIME'];
const TEXT = /^[^\x00-\x1f\x7f\ufffd]*$/u;
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Failure = 'unauthorized' | 'rate-limited' | 'unavailable' | 'invalid-response' | 'timed-out';
type Row = { song: ProviderCatalogSong; searchable: string; title: string; artist: string };
type Loaded = { status: 'ok'; rows: Row[] } | { status: Failure };
type HtmlNode = { nodeName: string; value?: string; childNodes?: HtmlNode[] };

function plain(node: HtmlNode): string {
  if (['script', 'style', 'template'].includes(node.nodeName)) throw new Error('Unexpected catalog content');
  return node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(plain).join('');
}

function rowCells(row: string): { header: boolean; values: string[] } {
  if (row.length > 24_000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/u.test(row)) throw new Error('Invalid catalog row');
  const fragment = parseFragment('<table>' + row + '</table>') as unknown as HtmlNode;
  const cells: HtmlNode[] = [];
  let header = false;
  const visit = (node: HtmlNode) => {
    if (node.nodeName === 'th' || node.nodeName === 'td') {
      if (node.nodeName === 'th') header = true;
      cells.push(node);
    } else for (const child of node.childNodes ?? []) visit(child);
  };
  visit(fragment);
  return { header, values: cells.map(cell => plain(cell).replace(/\s+/gu, ' ').trim()) };
}

function normal(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
}

function field(value: string, limit: number): boolean {
  return value.length > 0 && value.length <= limit && TEXT.test(value) && !/https?:\/\//iu.test(value);
}

function duration(value: string): number | null {
  // The live public catalog includes one m.ss entry as well as the usual m:ss.
  const match = /^(\d{1,3})[:.]([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Strict schema detection prevents a changed/error page from masquerading as zero matches. */
export async function parsePartyTymeCatalog(html: string, signal?: AbortSignal): Promise<ProviderCatalogSong[]> {
  if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) throw new Error('Oversized catalog');
  // The published export is one table. Require its own balanced boundaries;
  // an unrelated closed table must not make a truncated catalog look complete.
  const tables: RegExpMatchArray[] = [];
  for (const token of html.matchAll(/<(\/?)table\b/gi)) {
    tables.push(token);
    if (tables.length > 2) throw new Error('Unexpected catalog tables');
  }
  if (tables.length !== 2 || tables[0][1] !== '' || tables[1][1] !== '/') throw new Error('Incomplete catalog table');
  const tableStart = tables[0].index!, tableEnd = tables[1].index!;
  const openingEnd = html.indexOf('>', tableStart);
  const closingTable = /^<\/table\s*>/i.exec(html.slice(tableEnd));
  if (openingEnd < 0 || openingEnd >= tableEnd || !closingTable ||
      !/^<table(?:\s[^<>]*)?>$/i.test(html.slice(tableStart, openingEnd + 1))) throw new Error('Invalid catalog table boundaries');
  const afterTable = tableEnd + closingTable[0].length;
  if (/<\/?tr\b/i.test(html.slice(0, tableStart)) || /<\/?tr\b/i.test(html.slice(afterTable)))
    throw new Error('Catalog rows outside table');
  const table = html.slice(openingEnd + 1, tableEnd);
  const rows: ProviderCatalogSong[] = [], seen = new Set<string>();
  let count = 0, headerSeen = false;
  const opening = /<tr\b/gi, closing = /<\/tr\s*>/gi;
  for (;;) {
    const match = opening.exec(table);
    if (!match) break;
    if (signal?.aborted) throw new Error('Catalog cancelled');
    if (++count > MAX_ROWS + 1) throw new Error('Oversized catalog');
    if (count % 128 === 0) await yieldTurn();
    const headEnd = table.indexOf('>', opening.lastIndex);
    if (headEnd < 0) throw new Error('Incomplete catalog row');
    closing.lastIndex = headEnd + 1;
    const end = closing.exec(table);
    if (!end || closing.lastIndex - match.index > 24_000 || /<tr\b/i.test(table.slice(headEnd + 1, end.index)))
      throw new Error('Invalid catalog row structure');
    opening.lastIndex = closing.lastIndex;
    const { header, values: cells } = rowCells(table.slice(match.index, closing.lastIndex));
    if (header) {
      if (headerSeen || rows.length || cells.length !== HEADINGS.length || cells.some((cell, index) => cell !== HEADINGS[index]))
        throw new Error('Catalog headings changed');
      headerSeen = true;
      continue;
    }
    if (!headerSeen || cells.length !== 9) throw new Error('Catalog row schema changed');
    const id = cells[2], title = cells[3], artist = cells[4], language = cells[6];
    if (!/^PH\d{3,9}$/.test(id) || seen.has(id) || !field(title, 512) || !field(artist, 512) || !field(language, 80))
      throw new Error('Invalid catalog metadata');
    seen.add(id);
    rows.push({ provider: 'partytyme', id, title, artist, language, durationSeconds: duration(cells[8]),
      webUrl: PARTY_TYME_CATALOG_URL, playbackAvailable: false });
  }
  if (!headerSeen || rows.length === 0 || (table.match(/<tr\b/gi) ?? []).length !== count) throw new Error('Incomplete catalog');
  return rows;
}

async function readHtml(response: Response, signal: AbortSignal): Promise<string> {
  const size = response.headers.get('content-length');
  if (size && (!/^\d+$/.test(size) || Number(size) > MAX_BYTES)) {
    void response.body?.cancel().catch(() => {}); throw new Error('Oversized catalog');
  }
  if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    void response.body?.cancel().catch(() => {}); throw new Error('Unexpected catalog format');
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let html = '', bytes = 0, finished = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new Error('Catalog cancelled');
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Oversized catalog');
      html += decoder.decode(value, { stream: true });
    }
    const result = html + decoder.decode(); finished = true; return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!finished || signal.aborted) cancel();
    reader.releaseLock();
  }
}

export class PartyTymeCatalogClient {
  #fetch: Fetch;
  #now: () => number;
  #timeoutMs: number;
  #snapshot: { loadedAt: number; rows: Row[] } | null = null;
  #pending: Promise<Loaded> | null = null;
  #nextAttempt = -Infinity;
  #lastFailure: Failure = 'unavailable';

  constructor(options: { fetch?: Fetch; now?: () => number; timeoutMs?: number } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 60_000) throw new Error('Invalid catalog timeout');
  }

  private async refresh(): Promise<Loaded> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
    const timeout = new Promise<Loaded>(resolve => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); resolve({ status: 'timed-out' }); }, this.#timeoutMs);
    });
    const work = (async (): Promise<Loaded> => {
      try {
        const response = await this.#fetch(PARTY_TYME_CATALOG_URL, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'text/html' }, signal: controller.signal });
        if (timedOut) { void response.body?.cancel().catch(() => {}); return { status: 'timed-out' }; }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          return { status: response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate-limited' : 'unavailable' };
        }
        try {
          const songs = await parsePartyTymeCatalog(await readHtml(response, controller.signal), controller.signal);
          const rows = songs.map(song => ({ song, title: normal(song.title), artist: normal(song.artist ?? ''),
            searchable: normal([song.id, song.title, song.artist].join(' ')) }));
          return { status: 'ok', rows };
        } catch { return { status: timedOut ? 'timed-out' : 'invalid-response' }; }
      } catch { return { status: timedOut ? 'timed-out' : 'unavailable' }; }
    })();
    try {
      const loaded = await Promise.race([work, timeout]);
      const now = this.#now();
      if (loaded.status === 'ok') { this.#snapshot = { loadedAt: now, rows: loaded.rows }; this.#nextAttempt = now + DAY; }
      else { this.#lastFailure = loaded.status; this.#nextAttempt = now + RETRY_GAP; }
      return loaded;
    } finally { if (timer) clearTimeout(timer); }
  }

  async search(query: string): Promise<ProviderCatalogSearchResult> {
    const base = { provider: 'partytyme' as const, label: 'Party Tyme' };
    if (typeof query !== 'string' || !TEXT.test(query) || query.trim().length < 2 || query.trim().length > 160)
      return { ...base, status: 'invalid-input', songs: [], message: 'Enter 2–160 characters to search Party Tyme.' };
    const text = normal(query), words = text.split(' ');
    if (text.length < 2) return { ...base, status: 'invalid-input', songs: [], message: 'Enter at least two searchable characters.' };
    const now = this.#now();
    if (!Number.isFinite(now)) return { ...base, status: 'unavailable', songs: [], message: 'Party Tyme catalog is unavailable.' };
    if (!this.#snapshot || now - this.#snapshot.loadedAt >= DAY) {
      if (!this.#pending && now >= this.#nextAttempt) this.#pending = this.refresh().finally(() => { this.#pending = null; });
      if (this.#pending) await this.#pending;
    }
    if (!this.#snapshot) return { ...base, status: this.#lastFailure, songs: [],
      message: this.#lastFailure === 'rate-limited' ? 'Party Tyme catalog is rate limited; try again later.' : 'Party Tyme catalog could not be loaded; try again later.' };
    const snapshot = this.#snapshot;
    const matches: { row: Row; score: number }[] = [];
    let index = 0;
    for (const row of snapshot.rows) {
      if (++index % 1024 === 0) await yieldTurn();
      if (words.every(word => row.searchable.includes(word))) matches.push({ row,
        score: normal(row.song.id) === text ? 0 : row.title === text ? 1 : row.artist === text ? 2 : row.title.startsWith(text) ? 3 : 4 });
    }
    matches.sort((a, b) => a.score - b.score || a.row.song.title.localeCompare(b.row.song.title, 'en') || a.row.song.id.localeCompare(b.row.song.id));
    const stale = this.#now() - snapshot.loadedAt >= DAY;
    return { ...base, status: 'ok', songs: matches.slice(0, MAX_RESULTS).map(match => ({ ...match.row.song })),
      message: stale ? 'Search only. Using an older cached Party Tyme catalog because refresh failed; playback is not connected.' :
        'Search only. Party Tyme public catalog; playback is not connected.' };
  }
}

const publicCatalog = new PartyTymeCatalogClient();

/** The public metadata catalog does not need or read a private account profile. */
export function searchPartyTymeCatalog(_profilePath: string | undefined, query: string): Promise<ProviderCatalogSearchResult> {
  return publicCatalog.search(query);
}

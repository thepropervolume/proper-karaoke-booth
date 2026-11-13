/** Private backend-only client for the documented Stingray v1 device and search APIs. */
import { readStingrayJson } from './stingray-auth';

const BASE = 'https://karaoke-api-service-prod.stingray.com';
const TOKEN = /^[\x21-\x7e]{1,8192}$/;
const TEXT = /^[^\x00-\x1f\x7f\ufffd]*$/u;
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type StingrayStatus = 'ok' | 'invalid-input' | 'unauthorized' | 'rate-limited' | 'invalid-response' | 'timed-out' | 'unavailable';
export type StingraySong = { id: string; title: string; artist: string | null; durationSeconds: number | null };
export type StingraySearchResult = { status: 'ok'; songs: StingraySong[] } | { status: Exclude<StingrayStatus, 'ok'> };
export type StingrayDevice = { deviceId: string; languageCode: 'en' | 'fr'; countryCode: string };

function field(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && TEXT.test(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
type Reply = { status: 'ok'; body: unknown } | { status: Exclude<StingrayStatus, 'ok'> };

/** This class is intended for the trusted service, not Electron renderer code. */
export class StingrayCatalogClient {
  #token: string | null = null;
  #expiresAt = 0;
  #apiKey: string;
  #fetch: Fetch;
  #now: () => number;
  #timeoutMs: number;
  #lastSearch = -Infinity;
  #searching = false;
  #sessionRevision = 0;

  constructor(apiKey: string, options: { fetch?: Fetch; now?: () => number; timeoutMs?: number } = {}) {
    if (typeof apiKey !== 'string' || !TOKEN.test(apiKey) || apiKey.length > 1024) throw new Error('Invalid Stingray configuration.');
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid Stingray configuration.');
    this.#apiKey = apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = timeoutMs;
  }

  private async request(path: string, init: RequestInit, limit: number): Promise<Reply> {
    const controller = new AbortController(); let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Reply>(resolve => { timer = setTimeout(() => {
      timedOut = true; controller.abort(); resolve({ status: 'timed-out' });
    }, this.#timeoutMs); });
    const work = (async (): Promise<Reply> => {
    try {
      const response = await this.#fetch(BASE + path, { ...init, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
      if (timedOut) { if (response.body) void response.body.cancel().catch(() => {}); return { status: 'timed-out' }; }
      if (response.status !== 200) {
        if (response.body) void response.body.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
        if (response.status === 429) return { status: 'rate-limited' };
        return { status: 'unavailable' };
      }
      try { return { status: 'ok', body: await readStingrayJson(response, limit, controller.signal) }; }
      catch { return { status: timedOut ? 'timed-out' : 'invalid-response' }; }
    } catch { return { status: timedOut ? 'timed-out' : 'unavailable' }; }
    })();
    try { return await Promise.race([work, timeout]); }
    finally { if (timer) clearTimeout(timer); }
  }

  /** Establish an in-memory v1 device session; never return its token. */
  async connect(device: StingrayDevice): Promise<StingrayStatus> {
    const revision = ++this.#sessionRevision;
    this.#token = null; this.#expiresAt = 0;
    if (!device || !field(device.deviceId, 256) || !['en', 'fr'].includes(device.languageCode) ||
        typeof device.countryCode !== 'string' || !/^[A-Z]{2}$/.test(device.countryCode)) return 'invalid-input';
    const result = await this.request('/v1/login-device', { method: 'POST',
      headers: { 'X-API-KEY': this.#apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ device_id: device.deviceId, language_code: device.languageCode, country_code: device.countryCode }) }, 64 * 1024);
    if (revision !== this.#sessionRevision) return 'unavailable';
    if (result.status !== 'ok') return result.status;
    if (!object(result.body) || typeof result.body.token !== 'string' || !TOKEN.test(result.body.token) ||
        !Number.isSafeInteger(result.body.duration_ms) || (result.body.duration_ms as number) <= 0 ||
        (result.body.duration_ms as number) > 2_147_483_647 || !Number.isFinite(this.#now())) return 'invalid-response';
    this.#token = result.body.token;
    this.#expiresAt = this.#now() + (result.body.duration_ms as number);
    return 'ok';
  }

  /** Search returns only minimal metadata. Protected URLs and provider data never leave this boundary. */
  async searchSongs(text: string, options: { page?: number; size?: number } = {}): Promise<StingraySearchResult> {
    const page = options.page ?? 1, size = options.size ?? 20;
    if (typeof text !== 'string' || text.trim().length < 3 || text.trim().length > 40 || !TEXT.test(text) ||
        !Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(size) || size < 1 || size > 100)
      return { status: 'invalid-input' };
    if (!this.#token || this.#now() >= this.#expiresAt) { this.#token = null; return { status: 'unauthorized' }; }
    const token = this.#token, revision = this.#sessionRevision;
    const now = this.#now();
    if (!Number.isFinite(now) || this.#searching || now - this.#lastSearch < 100) return { status: 'rate-limited' };
    this.#lastSearch = now; this.#searching = true;
    try {
      const query = new URLSearchParams({ text: text.trim(), page: String(page), size: String(size), 'search-fields': 'title,artists' });
      const result = await this.request('/v1/search-songs?' + query.toString(), { method: 'GET',
        headers: { 'X-API-KEY': this.#apiKey, Authorization: `Bearer ${token}`, Accept: 'application/json' } }, 1024 * 1024);
      if (revision !== this.#sessionRevision) return { status: 'unauthorized' };
      if (result.status !== 'ok') { if (result.status === 'unauthorized') this.#token = null; return result; }
      if (!object(result.body) || !Array.isArray(result.body.songs) || result.body.songs.length > size) return { status: 'invalid-response' };
      const songs: StingraySong[] = [];
      for (const entry of result.body.songs) {
        if (!object(entry) || !field(entry.id, 256) || !field(entry.title, 512) ||
            !(entry.artist_display_name === undefined || entry.artist_display_name === null || field(entry.artist_display_name, 512)) ||
            !(entry.duration_sec === undefined || entry.duration_sec === null || Number.isSafeInteger(entry.duration_sec) && (entry.duration_sec as number) >= 0))
          return { status: 'invalid-response' };
        if ([entry.id, entry.title, entry.artist_display_name].some(value => typeof value === 'string' &&
            (value.includes(this.#apiKey) || value.includes(token) || /https?:\/\//iu.test(value)))) return { status: 'invalid-response' };
        songs.push({ id: entry.id, title: entry.title, artist: typeof entry.artist_display_name === 'string' ? entry.artist_display_name : null,
          durationSeconds: typeof entry.duration_sec === 'number' ? entry.duration_sec : null });
      }
      return { status: 'ok', songs };
    } finally { this.#searching = false; }
  }

  disconnect(): void { this.#sessionRevision++; this.#token = null; this.#expiresAt = 0; }
}

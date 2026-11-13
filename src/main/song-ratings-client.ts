import { parseRecordingKeys, parseSongRating, isRecordingKey, validHeartVote, type RecordingKey, type SongRating } from '../domain/song-rating';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type RatingsFailureCode = 'configuration-error' | 'configuration-required' | 'unauthorized' | 'forbidden' | 'rate-limited' | 'unavailable' | 'timed-out' | 'invalid-request' | 'invalid-response';
export type RatingsFailure = { status: RatingsFailureCode };
export type SongRatingsLookup = {status:'ready';items:SongRating[];canVote:boolean} | RatingsFailure;
export type SongRatingVote = {status:'ready';item:SongRating;canVote:true} | RatingsFailure;
const MAX_BODY = 128 * 1024;

/** A metadata-only HTTPS client; it cannot access playback, media or database credentials. */
export class SongRatingsClient {
  private readonly origin: string;
  private readonly token: string | null;
  private readonly fetcher: FetchFn;
  private readonly timeoutMs: number;
  private denied: 'unauthorized' | 'forbidden' | null = null;
  private authorizationEpoch = 0;
  constructor(options: {baseUrl:string;token?:string;fetch?:FetchFn;timeoutMs?:number}) {
    try {
      const url = new URL(options.baseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || url.pathname !== '/' ||
          (options.token !== undefined && (typeof options.token !== 'string' || !/^[A-Za-z0-9._~-]{32,256}$/.test(options.token))) ||
          (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000))) throw new Error();
      this.origin = url.origin; this.token = options.token ?? null; this.fetcher = options.fetch ?? fetch; this.timeoutMs = options.timeoutMs ?? 10000;
    } catch { throw new Error('Invalid song ratings connection.'); }
  }
  async lookup(value: unknown): Promise<SongRatingsLookup> {
    let keys: RecordingKey[];
    try { keys = parseRecordingKeys(value); } catch { return {status:'invalid-request'}; }
    const result = await this.request('POST', '/v1/ratings/lookup', {recordingKeys:keys});
    if (result.status !== 'ok') return result;
    const body = result.value;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray((body as {items?:unknown}).items)) return {status:'invalid-response'};
    const raw = (body as {items:unknown[]}).items;
    if (raw.length !== keys.length) return {status:'invalid-response'};
    const items: SongRating[] = [], seen = new Set<string>(), requested = new Set(keys);
    for (const value of raw) {
      const item = parseSongRating(value);
      if (!item || !requested.has(item.recordingKey) || seen.has(item.recordingKey) || (this.token === null && item.ownVote !== null)) return {status:'invalid-response'};
      seen.add(item.recordingKey); items.push(item);
    }
    return {status:'ready',items,canVote:this.token !== null};
  }
  async vote(recordingKey: unknown, value: unknown): Promise<SongRatingVote> {
    if (!isRecordingKey(recordingKey) || !validHeartVote(value)) return {status:'invalid-request'};
    if (this.token === null) return {status:'configuration-required'};
    const result = await this.request('PUT', '/v1/ratings/vote', {recordingKey,value});
    if (result.status !== 'ok') return result;
    const item = parseSongRating(result.value);
    if (!item || item.recordingKey !== recordingKey || item.ownVote !== value) return {status:'invalid-response'};
    return {status:'ready',item,canVote:true};
  }
  private async request(method: 'POST' | 'PUT', path: string, body: unknown): Promise<{status:'ok';value:unknown} | RatingsFailure> {
    const epoch = this.authorizationEpoch, controller = new AbortController();
    let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<RatingsFailure>(resolve => { timer = setTimeout(() => { expired = true; controller.abort(); resolve({status:'timed-out'}); },this.timeoutMs); });
    const work = (async (): Promise<{status:'ok';value:unknown} | RatingsFailure> => {
      let received = false;
      try {
        const response = await this.fetcher(this.origin + path, {method,headers:{Accept:'application/json','Content-Type':'application/json',...(this.token === null ? {} : {Authorization:`Bearer ${this.token}`})},
          body:JSON.stringify(body),redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
        received = true;
        if (expired) { void response.body?.cancel().catch(() => {}); return {status:'timed-out'}; }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          return {status:response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'unavailable' : 'invalid-response'};
        }
        if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length') ?? 0) > MAX_BODY) throw new Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        const abort = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener('abort',abort,{once:true});
        try {
          for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY) throw new Error(); chunks.push(part.value); }
        } finally { controller.signal.removeEventListener('abort',abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
        if (expired) return {status:'timed-out'};
        return {status:'ok',value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)))};
      } catch { return {status:expired || controller.signal.aborted ? 'timed-out' : received ? 'invalid-response' : 'unavailable'}; }
    })();
    let result: Awaited<typeof work>;
    try { result = await Promise.race([work,deadline]); } finally { if (timer) clearTimeout(timer); }
    if (result.status === 'unauthorized' || result.status === 'forbidden') { this.denied = result.status; ++this.authorizationEpoch; }
    if (result.status === 'ok') {
      if (epoch !== this.authorizationEpoch && this.denied) return {status:this.denied};
      this.denied = null;
    }
    return result;
  }
}

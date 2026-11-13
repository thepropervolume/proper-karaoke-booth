/** Ratings boundary: a bearer grants exactly one voter, never a role or user id. */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRecordingKey, RatingsError, type RecordingRating } from './schema';

export type RatingsStore = {
  authenticate(hash: string): Promise<string | null>;
  lookup(keys: readonly string[], voterId: string | null, expectedTokenHashHex?: string): Promise<RecordingRating[]>;
  vote(key: string, value: number | null, voterId: string, expectedTokenHashHex?: string): Promise<RecordingRating>;
};
type Bucket = { tokens: number; at: number };
export type RatingsHttpOptions = { store: RatingsStore; now?: () => number; allowedHost?: string };

function reply(res: ServerResponse, status: number, value: unknown): void {
  const data = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(status >= 400 ? { Connection: 'close' } : {}),
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}), ...(status === 429 ? { 'Retry-After': '5' } : {}) });
  res.end(data);
}
function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
}
function project(value: RecordingRating, expected: string): RecordingRating {
  if (!value || value.recordingKey !== expected || !Number.isSafeInteger(value.count) || value.count < 0 ||
      !(value.average === null && value.count === 0 || typeof value.average === 'number' && Number.isFinite(value.average) && value.average >= 1 && value.average <= 10 && value.count > 0) ||
      !(value.ownVote === null || Number.isInteger(value.ownVote) && value.ownVote >= 1 && value.ownVote <= 10) || value.count === 0 && value.ownVote !== null)
    throw new Error('Invalid ratings result.');
  return { recordingKey: value.recordingKey, average: value.average, count: value.count, ownVote: value.ownVote };
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (req.aborted || req.destroyed) throw new RatingsError(400, 'invalid-request');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new RatingsError(400, 'invalid-request');
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 12_288)) throw new RatingsError(400, 'invalid-request');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0, settled = false;
    const clean = () => { clearTimeout(timer); req.removeListener('data', data); req.removeListener('end', end); req.removeListener('aborted', fail); req.removeListener('close', close); };
    const fail = () => { if (!settled) { settled = true; clean(); reject(new RatingsError(400, 'invalid-request')); } };
    const close = () => { if (!req.complete) fail(); };
    const data = (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > 12_288) { fail(); return; }
      chunks.push(chunk);
    };
    const end = () => {
      if (settled) return;
      settled = true; clean();
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(new RatingsError(400, 'invalid-request')); }
    };
    const timer = setTimeout(fail, 3_000); timer.unref();
    req.on('data', data); req.once('aborted', fail); req.once('error', fail); req.once('close', close); req.once('end', end);
  });
}

/** Caller binds loopback only; Apache must overwrite X-TPV-Client-IP from REMOTE_ADDR. */
export function createRatingsHttpHandler(options: RatingsHttpOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const now = options.now ?? Date.now;
  const global: Bucket = { tokens: 100, at: now() }, clients = new Map<string, Bucket>(), voters = new Map<string, Bucket>();
  let inFlight = 0;
  function take(bucket: Bucket, capacity: number, rate: number): boolean {
    const at = now(); bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, at - bucket.at) * rate / 1000); bucket.at = at;
    if (bucket.tokens < 1) return false;
    bucket.tokens--; return true;
  }
  function scoped(map: Map<string, Bucket>, key: string, capacity: number, rate: number): boolean {
    const at = now();
    if (!map.has(key)) {
      if (map.size >= 4096) for (const [id, bucket] of map) if (at - bucket.at > 300_000) map.delete(id);
      if (map.size >= 4096) return false;
      map.set(key, { tokens: capacity, at });
    }
    return take(map.get(key)!, capacity, rate);
  }
  return async (req, res) => {
    let entered = false;
    try {
      if (options.allowedHost && ![options.allowedHost, options.allowedHost + ':443'].includes((req.headers.host ?? '').toLowerCase())) {
        reply(res, 403, { error: 'forbidden' }); return;
      }
      if (options.allowedHost && req.headers.origin !== undefined && req.headers.origin !== `https://${options.allowedHost}`) {
        reply(res, 403, { error: 'forbidden' }); return;
      }
      if (req.url !== '/v1/ratings/lookup' && req.url !== '/v1/ratings/vote') { reply(res, 404, { error: 'not-found' }); return; }
      const write = req.url === '/v1/ratings/vote';
      if (req.method !== (write ? 'PUT' : 'POST')) { reply(res, 405, { error: 'method-not-allowed' }); return; }
      const rawIp = req.headers['x-tpv-client-ip'];
      const ip = typeof rawIp === 'string' && isIP(rawIp) ? rawIp : req.socket.remoteAddress ?? 'loopback';
      const client = createHash('sha256').update(ip).digest('hex');
      if (!take(global, 100, 4) || !scoped(clients, client, 60, 1)) { reply(res, 429, { error: 'rate-limited' }); return; }
      if (inFlight >= 8) { reply(res, 503, { error: 'ratings-unavailable' }); return; }
      inFlight++; entered = true;
      const authCount = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'authorization').length;
      const auth = req.headers.authorization;
      let voter: string | null = null, tokenHash: string | undefined;
      if (authCount > 0) {
        const match = typeof auth === 'string' && /^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(auth);
        if (authCount !== 1 || !match) { reply(res, 401, { error: 'unauthorized' }); return; }
        tokenHash = createHash('sha256').update(match[1]).digest('hex');
        voter = await options.store.authenticate(tokenHash);
        if (!voter) { reply(res, 401, { error: 'unauthorized' }); return; }
      }
      if (write && !voter) { reply(res, 401, { error: 'unauthorized' }); return; }
      const input = await body(req);
      if (write) {
        if (!object(input, ['recordingKey', 'value']) || !isRecordingKey(input.recordingKey) ||
            !(input.value === null || Number.isInteger(input.value) && Number(input.value) >= 1 && Number(input.value) <= 10))
          throw new RatingsError(400, 'invalid-request');
        if (!scoped(voters, voter!, 20, 1 / 3)) { reply(res, 429, { error: 'rate-limited' }); return; }
        const result = await options.store.vote(input.recordingKey, input.value as number | null, voter!, tokenHash);
        reply(res, 200, project(result, input.recordingKey));
      } else {
        if (!object(input, ['recordingKeys']) || !Array.isArray(input.recordingKeys) || input.recordingKeys.length > 100 ||
            !input.recordingKeys.every(isRecordingKey) || new Set(input.recordingKeys).size !== input.recordingKeys.length)
          throw new RatingsError(400, 'invalid-request');
        const keys = input.recordingKeys as string[], results = await options.store.lookup(keys, voter, tokenHash);
        if (!Array.isArray(results) || results.length !== keys.length) throw new Error('Invalid ratings result.');
        const items = results.map((item, index) => project(item, keys[index]));
        if (!voter && items.some(item => item.ownVote !== null)) throw new Error('Invalid anonymous result.');
        reply(res, 200, { items });
      }
    } catch (error) {
      if (!res.headersSent) {
        const status = error instanceof RatingsError ? error.status : 503;
        reply(res, status, { error: status === 401 ? 'unauthorized' : status === 400 ? 'invalid-request' : 'ratings-unavailable' });
      } else res.destroy();
    } finally { if (entered) inFlight--; if (!req.complete) req.resume(); }
  };
}

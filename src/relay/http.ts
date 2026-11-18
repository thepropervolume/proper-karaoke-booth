/** Exact-origin, guest-only relay boundary. The desktop remains the show authority. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { SingerStaticHandler } from '../main/remote-static';
import { RelayBroker } from './broker';
import { RelayError } from './store';
import { isRelaySecret, isRelaySlug, isRelayUuid, MAX_HOST_REPLY_BYTES, parseGuestRequest, parseHostOpen, parseRoomIdentity } from './protocol';
import { MobileHostAccess, NearbyRooms } from './mobile-access';
import { MAX_PHOTO_BODY_BYTES } from '../domain/photo';
import { searchMobileCatalog } from './mobile-catalog';
import { version as appVersion } from '../../package.json';

export type RelayOwner = { id: string; tokenSha256: string };
type Options = { publicOrigin: string; owners: readonly RelayOwner[]; broker: RelayBroker; staticHandler: SingerStaticHandler;
  trustProxy?: boolean; rateNow?: () => number; bodyTimeoutMs?: number; onFailure?: () => void; isReady?: () => boolean;
  mobileEnabled?: boolean; mobileCatalog?: typeof searchMobileCatalog };
const POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const HOST_ROUTE = /^\/v1\/relay\/host\/(open|poll|reply|close)$/;
const GUEST_ROUTE = /^\/v1\/relay\/rooms\/([^/]+)\/([^/]+)\/guest\/([a-z-]+)$/;
const LOOKUP_ROUTE = /^\/v1\/relay\/lookup\/([a-z0-9-]+)$/;
class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }

function headerCount(request: IncomingMessage, name: string): number {
  let count = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i].toLowerCase() === name) count++;
  return count;
}
function respond(response: ServerResponse, status: number, value: unknown, html = false): void {
  if (response.destroyed || response.writableEnded) return;
  const bytes = Buffer.from(html ? String(value) : JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'Content-Security-Policy': POLICY,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin',
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}), ...(status === 429 ? { 'Retry-After': '60' } : {}) });
  response.end(bytes);
}
function bearer(request: IncomingMessage): string | undefined {
  const count = headerCount(request, 'authorization');
  if (count === 0) return undefined;
  const value = request.headers.authorization;
  if (count !== 1 || typeof value !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(401, 'UNAUTHORIZED');
  return value.slice(7);
}
function readJson(request: IncomingMessage, max: number, timeoutMs: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding'])
    throw new HttpError(415, 'JSON_REQUIRED');
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > max)) throw new HttpError(413, 'BODY_TOO_LARGE');
  return new Promise((resolve, reject) => {
    let size = 0, done = false; const chunks: Buffer[] = [];
    const timer = setTimeout(() => finish(new HttpError(408, 'BODY_TIMEOUT')), timeoutMs); timer.unref();
    const finish = (error?: Error, value?: unknown) => {
      if (done) return; done = true; clearTimeout(timer);
      request.once('error', () => {});
      request.removeListener('data', data); request.removeListener('end', end); request.removeListener('error', failed); request.removeListener('aborted', aborted);
      if (error) { request.resume(); reject(error); } else resolve(value);
    };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > max) finish(new HttpError(413, 'BODY_TOO_LARGE')); else chunks.push(chunk); };
    const failed = () => finish(new HttpError(400, 'INVALID_BODY'));
    const aborted = () => finish(new HttpError(400, 'INVALID_BODY'));
    const end = () => {
      try { finish(undefined, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)))); }
      catch { finish(new HttpError(400, 'INVALID_JSON')); }
    };
    request.on('data', data); request.once('end', end); request.once('error', failed); request.once('aborted', aborted);
  });
}

/** Fixed-window buckets have a hard cardinality cap and use a monotonic clock. */
export class RelayRateLimits {
  private readonly entries = new Map<string, { count: number; until: number }>();
  constructor(private readonly now: () => number = () => performance.now()) {}
  take(key: string, limit: number, period = 60_000): boolean {
    const now = this.now();
    if (!Number.isFinite(now) || now < 0) return false;
    const current = this.entries.get(key);
    if (current && now < current.until) return ++current.count <= limit;
    if (this.entries.size >= 10_000) for (const [name, item] of this.entries) if (item.until <= now) this.entries.delete(name);
    if (!current && this.entries.size >= 10_000) return false;
    this.entries.set(key, { count: 1, until: now + period }); return true;
  }
}

export function createQueueRelayHandler(options: Options) {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== options.publicOrigin || origin.username || origin.password || origin.port ||
      !Array.isArray(options.owners) || options.owners.length < 1 || options.owners.length > 100) throw new Error('Invalid relay configuration.');
  const ids = new Set<string>(), hashes = new Set<string>();
  const owners = options.owners.map(owner => {
    if (!owner || !isRelayUuid(owner.id) || !/^[a-f0-9]{64}$/.test(owner.tokenSha256) || ids.has(owner.id) || hashes.has(owner.tokenSha256)) throw new Error('Invalid relay owner configuration.');
    ids.add(owner.id); hashes.add(owner.tokenSha256); return { id: owner.id, hash: Buffer.from(owner.tokenSha256, 'hex') };
  });
  const limits = new RelayRateLimits(options.rateNow);
  const mobile = new MobileHostAccess(), nearby = new NearbyRooms();
  const bodyTimeout = options.bodyTimeoutMs ?? 5_000;
  let photoReaders = 0;
  if (!Number.isSafeInteger(bodyTimeout) || bodyTimeout < 1 || bodyTimeout > 10_000) throw new Error('Invalid relay configuration.');
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const controller = new AbortController();
    const disconnected = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', disconnected);
    try {
      if (headerCount(request, 'host') !== 1 || request.headers.host?.toLowerCase() !== origin.host || !request.url ||
          request.url.length > 2048 || !request.url.startsWith('/') || request.url.startsWith('//') || /[?#%\\\x00-\x20\x7f]/.test(request.url)) throw new HttpError(400, 'INVALID_REQUEST');
      if (headerCount(request, 'origin') > 1 || request.headers.origin !== undefined && request.headers.origin !== origin.origin) throw new HttpError(403, 'ORIGIN_DENIED');
      let client = request.socket.remoteAddress ?? 'unknown';
      if (options.trustProxy) {
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(client) || headerCount(request, 'x-tpv-client-ip') !== 1 ||
            typeof request.headers['x-tpv-client-ip'] !== 'string' || !isIP(request.headers['x-tpv-client-ip'])) throw new HttpError(400, 'PROXY_IDENTITY_REQUIRED');
        client = request.headers['x-tpv-client-ip'];
      }
      if (!limits.take('global', 12_000) || !limits.take('ip:' + client, 6_000)) throw new HttpError(429, 'RATE_LIMITED');
      const path = request.url;
      if (request.method === 'GET') {
        if (path === '/v1/mobile/nearby' && options.mobileEnabled) {
          if (!limits.take('nearby:' + client, 60)) throw new HttpError(429, 'RATE_LIMITED');
          respond(response, 200, { rooms: await nearby.discover(client, slug => options.broker.lookup(slug)), method: 'same-egress' }); return;
        }
        if (path === '/healthz') {
          const ready = options.isReady?.() ?? true;
          respond(response, ready ? 200 : 503, { status: ready ? 'ok' : 'unavailable', version: appVersion }); return;
        }
        const lookup = LOOKUP_ROUTE.exec(path);
        if (lookup) {
          if (!isRelaySlug(lookup[1])) throw new HttpError(400, 'INVALID_SLUG');
          if (!limits.take('lookup:' + client, 600)) throw new HttpError(429, 'RATE_LIMITED');
          const room = await options.broker.lookup(lookup[1]);
          if (!room) throw new HttpError(404, 'ROOM_UNAVAILABLE');
          respond(response, 200, room); return;
        }
        if (path === '/') {
          respond(response, 200, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Proper Volume Karaoke Queue</title><main><h1>The Proper Volume Karaoke Queue</h1><p>Open the session link shared by your karaoke host to choose a song and join the queue.</p><p>Hosts create a session in The Proper Volume Karaoke Booth application.</p></main></html>', true); return;
        }
        if (/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2?)$/.test(path)) {
          if (await options.staticHandler(request, response)) return;
        } else if (isRelaySlug(path.replace(/^\//, '').replace(/\/$/, ''))) {
          request.url = '/singer/';
          try { if (await options.staticHandler(request, response)) return; }
          finally { request.url = path; }
        }
        throw new HttpError(404, 'NOT_FOUND');
      }
      if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      if ((path === '/v1/mobile/hosts' || path === '/v1/mobile/catalog') && options.mobileEnabled) {
        if (request.headers.origin !== origin.origin) throw new HttpError(403, 'ORIGIN_REQUIRED');
        if (!limits.take(path + ':' + client, path.endsWith('/hosts') ? 5 : 60, path.endsWith('/hosts') ? 60 * 60_000 : 60_000) ||
            !limits.take(path, path.endsWith('/hosts') ? 200 : 600)) throw new HttpError(429, 'RATE_LIMITED');
        const input = await readJson(request, 2048, bodyTimeout);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'INVALID_REQUEST');
        if (path.endsWith('/hosts')) {
          if (Object.keys(input).length) throw new HttpError(400, 'INVALID_REQUEST');
          respond(response, 200, mobile.issue()); return;
        }
        if (Object.keys(input).join(',') !== 'query' || !('query' in input) || typeof input.query !== 'string' || input.query.trim().length < 2 || input.query.length > 200 || /[\x00-\x1f\x7f]/.test(input.query)) throw new HttpError(400, 'INVALID_QUERY');
        respond(response, 200, await (options.mobileCatalog ?? searchMobileCatalog)(input.query.trim(), controller.signal)); return;
      }
      const host = HOST_ROUTE.exec(path);
      if (host) {
        const token = bearer(request);
        const digest = createHash('sha256').update(token ?? '').digest();
        let ownerId: string | undefined;
        for (const owner of owners) if (timingSafeEqual(digest, owner.hash)) ownerId = owner.id;
        if (!ownerId && token && options.mobileEnabled) ownerId = mobile.authenticate(token);
        if (!token || !ownerId) { if (!limits.take('failed-host:' + client, 30)) throw new HttpError(429, 'RATE_LIMITED'); throw new HttpError(401, 'UNAUTHORIZED'); }
        if (!limits.take('owner:' + ownerId, 3_000) || host[1] === 'open' && !limits.take('open:' + ownerId, 120, 3_600_000)) throw new HttpError(429, 'RATE_LIMITED');
        const input = await readJson(request, host[1] === 'reply' ? MAX_HOST_REPLY_BYTES : 8192, bodyTimeout);
        if (controller.signal.aborted) return;
        if (host[1] === 'open') {
          const value = parseHostOpen(input); if (!value) throw new HttpError(400, 'INVALID_OPEN');
          const room = await options.broker.open(ownerId, value);
          nearby.record(room, client, request.headers['x-tpv-room-discovery'] === 'yes');
          respond(response, 200, room); return;
        }
        if (host[1] === 'reply') { respond(response, 200, await options.broker.reply(ownerId, input)); return; }
        const identity = parseRoomIdentity(input); if (!identity) throw new HttpError(400, 'INVALID_ROOM');
        if (host[1] === 'close') { respond(response, 200, await options.broker.close(ownerId, identity)); nearby.forget(identity.roomId); return; }
        const result = await options.broker.poll(ownerId, identity, controller.signal);
        nearby.refresh(identity, client, request.headers['x-tpv-room-discovery'] === 'yes');
        respond(response, 200, { ...identity, ...result }); return;
      }
      const guest = GUEST_ROUTE.exec(path);
      if (!guest || !isRelayUuid(guest[1]) || !isRelayUuid(guest[2])) throw new HttpError(404, 'NOT_FOUND');
      if (request.headers.origin !== origin.origin) throw new HttpError(403, 'ORIGIN_REQUIRED');
      const token = bearer(request);
      if (guest[3] === 'photo' && !token) throw new HttpError(401, 'UNAUTHORIZED');
      if (!limits.take('guest-ip:' + client, 3_000)) throw new HttpError(429, 'RATE_LIMITED');
      const anonymous = ['admission', 'join', 'resume'].includes(guest[3]);
      const scope = token ? createHash('sha256').update(token).digest('hex') : client;
      if (!limits.take((anonymous ? 'admission:' : 'session:') + guest[1] + ':' + scope, anonymous ? 300 : 120)) throw new HttpError(429, 'RATE_LIMITED');
      const photo = guest[3] === 'photo';
      if (photo && (!limits.take('photo:' + client, 10) || photoReaders >= 16)) throw new HttpError(429, 'RATE_LIMITED');
      if (photo) photoReaders++;
      let input: unknown;
      try { input = await readJson(request, photo ? MAX_PHOTO_BODY_BYTES : 8192, bodyTimeout); }
      finally { if (photo) photoReaders--; }
      const parsed = parseGuestRequest(guest[3], input, token);
      if (!parsed) throw new HttpError(400, 'INVALID_GUEST_REQUEST');
      if (controller.signal.aborted) return;
      const result = await options.broker.invoke({ roomId: guest[1], generation: guest[2] }, parsed, controller.signal);
      respond(response, result.status, result.body);
    } catch (error) {
      const status = error instanceof HttpError || error instanceof RelayError ? error.status : 503;
      const code = error instanceof HttpError || error instanceof RelayError ? error.code : 'UNAVAILABLE';
      if (status === 413 || status === 408 || !request.complete) { response.setHeader('Connection', 'close'); request.resume(); }
      respond(response, status, { error: code });
    } finally { response.removeListener('close', disconnected); }
  };
}

export async function startQueueRelayService(options: Options & { port: number; closeDependencies: () => void | Promise<void> }) {
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Invalid relay port.');
  const handler = createQueueRelayHandler(options);
  const server = createServer((request, response) => { void handler(request, response).catch(() => response.destroy()); });
  server.maxConnections = 256; server.headersTimeout = 10_000; server.requestTimeout = 30_000; server.keepAliveTimeout = 2_000;
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', ready); server.listen(options.port, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') { server.close(); throw new Error('Invalid relay listener.'); }
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    let fenceFailed = false;
    try { await options.broker.stop(); } catch { fenceFailed = true; }
    try { await new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => server.closeAllConnections(), 5_000); force.unref();
      server.close(error => { clearTimeout(force); error ? reject(error) : resolve(); }); server.closeIdleConnections();
    }); } finally { await options.closeDependencies(); }
    if (fenceFailed) throw new Error('Relay shutdown failed.');
  })();
  server.on('error', () => { try { options.onFailure?.(); } catch {} void stop().catch(() => {}); });
  return { port: address.port, stop };
}

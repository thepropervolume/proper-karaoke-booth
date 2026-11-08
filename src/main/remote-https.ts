/** Optional HTTPS transport for an injected guest authority. It is never started automatically. */
import { X509Certificate } from 'node:crypto';
import { createServer, type Server, type ServerOptions } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { JoinRevisionConflict, type RemoteQueue } from './remote-queue';

type GuestAuthority = Pick<RemoteQueue, 'admissionInfo' | 'join' | 'resume' | 'snapshot' | 'catalog' | 'outcome' | 'submit' | 'submitMissing'>;
export type LanTransportOptions = {
  /** A specific local interface address, never a wildcard. */
  address: string;
  /** Browser-visible hostname covered by the provided certificate. */
  hostname: string;
  port: number;
  cert: string | Buffer;
  key: string | Buffer;
  authority: GuestAuthority;
  /** Surface unexpected listener failures to its owner. Must not log request credentials. */
  onError: (error: Error) => void;
  /** Test/installation-specific bounds. */
  requestsPerMinute?: number;
  maxConnections?: number;
  timeoutMs?: number;
};
export type LanTransport = { origin: string; close: () => Promise<void> };

const MAX_BODY = 8192;
// Allow a full 100-item page containing worst-case escaped metadata, with a hard ceiling.
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_CLIENTS = 2048;
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, fields: string[]): boolean { return Object.keys(value).every(key => fields.includes(key)) && fields.every(key => key in value); }
function hostForUrl(hostname: string): string { return isIP(hostname) === 6 ? `[${hostname}]` : hostname; }
function localAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return isIP(address) === 6 && (address === '::1' || /^(?:fc|fd|fe[89ab])/i.test(address));
}
function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAX_RESPONSE) { reply(response, 503, { error: 'Response is unavailable.' }); return; }
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  response.end(body);
}
function fail(response: ServerResponse, status: number): void { reply(response, status, { error: 'Request could not be completed.' }); }
class BodyLimitError extends Error {}
function refuseLarge(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Connection', 'close');
  response.once('finish', () => request.socket.destroy());
  fail(response, 413); request.resume();
}
function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new BodyLimitError()); request.resume(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('invalid JSON')); } });
    request.on('error', reject);
    request.on('aborted', () => reject(new Error('aborted')));
  });
}

/** Opens only the specified interface. Certificate trust/provisioning is the host's responsibility. */
export async function startLanTransport(options: LanTransportOptions, createServerFn: typeof createServer = createServer): Promise<LanTransport> {
  const { address, hostname, port, authority } = options;
  const maxRate = options.requestsPerMinute ?? 120;
  const maxConnections = options.maxConnections ?? 64;
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!localAddress(address) || !hostname || hostname !== hostname.toLowerCase() ||
      (!isIP(hostname) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)) ||
      !Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(maxRate) || maxRate < 1 || maxRate > 10000 ||
      !Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 1024 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000 || typeof options.onError !== 'function')
    throw new Error('A specific interface, valid hostname, port and rate limit are required.');
  const certificate = new X509Certificate(options.cert);
  const validNow = Date.now();
  if (validNow < Date.parse(certificate.validFrom) || validNow > Date.parse(certificate.validTo) ||
      !(isIP(hostname) ? certificate.checkIP(hostname) : certificate.checkHost(hostname)))
    throw new Error('The TLS certificate is expired, not yet valid, or does not cover the hostname.');
  const tls: ServerOptions = { cert: options.cert, key: options.key, minVersion: 'TLSv1.2', handshakeTimeout: timeoutMs,
    connectionsCheckingInterval: Math.max(100, Math.min(1000, timeoutMs)) };
  const limits = new Map<string, { start: number; count: number }>();
  let origin = '', hostHeader = '';
  const server: Server = createServerFn(tls, async (request, response) => {
    const addressKey = request.socket.remoteAddress ?? '';
    const now = Date.now();
    for (const [key, value] of limits) if (now - value.start >= 60000) limits.delete(key);
    let rate = limits.get(addressKey);
    if (!rate) {
      if (!addressKey || limits.size >= MAX_CLIENTS) { fail(response, 429); return; }
      rate = { start: now, count: 0 }; limits.set(addressKey, rate);
    }
    if (++rate.count > maxRate) { fail(response, 429); return; }
    if (request.headers.host !== hostHeader || request.headers.origin !== origin) { fail(response, 403); return; }
    if (request.method !== 'POST' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') ||
        !request.url || request.url.includes('?') || request.url.includes('#')) { fail(response, 400); return; }
    const length = request.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) { refuseLarge(request, response); return; }
    let payload: unknown;
    try { payload = await body(request); } catch (error) { if (error instanceof BodyLimitError) refuseLarge(request, response); else fail(response, 400); return; }
    if (!object(payload)) { fail(response, 400); return; }
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
    try {
      let result: unknown;
      switch (request.url) {
        case '/api/v1/admission':
          if (!exact(payload, ['invitation']) || bearer) throw new Error();
          result = authority.admissionInfo(payload.invitation); break;
        case '/api/v1/join':
          if (!exact(payload, ['invitation', 'joinId', 'resumeSecret', 'name', 'expectedRevision']) || bearer) throw new Error();
          result = authority.join(payload.invitation, payload.joinId, payload.resumeSecret, payload.name, payload.expectedRevision); break;
        case '/api/v1/resume':
          if (!exact(payload, ['resumeSecret']) || bearer) throw new Error();
          result = authority.resume(payload.resumeSecret); break;
        case '/api/v1/snapshot':
          if (!exact(payload, []) || !bearer) throw new Error();
          result = authority.snapshot(bearer); break;
        case '/api/v1/catalog':
          if (!exact(payload, ['offset', 'limit']) || !bearer || typeof payload.offset !== 'number' || typeof payload.limit !== 'number') throw new Error();
          result = authority.catalog(bearer, payload.offset, payload.limit); break;
        case '/api/v1/outcome':
          if (!exact(payload, ['commandId']) || !bearer) throw new Error();
          result = authority.outcome(bearer, payload.commandId); break;
        case '/api/v1/request':
          if (!exact(payload, ['command']) || !bearer) throw new Error();
          result = authority.submit(bearer, payload.command); break;
        case '/api/v1/missing-request':
          if (!exact(payload, ['command']) || !bearer) throw new Error();
          result = authority.submitMissing(bearer, payload.command); break;
        default: fail(response, 404); return;
      }
      reply(response, 200, result);
    } catch (error) {
      // This typed error is emitted only by the trusted authority before a join commits.
      if (request.url === '/api/v1/join' && error instanceof JoinRevisionConflict) reply(response, 409, { error: 'REVISION_CONFLICT' });
      else fail(response, 400);
    }
  });
  server.maxConnections = maxConnections;
  server.timeout = timeoutMs;
  server.on('secureConnection', socket => { socket.setTimeout(timeoutMs, () => socket.destroy()); });
  server.requestTimeout = timeoutMs;
  server.headersTimeout = timeoutMs;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  await new Promise<void>((resolve, reject) => {
    const error = (cause: Error) => reject(cause);
    server.once('error', error);
    server.listen({ host: address, port, exclusive: true }, () => {
      server.on('error', cause => { server.close(); try { options.onError(cause); } catch { /* owner callbacks must not crash the host */ } });
      server.off('error', error); resolve();
    });
  });
  const listening = server.address();
  if (!listening || typeof listening === 'string') { server.close(); throw new Error('Listener did not bind a TCP address.'); }
  const endpoint = new URL(`https://${hostForUrl(hostname)}:${listening.port}`);
  hostHeader = endpoint.host;
  origin = endpoint.origin;
  return { origin, close: () => new Promise((resolve, reject) => {
    if (!server.listening) { resolve(); return; }
    server.close(error => error ? reject(error) : resolve());
  }) };
}

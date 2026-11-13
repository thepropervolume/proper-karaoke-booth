/** Optional HTTPS transport for an injected guest authority. It is never started automatically. */
import { X509Certificate } from 'node:crypto';
import { createServer, type Server, type ServerOptions } from 'node:https';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { createGuestApiHandler, type GuestAuthority } from './remote-guest-api';
import type { SingerStaticHandler } from './remote-static';

export type LanTransportOptions = {
  /** A specific local interface address, never a wildcard. */
  address: string;
  /** Browser-visible hostname covered by the provided certificate. */
  hostname: string;
  port: number;
  cert: string | Buffer;
  key: string | Buffer;
  authority: GuestAuthority;
  /** Optional prebuilt allowlisted singer page; caller explicitly creates it. */
  staticHandler?: SingerStaticHandler;
  /** Surface unexpected listener failures to its owner. Must not log request credentials. */
  onError: (error: Error) => void;
  /** Test/installation-specific bounds. */
  requestsPerMinute?: number;
  maxConnections?: number;
  timeoutMs?: number;
};
export type LanTransport = { origin: string; close: () => Promise<void> };

// Allow a full 100-item page containing worst-case escaped metadata, with a hard ceiling.
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_CLIENTS = 2048;
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
  const guestApi = createGuestApiHandler(authority);
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
    if (request.headers.host !== hostHeader) { fail(response, 403); return; }
    if (request.method === 'GET' && options.staticHandler) {
      // Browser top-level navigation commonly omits Origin. If supplied, it
      // must still match; API calls below always require it.
      if (request.headers.origin !== undefined && request.headers.origin !== origin) { fail(response, 403); return; }
      if (request.headers['transfer-encoding'] !== undefined || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) {
        response.setHeader('Connection', 'close');
        response.once('finish', () => request.socket.destroy());
        fail(response, 400); request.resume(); return;
      }
      try { if (await options.staticHandler(request, response)) return; }
      catch { fail(response, 500); return; }
      fail(response, 404); return;
    }
    if (request.headers.origin !== origin) { fail(response, 403); return; }
    await guestApi(request, response);
  });
  const sockets = new Set<Duplex>();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = new Promise<void>((resolve, reject) => {
      if (!server.listening) { for (const socket of sockets) socket.destroy(); resolve(); return; }
      server.close(error => error ? reject(error) : resolve());
      // closeAllConnections covers HTTP requests; the raw set also includes
      // sockets that have not completed TLS or HTTP header parsing.
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
    });
    void closing.catch(() => { closing = undefined; });
    return closing;
  };
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
      server.on('error', cause => {
        void close().catch(() => {});
        try { options.onError(cause); } catch { /* owner callbacks must not crash the host */ }
      });
      server.off('error', error); resolve();
    });
  });
  const listening = server.address();
  if (!listening || typeof listening === 'string') { server.close(); throw new Error('Listener did not bind a TCP address.'); }
  const endpoint = new URL(`https://${hostForUrl(hostname)}:${listening.port}`);
  hostHeader = endpoint.host;
  origin = endpoint.origin;
  return { origin, close };
}

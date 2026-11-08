/** Development-only HTTPS gate. It opens only loopback and is never started automatically. */
import { createHash, X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { connect } from 'node:tls';

export type RelayHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
export type LoopbackGate = { readonly port: number; bindOrigin(origin: string): void; close(): Promise<void> };
/** Main-process-only recovery handle for a partially opened local listener. */
export class LoopbackOpenError extends Error {
  constructor(readonly retryCleanup: () => Promise<void>) { super('Loopback listener cleanup is incomplete.'); }
}
export function isQuickTunnelOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/.test(url.hostname);
  } catch { return false; }
}

/** Handler must itself enforce guest authentication, request limits and route schemas. */
export async function startQuickTunnelLoopback(options: { cert: Buffer; key: Buffer; ca: Buffer; handler: RelayHandler; onError: () => void; timeoutMs?: number }, createServerFn: typeof createServer = createServer): Promise<LoopbackGate> {
  const timeout = options.timeoutMs ?? 10000;
  if (!Buffer.isBuffer(options.cert) || !Buffer.isBuffer(options.key) || !Buffer.isBuffer(options.ca) ||
      typeof options.handler !== 'function' || typeof options.onError !== 'function' || !Number.isInteger(timeout) || timeout < 100 || timeout > 30000) throw new Error('Invalid loopback HTTPS configuration.');
  const cert = new X509Certificate(options.cert);
  const now = Date.now();
  if (!cert.checkIP('127.0.0.1') || now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) throw new Error('Loopback certificate is invalid.');
  let origin: string | null = null;
  let serverClosing: Promise<void> | undefined;
  const sockets = new Set<Duplex>();
  const limits = new Map<string, { start: number; count: number }>();
  let globalStart = Date.now(), globalCount = 0;
  const server = createServerFn({ cert: options.cert, key: options.key, minVersion: 'TLSv1.2', handshakeTimeout: timeout,
    connectionsCheckingInterval: Math.max(100, Math.min(1000, timeout)) }, async (req, res) => {
    const reject = (code: number) => { if (!res.headersSent && !res.destroyed) { res.writeHead(code, { 'Cache-Control': 'no-store', 'Content-Length': '0', 'Referrer-Policy': 'no-referrer' }); res.end(); } };
    if (!origin || req.headers.host !== new URL(origin).host) { reject(403); return; }
    if (!req.url || req.url.includes('?') || req.url.includes('#')) { reject(400); return; }
    const now = Date.now();
    if (now - globalStart >= 60000) { globalStart = now; globalCount = 0; }
    if (++globalCount > 1200) { reject(429); return; }
    for (const [id, limit] of limits) if (now - limit.start >= 60000) limits.delete(id);
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
    const client = token ? createHash('sha256').update(token).digest('hex') : 'anonymous';
    let limit = limits.get(client);
    if (!limit) { if (limits.size >= 2048) { reject(429); return; } limit = { start: now, count: 0 }; limits.set(client, limit); }
    if (++limit.count > 120) { reject(429); return; }
    if (req.method === 'GET') {
      if (req.headers.origin !== undefined && req.headers.origin !== origin) { reject(403); return; }
      if (req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) { reject(400); return; }
      if (req.url !== '/singer' && req.url !== '/singer/' && !req.url.startsWith('/assets/')) { reject(404); return; }
    } else if (req.method === 'POST') {
      if (req.headers.origin !== origin) { reject(403); return; }
      if (!['/api/v1/admission', '/api/v1/join', '/api/v1/resume', '/api/v1/snapshot', '/api/v1/catalog', '/api/v1/outcome', '/api/v1/request', '/api/v1/missing-request'].includes(req.url)) { reject(404); return; }
      const length = req.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 8192)) { reject(413); req.destroy(); return; }
      let bytes = 0;
      req.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 8192) { reject(413); req.destroy(); } });
    } else { reject(405); return; }
    try { if (!await options.handler(req, res)) reject(404); } catch { reject(500); }
  });
  server.maxConnections = 64; server.timeout = timeout; server.requestTimeout = timeout; server.headersTimeout = timeout;
  server.on('secureConnection', socket => { socket.setTimeout(timeout, () => socket.destroy()); });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const close = (): Promise<void> => {
    origin = null;
    if (serverClosing) return serverClosing;
    const closing = new Promise<void>((resolve, reject) => {
      if (!server.listening) { for (const socket of sockets) socket.destroy(); resolve(); return; }
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections(); for (const socket of sockets) socket.destroy();
    });
    serverClosing = closing;
    void closing.catch(() => { if (serverClosing === closing) serverClosing = undefined; });
    return closing;
  };
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => { server.removeListener('error', reject); resolve(); }); });
  server.on('error', () => { void close().catch(() => {}); try { options.onError(); } catch {} });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    try { await close(); } catch { throw new LoopbackOpenError(close); }
    throw new Error('Loopback binding failed.');
  }
  try {
    // Validate the private CA and IP SAN without disabling TLS verification.
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: address.port, ca: options.ca, rejectUnauthorized: true });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Loopback TLS check timed out.')); }, 5000);
      socket.once('secureConnect', () => { clearTimeout(timer); socket.destroy(); resolve(); });
      socket.once('error', () => { clearTimeout(timer); socket.destroy(); reject(new Error('Loopback certificate is not trusted by its supplied CA.')); });
    });
  } catch (error) {
    try { await close(); } catch { throw new LoopbackOpenError(close); }
    throw error;
  }
  return { port: address.port, bindOrigin(value) { if (origin !== null || serverClosing || !isQuickTunnelOrigin(value)) throw new Error('Invalid tunnel origin.'); origin = value; }, close };
}

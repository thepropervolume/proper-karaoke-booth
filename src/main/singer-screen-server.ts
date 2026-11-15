/** Read-only visual mirror of the authoritative singer display. No media or host API. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { isIP, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { discoverSingerScreenAddresses } from './singer-screen-network';

export type SingerScreenFrame = Readonly<{ jpeg: Buffer; width: number; height: number; sequence: number }>;
type FrameListener = (frame: SingerScreenFrame | null) => void;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Publish only pixels captured from the singer window, never host-window captures. */
export class SingerScreenFrameHub {
  private frame: SingerScreenFrame | null = null;
  private sequence = 0;
  private readonly listeners = new Set<FrameListener>();
  get current(): SingerScreenFrame | null { return this.frame; }
  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  publish(input: { jpeg: Buffer; width: number; height: number }): void {
    if (!Buffer.isBuffer(input.jpeg) || input.jpeg.length < 4 || input.jpeg.length > MAX_FRAME_BYTES ||
      input.jpeg.readUInt16BE(0) !== 0xffd8 || input.jpeg.readUInt16BE(input.jpeg.length - 2) !== 0xffd9 ||
      !Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 ||
      input.width > 8192 || input.height > 8192) throw new Error('Invalid singer display frame.');
    this.frame = Object.freeze({ jpeg: Buffer.from(input.jpeg), width: input.width, height: input.height, sequence: ++this.sequence });
    this.notify();
  }
  clear(): void { this.frame = null; ++this.sequence; this.notify(); }
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try { listener(this.frame); } catch { /* One consumer cannot break the display. */ }
    }
  }
}

export type SingerScreenServerStatus = {
  state: 'stopped' | 'listening' | 'failed'; port: number | null; bind: string | null;
  urls: string[]; viewers: number; maxViewers: number; frameAvailable: boolean;
  error?: 'port-in-use' | 'listen-failed';
};
export type SingerScreenStartOptions = { port?: number; bind?: string };
type Client = { response: ServerResponse; started: boolean; blocked: boolean; pendingFrame: boolean; timer: ReturnType<typeof setTimeout> | null };
const BOUNDARY = 'tpv-singer-frame';
const PART_HEADER = Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\n\r\n`);
// A generated, opaque black 1x1 JPEG replaces old lyrics immediately on clear.
const IDLE_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxmiiigD//2Q==', 'base64');
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Proper Volume — Singer Display</title><link rel="stylesheet" href="/screen.css"><script src="/screen.js" defer></script></head><body><img id="screen" src="/stream" alt="Live singer display"><div id="waiting" role="status"><h1>The Proper Volume Karaoke</h1><p id="message">Waiting for the singer display</p><small>Visual display only. Audio plays on the host.</small></div></body></html>';
const CSS = 'html,body{margin:0;width:100%;height:100%;max-height:100vh;overflow:hidden;background:#000;color:#fff;font:20px system-ui,sans-serif}body{height:100dvh}#screen{display:block;width:100%;height:100%;max-height:100vh;object-fit:contain}#waiting{position:fixed;inset:0;display:grid;align-content:center;text-align:center;padding:1rem;background:#090e18}#waiting[hidden]{display:none}h1{font-size:clamp(1.2rem,4vw,2.5rem)}small{color:#b5becb}';
const SCRIPT = `(() => {const screen=document.getElementById('screen'),waiting=document.getElementById('waiting'),message=document.getElementById('message');let retry=null,streamId=null,healthy=screen.naturalWidth>0,needsReconnect=false;
function reconnect(){healthy=false;needsReconnect=true;waiting.hidden=false;message.textContent='Connection lost. Reconnecting…';if(retry!==null)return;retry=setTimeout(()=>{retry=null;needsReconnect=false;screen.src='/stream?retry='+Date.now();},1500);}
screen.addEventListener('error',reconnect);screen.addEventListener('load',()=>{healthy=screen.naturalWidth>0;if(healthy)needsReconnect=false;if(healthy&&retry!==null){clearTimeout(retry);retry=null;}});
async function status(){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2500);try{const response=await fetch('/status',{cache:'no-store',credentials:'omit',signal:controller.signal});if(!response.ok)throw Error();const result=await response.json();if(typeof result.streamId!=='string')throw Error();const restarted=streamId!==null&&streamId!==result.streamId;streamId=result.streamId;if(restarted||needsReconnect||screen.complete&&screen.naturalWidth===0)reconnect();waiting.hidden=result.frameAvailable===true&&healthy&&screen.naturalWidth>1;if(healthy)message.textContent='Waiting for the singer display';}catch{reconnect();}finally{clearTimeout(timeout);setTimeout(status,1000);}}void status();})();`;
const HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/** Only directly connected private/link-local/loopback peers may view this LAN service. */
export function isLanSingerScreenPeer(address: string | undefined): boolean {
  if (!address) return false;
  const value = address.toLowerCase().replace(/^::ffff:/, '').split('%')[0];
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 ||
      a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127;
  }
  return isIP(value) === 6 && (value === '::1' || /^f[cd]/.test(value) || /^fe[89ab]/.test(value));
}

/** Explicitly started, read-only LAN visual sharing; never changes firewall or mDNS. */
export class SingerScreenServer {
  private readonly servers = new Map<string, Server>();
  private readonly sockets = new Set<Socket>();
  private readonly clients = new Set<Client>();
  private unsubscribe: (() => void) | null = null;
  private transition: Promise<unknown> = Promise.resolve();
  private boundPort: number | null = null;
  private bind: string | null = null;
  private failure: SingerScreenServerStatus['error'];
  private streamId = '';
  private readonly maxViewers: number;
  private readonly slowClientMs: number;
  private readonly discoverAddresses: () => Promise<string[]>;
  private readonly networkCheckMs: number;
  private networkTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly hub: SingerScreenFrameHub, options: {
    maxViewers?: number; slowClientMs?: number; discoverAddresses?: () => Promise<string[]>; networkCheckMs?: number;
  } = {}) {
    this.maxViewers = options.maxViewers ?? 64; this.slowClientMs = options.slowClientMs ?? 3000;
    this.discoverAddresses = options.discoverAddresses ?? discoverSingerScreenAddresses;
    this.networkCheckMs = options.networkCheckMs ?? 30_000;
    if (!Number.isInteger(this.maxViewers) || this.maxViewers < 1 || this.maxViewers > 256 ||
      !Number.isInteger(this.slowClientMs) || this.slowClientMs < 10 || this.slowClientMs > 30_000 ||
      !Number.isInteger(this.networkCheckMs) || this.networkCheckMs < 10 || this.networkCheckMs > 300_000) throw new Error('Invalid singer screen server limits.');
  }
  status(): SingerScreenServerStatus {
    const port = this.boundPort;
    const addresses = [...this.servers].filter(([, server]) => server.listening)
      .sort(([a], [b]) => Number(a === '127.0.0.1' || a === '::1') - Number(b === '127.0.0.1' || b === '::1'))
      .map(([address]) => address.includes(':') ? `[${address}]` : address);
    return { state: addresses.length ? 'listening' : this.failure ? 'failed' : 'stopped', port, bind: this.bind,
      urls: port === null ? [] : addresses.map(address => `http://${address}:${port}`), viewers: this.clients.size,
      maxViewers: this.maxViewers, frameAvailable: this.hub.current !== null, ...(this.failure ? { error: this.failure } : {}) };
  }
  start(options: SingerScreenStartOptions = {}): Promise<SingerScreenServerStatus> {
    const operation = this.transition.then(() => this.startNow(options));
    this.transition = operation.catch(() => {}); return operation;
  }
  stop(): Promise<void> {
    const operation = this.transition.then(() => this.stopNow());
    this.transition = operation.catch(() => {}); return operation;
  }
  private async startNow(options: SingerScreenStartOptions): Promise<SingerScreenServerStatus> {
    const port = options.port ?? 4051, bind = options.bind ?? 'private';
    if (!Number.isInteger(port) || port < 0 || port > 65535 ||
      bind !== 'private' && (!isIP(bind) || !isLanSingerScreenPeer(bind)) || bind === '0.0.0.0' || bind === '::')
      throw new Error('Choose a valid local singer-screen address and port.');
    let approved: string[] = [];
    if (bind !== '127.0.0.1' && bind !== '::1') {
      try { approved = [...new Set(await this.discoverAddresses())].filter(address => isIP(address) === 4 && isLanSingerScreenPeer(address)).sort(); }
      catch { /* Keep only loopback if network profiles cannot be verified. */ }
    }
    if (bind !== 'private' && !['127.0.0.1', '::1', ...approved].includes(bind)) {
      // Trust may have changed since this explicit interface was selected.
      if (this.bind === bind) await this.stopNow();
      throw new Error('Choose a valid local singer-screen address on a private network.');
    }
    const addresses = bind === 'private' ? [...new Set(['127.0.0.1', ...approved])] : [bind];
    if (this.servers.size && this.boundPort === port && this.bind === bind &&
      addresses.length === this.servers.size && addresses.every(address => this.servers.get(address)?.listening)) {
      this.scheduleNetworkCheck(options); return this.status();
    }
    await this.stopNow(); this.failure = undefined;
    this.bind = bind;
    try {
      for (const address of addresses) await this.listen(address, this.boundPort ?? port);
      this.streamId = randomUUID();
      this.unsubscribe = this.hub.subscribe(frame => this.broadcast(frame));
      this.scheduleNetworkCheck(options);
      return this.status();
    } catch (error) {
      await this.stopNow(); this.failure = (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'port-in-use' : 'listen-failed';
      throw new Error(this.failure === 'port-in-use' ? 'Singer screen port is already in use. Choose another port.' : 'Singer screen could not start. Check the local network address and port.');
    }
  }
  private async listen(address: string, port: number): Promise<void> {
    const server = createServer({ maxHeaderSize: 8192 }, (request, response) => this.handle(request, response));
    server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 5000;
    server.maxConnections = Math.max(32, this.maxViewers * 3 + 16); server.maxRequestsPerSocket = 100;
    server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
    server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
    this.servers.set(address, server);
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', ready); server.listen({ port, host: address });
    });
    const actual = server.address();
    if (!actual || typeof actual === 'string') throw new Error('Invalid listener address.');
    this.boundPort = actual.port;
    server.on('error', () => {
      if (this.servers.get(address) !== server) return;
      void this.stop().then(() => { if (!this.servers.size) this.failure = 'listen-failed'; });
    });
  }
  private scheduleNetworkCheck(options: SingerScreenStartOptions): void {
    if (this.networkTimer) clearTimeout(this.networkTimer);
    if (options.bind === '127.0.0.1' || options.bind === '::1') return;
    this.networkTimer = setTimeout(() => {
      this.networkTimer = null;
      if (!this.servers.size || this.boundPort === null) return;
      // Recheck trust on retry and periodically; public/removed interfaces lose their listener.
      void this.start({ ...options, port: this.boundPort }).catch(() => {});
    }, this.networkCheckMs);
    this.networkTimer.unref();
  }
  private async stopNow(): Promise<void> {
    if (this.networkTimer) clearTimeout(this.networkTimer); this.networkTimer = null;
    const servers = [...this.servers.values()]; this.servers.clear(); this.boundPort = null; this.bind = null; this.failure = undefined;
    this.unsubscribe?.(); this.unsubscribe = null;
    for (const client of [...this.clients]) { this.removeClient(client); client.response.destroy(); }
    if (servers.length) {
      const closed = servers.map(server => new Promise<void>(resolve => server.close(() => resolve())));
      for (const socket of this.sockets) socket.destroy();
      for (const server of servers) server.closeAllConnections(); await Promise.all(closed);
    }
  }
  private hostAllowed(request: IncomingMessage): boolean {
    const raw = request.headers.host;
    if (!raw || raw.length > 255 || raw !== raw.trim() || /[\s\\/?#@]/.test(raw)) return false;
    try {
      const url = new URL('http://' + raw), name = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
      const local = hostname().toLowerCase();
      const allowed = new Set(['localhost', '127.0.0.1', '::1', local, `${local}.local`, ...this.servers.keys()]);
      if (Number(url.port || 80) !== this.boundPort || !allowed.has(name)) return false;
      const origin = request.headers.origin;
      return !origin || origin === url.origin;
    } catch { return false; }
  }
  private handle(request: IncomingMessage, response: ServerResponse): void {
    const reply = (code: number, type: string, body = '') => {
      response.writeHead(code, { ...HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...(code >= 400 ? { Connection: 'close' } : {}) });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!isLanSingerScreenPeer(request.socket.remoteAddress) || !this.hostAllowed(request)) { reply(403, 'text/plain; charset=utf-8', 'Singer display is available only on the local network.'); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); reply(405, 'text/plain; charset=utf-8', 'Read-only singer display.'); return; }
    if (request.headers['transfer-encoding'] || request.headers['content-length'] && request.headers['content-length'] !== '0' ||
      !request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\') || request.url.length > 512) { reply(400, 'text/plain; charset=utf-8', 'Invalid request.'); return; }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') { reply(200, 'text/html; charset=utf-8', HTML); return; }
    if (path === '/screen.css') { reply(200, 'text/css; charset=utf-8', CSS); return; }
    if (path === '/screen.js') { reply(200, 'text/javascript; charset=utf-8', SCRIPT); return; }
    if (path === '/status') { reply(200, 'application/json; charset=utf-8', JSON.stringify({ frameAvailable: this.hub.current !== null, viewers: this.clients.size, streamId: this.streamId })); return; }
    if (path !== '/stream') { reply(404, 'text/plain; charset=utf-8', 'Not found.'); return; }
    if (request.method === 'HEAD') { response.writeHead(200, { ...HEADERS, 'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}` }); response.end(); return; }
    if (this.clients.size >= this.maxViewers) { reply(503, 'text/plain; charset=utf-8', 'Singer display viewer limit reached.'); return; }
    response.writeHead(200, { ...HEADERS, 'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`, Connection: 'keep-alive' });
    response.flushHeaders();
    const client: Client = { response, started: false, blocked: false, pendingFrame: false, timer: null };
    this.clients.add(client);
    response.on('close', () => this.removeClient(client));
    response.on('error', () => this.removeClient(client));
    response.on('drain', () => {
      if (!this.clients.has(client)) return;
      client.blocked = false; if (client.timer) clearTimeout(client.timer); client.timer = null;
      if (client.pendingFrame) { client.pendingFrame = false; this.send(client, this.packet(this.hub.current)); }
    });
    this.send(client, this.packet(this.hub.current));
  }
  private packet(frame: SingerScreenFrame | null): Buffer {
    const jpeg = frame?.jpeg ?? IDLE_JPEG;
    // Chromium finalizes the previous image only after parsing the next part's
    // complete headers. Supply those immediately, then append its JPEG when a
    // new capture arrives. MIME boundaries delimit bodies; Content-Length is
    // optional and cannot be known in advance for the next image.
    return Buffer.concat([jpeg, Buffer.from('\r\n'), PART_HEADER]);
  }
  private broadcast(frame: SingerScreenFrame | null): void {
    const packet = this.packet(frame);
    for (const client of this.clients) {
      if (frame === null && client.blocked) { this.removeClient(client); client.response.destroy(); }
      else this.send(client, packet);
    }
  }
  private send(client: Client, packet: Buffer): void {
    if (!this.clients.has(client)) return;
    if (client.blocked) { client.pendingFrame = true; return; }
    const bytes = client.started ? packet : Buffer.concat([PART_HEADER, packet]);
    client.started = true;
    if (!client.response.write(bytes)) {
      client.blocked = true;
      client.timer = setTimeout(() => { this.removeClient(client); client.response.destroy(); }, this.slowClientMs);
      client.timer.unref();
    }
  }
  private removeClient(client: Client): void {
    this.clients.delete(client); if (client.timer) clearTimeout(client.timer); client.timer = null;
  }
}

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer, request, type Server, type ServerOptions } from 'node:https';
import type { RequestListener } from 'node:http';
import { connect as tcpConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { test } from 'node:test';
import { startLanTransport, type LanTransportOptions } from '../../src/main/remote-https';
import { JoinRevisionConflict } from '../../src/main/remote-queue';
import { Store } from '../../src/main/store';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { createSingerStaticHandler } from '../../src/main/remote-static';

// Deliberately public test-only key. Never use this self-signed certificate in an app deployment.
const cert = readFileSync('tests/fixtures/tls/test-only.crt');
const key = readFileSync('tests/fixtures/tls/test-only.key');
const token = 'A'.repeat(43);
const calls: unknown[] = [];
const authority = {
  admissionInfo(invitation: unknown) { calls.push(['admission', invitation]); return { showId: 'show', hostEpoch: 'epoch', revision: 2 }; },
  join(...args: unknown[]) { calls.push(['join', ...args]); return { session: token, singerId: 'singer' }; },
  resume(value: unknown) { calls.push(['resume', value]); return { session: token, singerId: 'singer' }; },
  snapshot(value: unknown) { calls.push(['snapshot', value]); return { revision: 2 }; },
  catalog(value: unknown, offset: number, limit: number) { calls.push(['catalog', value, offset, limit]); return { items: [], revision: 2, nextOffset: null }; },
  outcome(value: unknown, id: unknown) { calls.push(['outcome', value, id]); return null; },
  submit(value: unknown, command: unknown) { calls.push(['request', value, command]); return { ok: true, revision: 3 }; },
  submitMissing(value: unknown, command: unknown) { calls.push(['missing-request', value, command]); return { ok: true, revision: 3 }; }
} as unknown as LanTransportOptions['authority'];
const base = { address: '127.0.0.1', hostname: 'localhost', port: 0, cert, key, authority, onError: (_error: Error) => {} };
async function post(origin: string, path: string, value: unknown, overrides: { host?: string; origin?: string; authorization?: string; contentType?: string; body?: string; ca?: Buffer; servername?: string; method?: string; chunked?: boolean } = {}) {
  const endpoint = new URL(origin), data = overrides.body ?? JSON.stringify(value);
  return new Promise<{ status: number; json: unknown; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: Number(endpoint.port), servername: overrides.servername ?? 'localhost', method: overrides.method ?? 'POST', path,
      ca: overrides.ca ?? cert, agent: false, headers: { host: overrides.host ?? endpoint.host, origin: overrides.origin ?? origin,
        'content-type': overrides.contentType ?? 'application/json', ...(!overrides.chunked ? { 'content-length': Buffer.byteLength(data) } : {}), ...(overrides.authorization ? { authorization: overrides.authorization } : {}) } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: response.headers }));
    });
    req.on('error', reject); req.end(data);
  });
}

test('TLS listener rejects wildcard/public binds, a mismatched certificate and a mismatched key', async () => {
  await assert.rejects(startLanTransport({ ...base, address: '0.0.0.0' }));
  await assert.rejects(startLanTransport({ ...base, address: '8.8.8.8' }));
  await assert.rejects(startLanTransport({ ...base, hostname: 'other.example' }), /certificate/i);
  await assert.rejects(startLanTransport({ ...base, key: 'invalid key' }));
});

test('TLS guest routes require exact host and origin, JSON and guest bearer; secrets are not echoed', async () => {
  const server = await startLanTransport(base);
  try {
    calls.length = 0;
    const joined = await post(server.origin, '/api/v1/admission', { invitation: token });
    assert.equal(joined.status, 200);
    assert.deepEqual(joined.json, { showId: 'show', hostEpoch: 'epoch', revision: 2 });
    assert.equal(joined.headers['cache-control'], 'no-store');
    assert.equal(joined.headers['access-control-allow-origin'], undefined);
    assert.equal((await post(server.origin, '/api/v1/snapshot', {})).status, 400);
    assert.equal((await post(server.origin, '/api/v1/snapshot', {}, { authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await post(server.origin, '/api/v1/catalog', { offset: 0, limit: 20 }, { authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await post(server.origin, '/api/v1/request', { command: { commandId: 'command' } }, { authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await post(server.origin, '/api/v1/missing-request', { command: { commandId: 'command', title: 'Song', artist: 'Artist' } })).status, 400);
    assert.equal((await post(server.origin, '/api/v1/missing-request', { command: { commandId: 'command', title: 'Song', artist: 'Artist' } }, { authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await post(server.origin, '/api/v1/admission', { invitation: token }, { host: 'evil.example' })).status, 403);
    assert.equal((await post(server.origin, '/api/v1/admission', { invitation: token }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(server.origin, '/api/v1/admission', { invitation: token }, { contentType: 'text/plain' })).status, 400);
    assert.equal((await post(server.origin, '/api/v1/admission?token=secret', { invitation: token })).status, 400);
    assert.equal((await post(server.origin, '/api/v1/admission', { invitation: token, role: 'host' })).status, 400);
    assert.equal((await post(server.origin, '/api/v1/admission', {}, { body: 'x'.repeat(8193) })).status, 413);
    assert.equal((await post(server.origin, '/api/v1/admission', {}, { body: 'x'.repeat(8193), chunked: true })).status, 413);
    assert.equal((await post(server.origin, '/api/v1/host/close', {})).status, 404);
    await assert.rejects(post(server.origin, '/api/v1/admission', { invitation: token }, { servername: 'wrong.example' }));
    assert.equal(calls.length, 5, 'Rejected traffic must not reach the authority.');
  } finally { await server.close(); }
  await assert.rejects(post(server.origin, '/api/v1/admission', { invitation: token }));
});

test('the listener bounds request rate independently of credentials', async () => {
  const server = await startLanTransport({ ...base, requestsPerMinute: 2 });
  try {
    assert.equal((await post(server.origin, '/api/v1/admission', { invitation: token })).status, 200);
    assert.equal((await post(server.origin, '/api/v1/admission', { invitation: token })).status, 200);
    assert.equal((await post(server.origin, '/api/v1/admission', { invitation: token })).status, 429);
  } finally { await server.close(); }
});

test('join revision conflict is distinct only for the typed pre-commit failure', async () => {
  let typed = true;
  const service = { ...authority, join() { throw typed ? new JoinRevisionConflict() : new Error('REVISION_CONFLICT'); } };
  const server = await startLanTransport({ ...base, authority: service });
  try {
    const input = { invitation: token, joinId: 'join-123456', resumeSecret: token, name: 'Singer', expectedRevision: 1 };
    const conflict = await post(server.origin, '/api/v1/join', input);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.json, { error: 'REVISION_CONFLICT' });
    typed = false;
    const unknown = await post(server.origin, '/api/v1/join', input);
    assert.equal(unknown.status, 400);
    assert.notDeepEqual(unknown.json, conflict.json);
  } finally { await server.close(); }
});

test('idle TLS connections expire and the listener limits concurrent sockets', async () => {
  const server = await startLanTransport({ ...base, timeoutMs: 250, maxConnections: 1 });
  const port = Number(new URL(server.origin).port);
  // A paused readable socket need not emit close on FIN until it is drained.
  // Subscribe before doing other awaits so a fast server close cannot be missed.
  const waitForClose = (socket: Socket, message: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(message)); }, 5000);
    socket.once('close', () => { clearTimeout(timer); resolve(); });
    socket.resume();
  });
  const first = tcpConnect(port, '127.0.0.1');
  const firstClosed = waitForClose(first, 'TLS handshake did not time out');
  try {
    await new Promise<void>((resolve, reject) => { first.once('connect', resolve); first.once('error', reject); });
    const second = tcpConnect(port, '127.0.0.1');
    second.once('error', () => { /* a reset is also a refusal */ });
    await waitForClose(second, 'Excess socket was not refused');
    await firstClosed;
    const idle = tlsConnect({ host: '127.0.0.1', port, servername: 'localhost', ca: cert });
    const idleClosed = waitForClose(idle, 'Idle connection did not time out');
    await new Promise<void>((resolve, reject) => { idle.once('secureConnect', resolve); idle.once('error', reject); });
    await idleClosed;
    const slow = tlsConnect({ host: '127.0.0.1', port, servername: 'localhost', ca: cert });
    const slowClosed = waitForClose(slow, 'Slow headers did not time out');
    await new Promise<void>((resolve, reject) => { slow.once('secureConnect', resolve); slow.once('error', reject); });
    slow.write('POST /api/v1/snapshot HTTP/1.1\r\nX-Slow: ');
    const drip = setInterval(() => slow.write('x'), 50);
    try { await slowClosed; } finally { clearInterval(drip); }
  } finally { first.destroy(); await server.close(); }
});

test('a later server error is reported to the owner and stops accepting traffic', async () => {
  let bound: Server | undefined;
  const factory = ((options: ServerOptions, listener: RequestListener) => (bound = createServer(options, listener))) as typeof createServer;
  const failures: Error[] = [];
  const server = await startLanTransport({ ...base, onError: error => failures.push(error) }, factory);
  const problem = new Error('listener failed');
  bound!.emit('error', problem);
  assert.deepEqual(failures, [problem]);
  await assert.rejects(post(server.origin, '/api/v1/admission', { invitation: token }));
  await server.close();
});

test('HTTPS guest admission and missing-song retries use the real SQLite authority', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-https-test-'));
  const store = new Store<ShowState>(join(dir, 'show.sqlite'));
  const state = createInitialState('show-00001', 'epoch-0001');
  store.save(state);
  const service = store.openRemoteQueue(() => DEFAULT_SETTINGS, () => {});
  const invitation = service.createInvitation(60000);
  const secret = randomBytes(32).toString('base64url');
  const server = await startLanTransport({ ...base, authority: service });
  try {
    const joined = await post(server.origin, '/api/v1/join', { invitation, joinId: 'join-123456', resumeSecret: secret, name: 'Alice', expectedRevision: 0 });
    assert.equal(joined.status, 200);
    const session = (joined.json as { session: string }).session;
    const auth = { authorization: `Bearer ${session}` };
    const command = { commandId: 'missing-1234', title: 'Popular', artist: 'Nada Surf' };
    const submitted = await post(server.origin, '/api/v1/missing-request', { command }, auth);
    assert.equal(submitted.status, 200);
    assert.deepEqual((await post(server.origin, '/api/v1/missing-request', { command }, auth)).json, submitted.json);
    assert.deepEqual((await post(server.origin, '/api/v1/outcome', { commandId: command.commandId }, auth)).json, submitted.json);
    const spoof = await post(server.origin, '/api/v1/missing-request', { command: { ...command, commandId: 'missing-5678', singer: 'Bob' } }, auth);
    assert.equal(spoof.status, 400);
    const requests = store.missingSongRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].singer, 'Alice');
    assert.equal(requests[0].title, 'Popular');
  } finally { await server.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('allowlisted singer page and authenticated guest API share one strictly checked HTTPS origin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-https-static-'));
  mkdirSync(join(dir, '.vite')); mkdirSync(join(dir, 'src', 'remote'), { recursive: true }); mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify({
    'src/remote/index.html': { file: 'assets/singer.js', css: ['assets/singer.css'] },
    'src/renderer/index.html': { file: 'assets/host.js', isEntry: true },
  }));
  writeFileSync(join(dir, 'src', 'remote', 'index.html'), '<!doctype html><script src="/assets/singer.js"></script>');
  writeFileSync(join(dir, 'assets', 'singer.js'), 'document.body.textContent = "Singer";');
  writeFileSync(join(dir, 'assets', 'singer.css'), 'body { color: white }');
  writeFileSync(join(dir, 'assets', 'host.js'), 'private host asset');
  const store = new Store<ShowState>(join(dir, 'show.sqlite'));
  let state = createInitialState('show-00001', 'epoch-0001');
  state.versions.push({ id: 'version-clean', artist: 'Artist', title: 'Song', rating: 'clean' });
  store.save(state);
  const service = store.openRemoteQueue(() => DEFAULT_SETTINGS, committed => { state = committed; });
  const invitation = service.createInvitation(60000);
  const server = await startLanTransport({ ...base, authority: service, staticHandler: createSingerStaticHandler(dir) });
  const get = (path: string, headers: Record<string, string> = {}, body = '') => new Promise<{ status: number; text: string; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const endpoint = new URL(server.origin);
    const req = request({ hostname: '127.0.0.1', port: Number(endpoint.port), servername: 'localhost', method: 'GET', path,
      ca: cert, agent: false, headers: { host: endpoint.host, ...headers } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: response.headers }));
    });
    req.on('error', reject); req.end(body);
  });
  try {
    const page = await get('/singer/');
    assert.equal(page.status, 200); assert.match(page.text, /singer\.js/);
    assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal((await get('/assets/singer.js')).status, 200);
    assert.equal((await get('/assets/singer.css', { origin: server.origin })).status, 200);
    assert.equal((await get('/singer/', { host: 'other.example' })).status, 403);
    assert.equal((await get('/singer/', { origin: 'https://other.example' })).status, 403);
    assert.equal((await get('/singer/?invite=secret')).status, 400);
    assert.equal((await get('/assets/host.js')).status, 404);
    assert.equal((await get('/assets/../show.sqlite')).status, 404);
    assert.equal((await get('/singer/', { 'content-length': '1' }, 'x')).status, 400);
    assert.equal((await post(server.origin, '/api/v1/admission', { invitation }, { origin: '' })).status, 403);
    const joined = await post(server.origin, '/api/v1/join', { invitation, joinId: 'join-123456', resumeSecret: randomBytes(32).toString('base64url'), name: 'Alice', expectedRevision: 0 });
    assert.equal(joined.status, 200);
    const session = (joined.json as { session: string }).session;
    const snapshot = await post(server.origin, '/api/v1/snapshot', {}, { authorization: `Bearer ${session}` });
    assert.equal(snapshot.status, 200);
    assert.equal((snapshot.json as { singerName: string }).singerName, 'Alice');
    assert.equal(state.singers[0].name, 'Alice');
  } finally { await server.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

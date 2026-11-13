import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { startQuickTunnelLoopback } from '../../src/main/quick-tunnel-loopback';
import { RemoteRelayScope } from '../../src/main/remote-relay-scope';
import { createRelayGuestHandler } from '../../src/main/remote-relay-http';
import { createSingerStaticHandler } from '../../src/main/remote-static';
import { Store } from '../../src/main/store';

const cert = readFileSync('tests/fixtures/tls/test-only.crt'), key = readFileSync('tests/fixtures/tls/test-only.key');
const origin = 'https://test-room.trycloudflare.com', host = new URL(origin).host;
const secret = () => randomBytes(32).toString('base64url');

test('real relay guest router enforces scope, origin, authorization and durable requests over loopback TLS', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-relay-http-'));
  mkdirSync(join(dir, '.vite')); mkdirSync(join(dir, 'src', 'remote'), { recursive: true }); mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify({ 'src/remote/index.html': { file: 'assets/singer.js' } }));
  writeFileSync(join(dir, 'src', 'remote', 'index.html'), '<!doctype html><script src="/assets/singer.js"></script>');
  writeFileSync(join(dir, 'assets', 'singer.js'), 'export {};');
  const store = new Store<ShowState>(':memory:');
  let state = createInitialState('show-00001', 'epoch-0001');
  state.versions.push({ id: 'version-clean', title: 'Song', artist: 'Artist', rating: 'clean' }); store.save(state);
  const queue = store.openRemoteQueue(() => DEFAULT_SETTINGS, value => { state = value; });
  const lanInvite = queue.createInvitation(60000), lan = queue.join(lanInvite, 'lan-join-0001', secret(), 'Lan Singer', 0);
  let guestUpdates = 0, missingUpdates = 0;
  const relay = new RemoteRelayScope(queue, { guests: () => { guestUpdates++; }, missing: () => { missingUpdates++; } });
  const invite = relay.createInvitation(60000), resume = secret();
  const gate = await startQuickTunnelLoopback({ cert, key, ca: cert, handler: createRelayGuestHandler(relay, createSingerStaticHandler(dir)), onError: () => {} });
  gate.bindOrigin(origin);
  const call = (path: string, input?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; text: string }>((resolve, reject) => {
    const data = input === undefined ? '' : JSON.stringify(input);
    const req = request({ host: '127.0.0.1', port: gate.port, servername: 'localhost', ca: cert, agent: false,
      method: input === undefined ? 'GET' : 'POST', path,
      headers: { host, ...(input === undefined ? {} : { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }), ...headers } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end(data);
  });
  try {
    assert.equal((await call('/singer/')).status, 200);
    assert.equal((await call('/assets/singer.js')).status, 200);
    const before = state.revision;
    assert.equal((await call('/api/v1/admission', { invitation: invite }, { host: 'evil.example' })).status, 403);
    assert.equal((await call('/api/v1/admission', { invitation: invite }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await call('/api/v1/admission', { invitation: invite }, { 'content-type': 'text/plain' })).status, 400);
    assert.equal((await call('/api/v1/admission', { invitation: lanInvite })).status, 400);
    assert.equal((await call('/api/v1/snapshot', {})).status, 400);
    assert.equal((await call('/api/v1/snapshot', {}, { authorization: `Bearer ${lan.session}` })).status, 400);
    const conflict = await call('/api/v1/join', { invitation: invite, joinId: 'relay-join-0001', resumeSecret: resume, name: 'Relay Singer', expectedRevision: 0 });
    assert.equal(conflict.status, 409); assert.deepEqual(JSON.parse(conflict.text), { error: 'REVISION_CONFLICT' });
    const oversized = await new Promise<number>(resolve => {
      const req = request({ host: '127.0.0.1', port: gate.port, servername: 'localhost', ca: cert, agent: false, method: 'POST', path: '/api/v1/admission',
        headers: { host, origin, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
      req.on('error', () => resolve(0)); req.write('x'.repeat(8193)); req.end();
    });
    assert.ok(oversized === 413 || oversized === 0, 'oversized chunked bodies must be rejected or disconnected');
    assert.equal(state.revision, before); assert.equal(guestUpdates, 0); assert.equal(store.missingSongRequests().length, 0);
    assert.equal((await call('/api/v1/admission', { invitation: invite })).status, 200);
    const joined = await call('/api/v1/join', { invitation: invite, joinId: 'relay-join-0001', resumeSecret: resume, name: 'Relay Singer', expectedRevision: state.revision });
    assert.equal(joined.status, 200); assert.equal(guestUpdates, 1);
    const session = (JSON.parse(joined.text) as { session: string }).session, auth = { authorization: `Bearer ${session}` };
    assert.throws(() => queue.snapshot(session));
    const snap = JSON.parse((await call('/api/v1/snapshot', {}, auth)).text) as { showId: string; hostEpoch: string; revision: number };
    const song = { commandId: 'relay-command-1', showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-clean' };
    assert.equal((await call('/api/v1/request', { command: song }, auth)).status, 200);
    assert.equal(state.requests.length, 1);
    const missing = { commandId: 'relay-missing-1', title: 'Another Song', artist: 'Artist' };
    assert.equal((await call('/api/v1/missing-request', { command: missing }, auth)).status, 200);
    assert.equal((await call('/api/v1/missing-request', { command: missing }, auth)).status, 200);
    assert.equal(store.missingSongRequests().length, 1); assert.equal(missingUpdates, 2);
    assert.equal((await call('/api/v1/missing-request', { command: { ...missing, singer: 'Lan Singer' } }, auth)).status, 400);
    relay.close();
    assert.equal((await call('/api/v1/snapshot', {}, auth)).status, 400);
    assert.equal(queue.snapshot(lan.session).singerName, 'Lan Singer');
  } finally { relay.close(); await gate.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

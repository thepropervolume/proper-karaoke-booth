import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { createServer, request } from 'node:http';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { QuickTunnelOpenError, type QuickTunnelDevOptions } from '../../src/main/quick-tunnel-dev';
import { openDevelopmentRelayRoom, RelayRoomOpenError } from '../../src/main/remote-relay-room';
import { Store } from '../../src/main/store';

const secret = () => randomBytes(32).toString('base64url');
const origin = 'https://test-room.trycloudflare.com';
function fixture() {
  const store = new Store<ShowState>(':memory:'); let state = createInitialState('show-00001', 'epoch-0001'); store.save(state);
  const queue = store.openRemoteQueue(() => DEFAULT_SETTINGS, value => { state = value; });
  const invite = queue.createInvitation(60000), lan = queue.join(invite, 'lan-join-0001', secret(), 'LAN Singer', 0);
  const options = { enabled: true, queue, executable: 'trusted path', caFile: 'trusted ca', cert: Buffer.alloc(0), key: Buffer.alloc(0),
    staticHandler: async () => false, onFailure: () => {} };
  return { store, queue, lan, options, state: () => state };
}

test('relay room owns scoped guest routing and stop preserves LAN guests', async () => {
  const f = fixture(); let connector!: QuickTunnelDevOptions, stopped = 0, updates = 0;
  const room = await openDevelopmentRelayRoom({ ...f.options, onGuestsChanged: () => { updates++; } }, async value => { connector = value; return { origin, stop: async () => { stopped++; } }; });
  const listener = createServer((req, res) => { void connector.handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('Listener unavailable');
  const post = (path: string, value: unknown) => new Promise<{ status: number; data: any }>((resolve, reject) => {
    const body = JSON.stringify(value); const req = request({ host: '127.0.0.1', port: address.port, method: 'POST', path,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', reject); req.end(body);
  });
  try {
    const link = new URL(room.createInvitation(60000));
    const invitation = new URLSearchParams(link.hash.slice(1)).get('invite')!;
    assert.equal(link.origin, origin); assert.equal(link.search, ''); assert.throws(() => f.queue.admissionInfo(invitation));
    const joined = await post('/api/v1/join', { invitation, joinId: 'relay-join-0001', resumeSecret: secret(), name: 'Relay Singer', expectedRevision: f.state().revision });
    assert.equal(joined.status, 200); assert.equal(updates, 1);
    assert.deepEqual(room.guests().map(guest => guest.name), ['Relay Singer']);
    await Promise.all([room.stop(), room.stop()]);
    assert.equal(stopped, 1); assert.throws(() => room.createInvitation(60000));
    assert.equal(f.queue.snapshot(f.lan.session).singerName, 'LAN Singer');
    assert.equal((await post('/api/v1/admission', { invitation })).status, 400);
  } finally { await room.stop(); await new Promise<void>(resolve => listener.close(() => resolve())); f.store.close(); }
});

test('failure during startup closes a late connector and never disturbs LAN', async () => {
  const f = fixture(); let trigger!: () => void, release!: () => void, announced!: () => void, stopped = 0, failures = 0;
  const entered = new Promise<void>(resolve => { announced = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const pending = openDevelopmentRelayRoom({ ...f.options, onFailure: () => { failures++; } }, async value => {
    trigger = value.onFailure; announced(); await gate; return { origin, stop: async () => { stopped++; } };
  });
  try {
    await entered; trigger(); release(); await assert.rejects(pending, /could not start/);
    assert.equal(stopped, 1); assert.equal(failures, 1); assert.equal(f.queue.snapshot(f.lan.session).singerName, 'LAN Singer');
  } finally { f.store.close(); }
});

test('connector failure immediately disables the room and keeps LAN active', async () => {
  const f = fixture(); let trigger!: () => void, stopped = 0, failures = 0;
  const room = await openDevelopmentRelayRoom({ ...f.options, onFailure: () => { failures++; } }, async value => { trigger = value.onFailure; return { origin, stop: async () => { stopped++; } }; });
  try {
    room.createInvitation(60000); trigger();
    assert.throws(() => room.guests(), /unavailable/);
    assert.equal(f.queue.snapshot(f.lan.session).singerName, 'LAN Singer');
    await room.stop(); assert.equal(stopped, 1); assert.equal(failures, 1);
  } finally { await room.stop(); f.store.close(); }
});

test('a throwing failure notification cannot restore relay access or interrupt cleanup', async () => {
  const f = fixture(); let trigger!: () => void, stopped = 0;
  const room = await openDevelopmentRelayRoom({ ...f.options, onFailure: () => { throw new Error('UI closed'); } }, async value => { trigger = value.onFailure; return { origin, stop: async () => { stopped++; } }; });
  try {
    room.createInvitation(60000); assert.doesNotThrow(trigger);
    assert.throws(() => room.guests(), /unavailable/);
    await room.stop(); assert.equal(stopped, 1);
    assert.equal(f.queue.snapshot(f.lan.session).singerName, 'LAN Singer');
  } finally { await room.stop(); f.store.close(); }
});

test('intentional abort during and after startup cleans up without reporting a connector failure', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void, stopped = 0, failures = 0;
  const controller = new AbortController(), started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const pending = openDevelopmentRelayRoom({ ...f.options, signal: controller.signal, onFailure: () => { failures++; } }, async () => {
      entered(); await gate; return { origin, stop: async () => { stopped++; } };
    });
    await started; controller.abort(); release(); await assert.rejects(pending);
    assert.equal(stopped, 1); assert.equal(failures, 0);
    const second = new AbortController();
    const room = await openDevelopmentRelayRoom({ ...f.options, signal: second.signal, onFailure: () => { failures++; } }, async () => ({ origin, stop: async () => { stopped++; } }));
    room.createInvitation(60000); second.abort(); assert.throws(() => room.guests(), /unavailable/);
    await room.stop(); assert.equal(stopped, 2); assert.equal(failures, 0);
    assert.equal(f.queue.snapshot(f.lan.session).singerName, 'LAN Singer');
  } finally { f.store.close(); }
});

test('failed startup cleanup exposes a retryable main-process recovery handle', async () => {
  const f = fixture(); let attempts = 0;
  try {
    let recovery: RelayRoomOpenError | undefined;
    try {
      await openDevelopmentRelayRoom(f.options, async () => { throw new QuickTunnelOpenError(async () => { if (++attempts === 1) throw new Error('fault'); }); });
      assert.fail('Expected cleanup failure');
    } catch (error) { assert.ok(error instanceof RelayRoomOpenError); recovery = error; }
    assert.equal(f.queue.snapshot(f.lan.session).singerName, 'LAN Singer');
    await recovery!.retryCleanup(); assert.equal(attempts, 2);
  } finally { f.store.close(); }
});

test('failed connector stop leaves the relay scope closed and permits cleanup retry', async () => {
  const f = fixture(); let attempts = 0;
  const room = await openDevelopmentRelayRoom(f.options, async () => ({ origin, stop: async () => { if (++attempts === 1) throw new Error('stop fault'); } }));
  try {
    room.createInvitation(60000);
    await assert.rejects(room.stop(), /cleanup failed/);
    assert.throws(() => room.guests(), /unavailable/);
    assert.equal(f.queue.snapshot(f.lan.session).singerName, 'LAN Singer');
    await room.stop(); assert.equal(attempts, 2);
  } finally { await room.stop(); f.store.close(); }
});

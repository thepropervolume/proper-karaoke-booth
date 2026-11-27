import { strict as assert } from 'node:assert';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, chownSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { dispatchInternetGuestCall, InternetQueueClient, type InternetGuestCall, type InternetGuestReply } from '../../src/main/internet-queue-client';
import { RemoteAuthorityCoordinator } from '../../src/main/remote-authority-coordinator';
import { RemoteRelayScope } from '../../src/main/remote-relay-scope';
import { Store } from '../../src/main/store';
import { INTERNET_QUEUE_ORIGIN } from '../../src/remote/internet-session-control';

const token = () => randomBytes(32).toString('base64url');
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 5));
async function until(check: () => boolean) { const deadline = Date.now() + 3000; while (!check()) { if (Date.now() >= deadline) throw new Error('Test deadline exceeded.'); await pause(); } }
function show() {
  const store = new Store<ShowState>(':memory:'); let state = createInitialState('show-00001', 'epoch-0001');
  state.versions.push({ id: 'version-clean', title: 'Popular', artist: 'Nada Surf', rating: 'clean' }); store.save(state);
  const coordinator = new RemoteAuthorityCoordinator(store, () => DEFAULT_SETTINGS, value => { state = value; });
  return { store, coordinator, state: () => state };
}

test('internet dispatch injects private admission, preserves receipts and rejects host-shaped calls', () => {
  const f = show();
  try {
    const scope = new RemoteRelayScope(f.coordinator.getAuthority()), invitation = scope.createInvitation(60000);
    const send = (operation: string, payload: unknown, session?: string) => dispatchInternetGuestCall(scope.authority, { requestId: randomUUID(), operation, payload, ...(session ? { session } : {}) }, () => invitation);
    assert.equal(send('admission', {}).status, 200);
    assert.equal(send('admission', { invitation: token() }).status, 400);
    const joined = send('join', { joinId: randomUUID(), resumeSecret: token(), name: 'Sam', expectedRevision: 0 });
    assert.equal(joined.status, 200);
    const guest = joined.body as { session: string; singerId: string };
    assert.equal(send('join', { joinId: randomUUID(), resumeSecret: token(), name: 'Other', expectedRevision: 0 }).status, 409);
    assert.deepEqual((send('catalog', {offset: 0, limit: 50, query: 'nada popular'}, guest.session).body as {items: {id:string}[]}).items.map(song => song.id), ['version-clean']);
    assert.deepEqual((send('catalog', {offset: 0, limit: 50, query: 'not found'}, guest.session).body as {items: {id:string}[]}).items, []);
    assert.equal(send('catalog', {offset: 0, limit: 50, query: 'x'.repeat(201)}, guest.session).status, 400);
    const snapshot = send('snapshot', {}, guest.session).body as { showId: string; hostEpoch: string; revision: number };
    const command = { commandId: randomUUID(), showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, versionId: 'version-clean' };
    assert.equal(send('request', { command }, guest.session).status, 200);
    assert.deepEqual(send('request', { command }, guest.session).body, send('outcome', { commandId: command.commandId }, guest.session).body);
    assert.equal(f.state().requests.length, 1);
    for (const [operation, payload] of [['host-command', { command: { type: 'play' } }], ['snapshot', { path: '/etc/passwd' }], ['request', { command, singerId: 'other' }], ['catalog', { offset: 0, limit: 50, url: 'https://evil.test' }]])
      assert.equal(send(operation as string, payload, guest.session).status, 400);
    assert.equal(send('snapshot', {}).status, 400);
    assert.doesNotMatch(JSON.stringify(send('snapshot', {}, token())), /sqlite|path|token|stack/);
    scope.close();
    assert.equal(send('snapshot', {}, guest.session).status, 400);
  } finally { f.store.close(); }
});

class RelayFixture {
  readonly roomId = randomUUID();
  generation = randomUUID();
  opens: { slug: string; openId: string }[] = [];
  replies: { roomId: string; generation: string; responses: InternetGuestReply[] }[] = [];
  closes: unknown[] = [];
  screens: Record<string, any>[] = [];
  screenUnavailable = false;
  openStatus = 200;
  screenViewerOrigin: string | undefined;
  pending: { resolve: (value: Response) => void; reject: (reason: Error) => void; generation: string } | undefined;
  replyFailures = 0;
  lateReplyConflict = false;
  ignorePollAbort = false;
  loseCloseAcknowledgement = false;
  alreadyEnded = false;
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    assert.equal(url.origin, INTERNET_QUEUE_ORIGIN); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.match((init?.headers as Record<string, string>).Authorization, /^Bearer /);
    const body = JSON.parse(init!.body as string) as Record<string, any>;
    switch (url.pathname) {
      case '/v1/relay/host/open': {
        if (this.openStatus !== 200) return response({ error: 'open rejected' }, this.openStatus);
        const previous = this.opens.find(item => item.openId === body.openId);
        if (!previous && this.opens.length) this.generation = randomUUID();
        if (!previous) this.opens.push(body as { slug: string; openId: string });
        return response({ roomId: this.roomId, generation: this.generation, slug: body.slug, publicUrl: `${INTERNET_QUEUE_ORIGIN}/${body.slug}`, expiresAt: Date.now() + 3600000, pollAfterMs: 0 });
      }
      case '/v1/relay/host/poll':
        if (this.ignorePollAbort) return await new Promise<Response>(() => {});
        return await new Promise<Response>((resolve, reject) => {
        assert.equal(this.pending, undefined, 'only one poll can be outstanding');
        const pending = { resolve: (value: Response) => { init!.signal?.removeEventListener('abort', abort); this.pending = undefined; resolve(value); }, reject, generation: body.generation as string };
        const abort = () => { if (this.pending === pending) this.pending = undefined; reject(new Error('aborted')); };
        this.pending = pending;
        init?.signal?.addEventListener('abort', abort, { once: true });
        if (init?.signal?.aborted) abort();
      });
      case '/v1/relay/host/reply':
        this.replies.push(body as { roomId: string; generation: string; responses: InternetGuestReply[] });
        if (this.lateReplyConflict) { this.lateReplyConflict = false; return response({ error: 'unknown-reply' }, 409); }
        if (this.replyFailures-- > 0) throw new Error('lost acknowledgement');
        return response({ ok: true });
      case '/v1/relay/host/screen':
        this.screens.push(body); return this.screenUnavailable ? response({ error: 'NOT_FOUND' }, 404) : response({ ok: true, ...(body.action === 'start' && this.screenViewerOrigin ? { viewerOrigin: this.screenViewerOrigin } : {}) });
      case '/v1/relay/host/close':
        this.closes.push(body);
        if (this.alreadyEnded) return response({ error: 'room-ended' }, 410);
        if (this.loseCloseAcknowledgement) { this.loseCloseAcknowledgement = false; this.alreadyEnded = true; throw new Error('lost close acknowledgement'); }
        return response({ ok: true });
      default: throw new Error('Unexpected endpoint.');
    }
  };
  async deliver(requests: InternetGuestCall[]): Promise<InternetGuestReply[]> {
    await until(() => !!this.pending); const count = this.replies.length;
    this.pending!.resolve(response({ roomId: this.roomId, generation: this.pending!.generation, requests }));
    await until(() => this.replies.length > count);
    return this.replies.at(-1)!.responses;
  }
}
function clientFixture(screenFrame?: () => Buffer | null) {
  const f = show(), relay = new RelayFixture(), directory = mkdtempSync(join(tmpdir(), 'tpv-internet-client-'));
  const configurationFile = join(directory, 'connection.json'), owner = token();
  writeFileSync(configurationFile, JSON.stringify({ baseUrl: INTERNET_QUEUE_ORIGIN, ownerToken: owner }), { mode: 0o600 });
  let copied = '';
  const client = new InternetQueueClient({ coordinator: f.coordinator, configurationFile, fetch: relay.fetch, reconnectDelayMs: 0, screenFrame, writeClipboard: value => { copied = value; } });
  return { ...f, relay, client, configurationFile, owner, copied: () => copied, async dispose() {
    await client.stop(); f.store.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true });
  } };
}

test('screen sharing is explicit, private to each stream and stopped with its room', async () => {
  let captures = 0;
  const f = clientFixture(() => { captures++; return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); });
  try {
    await f.client.start({ slug: 'private-screen' });
    assert.equal(f.client.screenSharing, false); assert.equal(captures, 0); assert.equal(f.relay.screens.length, 0);
    await f.client.startScreen();
    await until(() => f.relay.screens.some(item => item.action === 'frame'));
    const link = f.client.status().screenUrl!, url = new URL(link), secret = url.hash.slice(1);
    assert.equal(url.pathname, '/private-screen/screen'); assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
    const started = f.relay.screens.find(item => item.action === 'start')!;
    assert.equal(started.viewerDigest, createHash('sha256').update(secret).digest('hex'));
    assert.ok(!JSON.stringify(f.relay.screens).includes(secret));
    f.client.copyScreenLink(); assert.equal(f.copied(), link);
    await f.client.stopScreen();
    assert.equal(f.client.screenSharing, false); assert.equal(f.client.status().screenUrl, null);
    assert.ok(f.relay.screens.some(item => item.action === 'stop' && item.streamId === started.streamId));
    await f.client.startScreen(); assert.notEqual(f.client.status().screenUrl, link);
    await f.client.stop(); assert.equal(f.client.screenSharing, false);
    assert.equal(f.relay.screens.filter(item => item.action === 'stop').length, 2);
  } finally { await f.dispose(); }
});

test('an older relay reports screen sharing unavailable without exposing a link', async () => {
  const f = clientFixture(() => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  try {
    await f.client.start({ slug: 'old-relay' }); f.relay.screenUnavailable = true;
    await assert.rejects(f.client.startScreen(), /relay may need an update/i);
    assert.equal(f.client.screenSharing, false); assert.equal(f.client.status().screenUrl, null);
    assert.equal(f.client.status().state, 'online');
  } finally { await f.dispose(); }
});

test('only the explicitly supported booth origin may replace the existing queue screen link', async () => {
  const f = clientFixture(() => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  try {
    await f.client.start({ slug: 'viewer-origin' });
    f.relay.screenViewerOrigin = 'https://evil.example.test';
    await assert.rejects(f.client.startScreen()); assert.equal(f.client.status().screenUrl, null);
    f.relay.screenViewerOrigin = 'https://booth.thepropervolume.com';
    await f.client.startScreen(); assert.equal(new URL(f.client.status().screenUrl!).origin, 'https://booth.thepropervolume.com');
    await f.client.stopScreen();
  } finally { await f.dispose(); }
});

test('screen sharing fails closed and reports missing capture instead of silently waiting', async () => {
  const f = clientFixture(() => null);
  try {
    await f.client.start({ slug: 'capture-missing' }); await f.client.startScreen();
    const deadline = Date.now() + 5000;
    while (f.client.screenSharing && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(f.client.screenSharing, false); assert.equal(f.client.status().screenUrl, null);
    assert.match(f.client.status().message, /capture was lost/i);
  } finally { await f.dispose(); }
});

test('explicit internet session dispatches guests through one show authority and End leaves LAN intact', async () => {
  const f = clientFixture();
  try {
    const queue = f.coordinator.getAuthority(), lan = queue.join(queue.createInvitation(60000), randomUUID(), token(), 'LAN', 0);
    assert.equal(f.relay.opens.length, 0);
    await f.client.start({ slug: 'proper-volume' });
    assert.equal(f.client.status().state, 'online'); f.client.copyLink(); assert.equal(f.copied(), `${INTERNET_QUEUE_ORIGIN}/proper-volume`);
    assert.doesNotMatch(JSON.stringify(f.client.status()), new RegExp(f.owner));
    const [joined] = await f.relay.deliver([{ requestId: randomUUID(), operation: 'join', payload: { joinId: randomUUID(), resumeSecret: token(), name: 'Internet', expectedRevision: f.state().revision } }]);
    const guest = joined.body as { session: string; singerId: string };
    assert.equal(joined.status, 200); assert.deepEqual(f.client.status().guests.map(item => item.name), ['Internet']);
    const [snapshot] = await f.relay.deliver([{ requestId: randomUUID(), operation: 'snapshot', payload: {}, session: guest.session }]);
    const snap = snapshot.body as { showId: string; hostEpoch: string; revision: number };
    await f.relay.deliver([{ requestId: randomUUID(), operation: 'request', session: guest.session, payload: { command: { commandId: randomUUID(), showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-clean' } } }]);
    assert.equal(f.state().requests.length, 1); assert.equal(f.state().playback, null);
    await f.client.stop(); assert.equal(f.client.status().state, 'stopped'); assert.equal(f.relay.closes.length, 1);
    assert.equal(queue.snapshot(lan.session).singerName, 'LAN'); assert.throws(() => queue.snapshot(guest.session));
  } finally { await f.dispose(); }
});

test('lost reply acknowledgement retries the exact receipt before another poll or generation', async () => {
  const f = clientFixture();
  try {
    f.relay.replyFailures = 1; await f.client.start({ slug: 'proper-volume' });
    await f.relay.deliver([{ requestId: randomUUID(), operation: 'admission', payload: {} }]);
    await until(() => f.relay.replies.length === 2);
    assert.deepEqual(f.relay.replies[0], f.relay.replies[1]); assert.equal(f.relay.opens.length, 1); assert.equal(f.client.status().state, 'online');
  } finally { await f.dispose(); }
});

test('poll failure preserves the internet scope and same generation while reconnecting without changing LAN', async () => {
  const f = clientFixture();
  try {
    const queue = f.coordinator.getAuthority(), lan = queue.join(queue.createInvitation(60000), randomUUID(), token(), 'LAN', 0);
    await f.client.start({ slug: 'proper-volume' });
    const [joined] = await f.relay.deliver([{ requestId: randomUUID(), operation: 'join', payload: { joinId: randomUUID(), resumeSecret: token(), name: 'Internet', expectedRevision: f.state().revision } }]);
    const old = (joined.body as { session: string }).session, generation = f.relay.generation;
    await until(() => !!f.relay.pending);
    const pending = f.relay.pending!; f.relay.pending = undefined; pending.reject(new Error('network lost'));
    await until(() => !!f.relay.pending && f.client.status().state === 'reconnecting');
    assert.equal(f.relay.generation, generation); assert.equal(f.relay.opens.length, 1);
    assert.equal(queue.snapshot(lan.session).singerName, 'LAN');
    const [restored] = await f.relay.deliver([{ requestId: randomUUID(), operation: 'snapshot', payload: {}, session: old }]); assert.equal(restored.status, 200);
    assert.deepEqual(f.client.status().guests.map(item => item.name), ['Internet']); assert.equal(f.client.status().state, 'online');
  } finally { await f.dispose(); }
});

test('a committed request remains recoverable by its original guest after every reply acknowledgement is lost', async () => {
  const f = clientFixture();
  try {
    const queue = f.coordinator.getAuthority(), lan = queue.join(queue.createInvitation(60000), randomUUID(), token(), 'LAN', 0);
    await f.client.start({ slug: 'proper-volume' });
    const generation = f.relay.generation;
    const [joined] = await f.relay.deliver([{ requestId: randomUUID(), operation: 'join', payload: { joinId: randomUUID(), resumeSecret: token(), name: 'Internet', expectedRevision: f.state().revision } }]);
    const session = (joined.body as { session: string }).session, snap = f.state();
    const commandId = randomUUID(), before = f.relay.replies.length;
    f.relay.replyFailures = 3;
    await f.relay.deliver([{ requestId: randomUUID(), operation: 'request', session, payload: { command: { commandId, showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-clean' } } }]);
    await until(() => f.relay.replies.length === before + 3 && !!f.relay.pending && f.client.status().state === 'reconnecting');
    assert.equal(f.state().requests.length, 1); assert.equal(f.relay.opens.length, 1); assert.equal(f.relay.generation, generation);
    const [receipt] = await f.relay.deliver([{ requestId: randomUUID(), operation: 'outcome', session, payload: { commandId } }]);
    assert.equal(receipt.status, 200); assert.equal((receipt.body as { ok: boolean }).ok, true);
    assert.equal(f.state().requests.length, 1); assert.equal(queue.snapshot(lan.session).singerName, 'LAN');
  } finally { await f.dispose(); }
});

test('an expired late reply returns 409 without ending the room or revoking its guests', async () => {
  const f = clientFixture();
  try {
    await f.client.start({ slug: 'proper-volume' });
    f.relay.lateReplyConflict = true;
    await f.relay.deliver([{ requestId: randomUUID(), operation: 'admission', payload: {} }]);
    await until(() => !!f.relay.pending);
    assert.equal(f.client.status().state, 'online'); assert.equal(f.relay.opens.length, 1);
    const [next] = await f.relay.deliver([{ requestId: randomUUID(), operation: 'admission', payload: {} }]); assert.equal(next.status, 200);
  } finally { await f.dispose(); }
});

test('invalid private origin and reserved slugs cannot send a network request', async () => {
  const f = clientFixture();
  try {
    await assert.rejects(f.client.start({ slug: 'admin' }), /valid session/);
    writeFileSync(f.configurationFile, JSON.stringify({ baseUrl: 'https://evil.test', ownerToken: f.owner }));
    await assert.rejects(f.client.start({ slug: 'proper-volume' }));
    assert.equal(f.relay.opens.length, 0); assert.doesNotMatch(JSON.stringify(f.client.status()), /evil\.test/);
  } finally { await f.dispose(); }
});

test('missing and rejected device profiles leave Start Session available with specific recovery messages', async () => {
  const f = clientFixture();
  try {
    unlinkSync(f.configurationFile);
    await assert.rejects(f.client.start({ slug: 'proper-volume' }), /computer needs/);
    assert.equal(f.client.status().state, 'stopped');
    assert.equal(f.relay.opens.length, 0);
    writeFileSync(f.configurationFile, JSON.stringify({ baseUrl: INTERNET_QUEUE_ORIGIN, ownerToken: f.owner }), { mode: 0o600 });
    f.relay.openStatus = 403;
    await assert.rejects(f.client.start({ slug: 'proper-volume' }), /relay rejected this device/);
    assert.equal(f.client.status().state, 'stopped');
    f.relay.openStatus = 409;
    await assert.rejects(f.client.start({ slug: 'proper-volume' }), /choose another name/i);
    assert.equal(f.client.status().state, 'stopped');
  } finally { await f.dispose(); }
});

test('Linux and macOS can install a validated device profile privately and start a room', { skip: process.platform === 'win32' }, async () => {
  const f = clientFixture();
  const incoming = join(mkdtempSync(join(tmpdir(), 'booth-internet-profile-')), 'profile.json');
  try {
    unlinkSync(f.configurationFile);
    assert.equal(f.client.status().canImportConnection, true);
    writeFileSync(incoming, JSON.stringify({ baseUrl: 'https://example.test', ownerToken: f.owner }), { mode: 0o644 });
    await assert.rejects(f.client.importConnection(incoming), /invalid/);
    writeFileSync(incoming, JSON.stringify({ baseUrl: INTERNET_QUEUE_ORIGIN, ownerToken: f.owner }));
    await f.client.importConnection(incoming);
    assert.equal(statSync(f.configurationFile).mode & 0o777, 0o600);
    assert.equal(statSync(incoming).mode & 0o777, 0o644);
    assert.doesNotMatch(JSON.stringify(f.client.status()), new RegExp(f.owner));
    await f.client.start({ slug: 'proper-volume' });
    assert.equal(f.client.status().state, 'online');
    await assert.rejects(f.client.importConnection(incoming), /End the internet session/);
  } finally { await f.dispose(); rmSync(resolve(incoming, '..'), { recursive: true, force: true }); }
});

test('a malformed poll batch cannot select host actions and fails closed without changing LAN', async () => {
  const f = clientFixture();
  try {
    const queue = f.coordinator.getAuthority(), lan = queue.join(queue.createInvitation(60000), randomUUID(), token(), 'LAN', 0);
    await f.client.start({ slug: 'proper-volume' }); await until(() => !!f.relay.pending);
    f.relay.pending!.resolve(response({ roomId: f.relay.roomId, generation: f.relay.generation,
      requests: [{ requestId: randomUUID(), operation: 'play', payload: { type: 'play' } }] }));
    await until(() => f.client.status().state === 'failed');
    assert.equal(f.client.status().joinUrl, null); assert.equal(f.relay.replies.length, 0); assert.equal(f.state().playback, null);
    assert.equal(queue.snapshot(lan.session).singerName, 'LAN');
  } finally { await f.dispose(); }
});

test('End Session cancels a hung poll even when an injected fetcher ignores abort', async () => {
  const f = clientFixture();
  try {
    f.relay.ignorePollAbort = true; await f.client.start({ slug: 'proper-volume' });
    const before = Date.now(); assert.equal(await f.client.shutdown(1000), true);
    assert.ok(Date.now() - before < 500); assert.equal(f.client.status().state, 'stopped'); assert.equal(f.client.status().available, false);
    assert.equal(f.relay.closes.length, 1);
  } finally { await f.dispose(); }
});

test('retrying End after a lost close acknowledgement treats room-ended 410 as success', async () => {
  const f = clientFixture();
  try {
    await f.client.start({ slug: 'proper-volume' });
    f.relay.loseCloseAcknowledgement = true;
    await assert.rejects(f.client.stop(), /cleanup/);
    assert.equal(f.client.status().state, 'failed'); assert.equal(f.client.status().joinUrl, null);
    await f.client.stop();
    assert.equal(f.client.status().state, 'stopped'); assert.equal(f.relay.closes.length, 2); assert.equal(f.client.needsShutdownWait(), false);
    await f.client.start({ slug: 'proper-volume' }); assert.equal(f.client.status().state, 'online');
  } finally { await f.dispose(); }
});

test('POSIX private connection rejects group/world access and another owner', { skip: process.platform === 'win32' }, async () => {
  const f = clientFixture();
  try {
    chmodSync(f.configurationFile, 0o640); await assert.rejects(f.client.start({ slug: 'proper-volume' })); await f.client.stop();
    chmodSync(f.configurationFile, 0o604); await assert.rejects(f.client.start({ slug: 'proper-volume' })); await f.client.stop();
    chmodSync(f.configurationFile, 0o600);
    if (process.getuid?.() === 0) {
      chownSync(f.configurationFile, 1, process.getgid!());
      await assert.rejects(f.client.start({ slug: 'proper-volume' })); await f.client.stop();
      chownSync(f.configurationFile, 0, process.getgid!());
    }
    assert.equal(f.relay.opens.length, 0);
    await f.client.start({ slug: 'proper-volume' }); assert.equal(f.client.status().state, 'online');
  } finally { await f.dispose(); }
});

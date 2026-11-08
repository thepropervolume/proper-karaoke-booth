import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HostRemoteLifecycle, type HostRoomProvider, type RemoteRoom } from '../../src/main/remote-host-lifecycle';

function fixture() {
  let revoked = 0, stopped = 0, revokeFailures = 0, stopFailures = 0;
  const room: RemoteRoom = { origin: 'https://karaoke.test:8443', guests: () => [{ singerId: 'singer-123', name: 'Sam' }],
    createInvitation: () => 'A'.repeat(43), revokeInvitations: () => {}, revokeGuest: () => {},
    revokeAll: async () => { revoked++; if (revokeFailures-- > 0) throw new Error('revoke failed'); },
    stop: async () => { stopped++; if (stopFailures-- > 0) throw new Error('stop failed'); } };
  const provider: HostRoomProvider = { interfaces: () => [{ id: 'iface-1', label: 'Local interface' }],
    select: async kind => ({ label: kind === 'certificate' ? 'server.crt' : 'server.key', handle: `PRIVATE-${kind}` }), open: async () => room };
  return { room, provider, counts: () => ({ revoked, stopped }), fail: (revoke: number, stop: number) => { revokeFailures = revoke; stopFailures = stop; } };
}
async function settings(host: HostRemoteLifecycle) {
  return { interfaceId: 'iface-1', hostname: 'karaoke.test', port: 8443, certificateToken: (await host.select('certificate'))!.token,
    privateKeyToken: (await host.select('privateKey'))!.token };
}

test('disabled host has no listener factory and rejects all room operations', async () => {
  const host = new HostRemoteLifecycle(null);
  assert.deepEqual(host.status(), { available: false, room: 'closed', roomId: null, lanOrigin: null, guests: [], interfaces: [], message: 'Remote queueing is not available yet.' });
  await assert.rejects(host.open({}), /not available/); await assert.rejects(host.select('certificate'), /not available/);
  assert.throws(() => host.createInvitation(900), /unavailable/);
});

test('room requires separately selected capabilities and returns only public status', async () => {
  const { provider, counts } = fixture(); let input: unknown;
  const open = provider.open; provider.open = async value => { input = value; return open(value); };
  const host = new HostRemoteLifecycle(provider);
  const config = await settings(host);
  await assert.rejects(host.open({ ...config, privateKeyToken: config.certificateToken }), /Invalid/);
  await assert.rejects(host.open({ ...config, path: 'C:\\secret.key' }), /Invalid/);
  await host.open(config);
  assert.match(JSON.stringify(input), /PRIVATE-privateKey/);
  assert.doesNotMatch(JSON.stringify(host.status()), /PRIVATE-|token/);
  assert.equal(host.status().room, 'open');
  assert.equal(host.createInvitation(900), `https://karaoke.test:8443/singer/#invite=${'A'.repeat(43)}`);
  assert.throws(() => host.createInvitation(3601), /duration/);
  await host.close();
  assert.deepEqual(counts(), { revoked: 1, stopped: 1 }); assert.equal(host.status().room, 'closed');
});

test('partial cleanup attempts both revocation and stop, blocks reopen and allows an explicit recovery retry', async () => {
  const { provider, counts, fail } = fixture();
  const host = new HostRemoteLifecycle(provider, () => { throw new Error('UI closed'); });
  await host.open(await settings(host)); fail(1, 0);
  await assert.rejects(host.close(), /recovery/);
  assert.deepEqual(counts(), { revoked: 1, stopped: 1 }); assert.equal(host.status().room, 'failed');
  await assert.rejects(host.open({}), /recovery/);
  await host.close();
  assert.deepEqual(counts(), { revoked: 2, stopped: 2 }); assert.equal(host.status().room, 'closed');
});

test('unexpected origin is revoked and stopped without exposing an invitation', async () => {
  const { provider, room, counts } = fixture(); room.origin = 'http://karaoke.test:8443';
  const host = new HostRemoteLifecycle(provider);
  await assert.rejects(host.open(await settings(host)), /origin/);
  assert.deepEqual(counts(), { revoked: 1, stopped: 1 }); assert.equal(host.status().room, 'closed');
});

test('credential revocation begins even when stopping connections is slow', async () => {
  const { provider, room, counts } = fixture(); let release!: () => void;
  const finished = new Promise<void>(resolve => { release = resolve; });
  room.stop = () => finished;
  const host = new HostRemoteLifecycle(provider);
  await host.open(await settings(host));
  const closing = host.close();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(counts().revoked, 1);
  assert.equal(host.status().room, 'closing');
  release(); await closing;
  assert.equal(host.status().room, 'closed');
});

test('unexpected listener failure immediately disables the room and cleans up before recovery', async () => {
  const { provider, counts } = fixture(); const original = provider.open;
  let fail!: () => void, guestChanged!: () => void, updates = 0;
  provider.open = async input => { fail = input.onFailure; guestChanged = input.onGuestsChanged; return original(input); };
  const host = new HostRemoteLifecycle(provider, () => { updates++; });
  await host.open(await settings(host)); const before = updates; guestChanged(); assert.ok(updates > before);
  fail(); assert.equal(host.status().room, 'failed'); assert.throws(() => host.createInvitation(900), /unavailable/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(counts(), { revoked: 1, stopped: 1 });
  await host.close(); assert.equal(host.status().room, 'closed');
  guestChanged(); assert.equal(host.status().guests.length, 0);
});

test('failure while a listener opens never publishes an open room', async () => {
  const { provider, counts } = fixture(); const original = provider.open;
  provider.open = async input => { const room = await original(input); input.onFailure(); return room; };
  const phases: string[] = [];
  const host = new HostRemoteLifecycle(provider, status => phases.push(status.room));
  await assert.rejects(host.open(await settings(host)), /listener failed/);
  assert.deepEqual(counts(), { revoked: 1, stopped: 1 }); assert.equal(phases.includes('open'), false);
});

test('shutdown aborts guest access immediately and coalesces an in-progress close', async () => {
  const { provider, room, counts } = fixture(); const original = provider.open;
  let signal!: AbortSignal, release!: () => void;
  const drained = new Promise<void>(resolve => { release = resolve; });
  room.stop = () => drained;
  provider.open = async input => { signal = input.signal; return original(input); };
  const host = new HostRemoteLifecycle(provider);
  await host.open(await settings(host));
  const closing = host.close(), shutdown = host.shutdown(1000);
  assert.equal(signal.aborted, true); assert.throws(() => host.createInvitation(900), /unavailable/);
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(counts().revoked, 1);
  release(); await closing; assert.equal(await shutdown, true); assert.equal(counts().revoked, 1);
});

test('shutdown during opening aborts immediately and cleans up a late room without publishing it open', async () => {
  const { provider, room, counts } = fixture(); let signal!: AbortSignal, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  provider.open = async input => { signal = input.signal; await gate; return room; };
  const phases: string[] = [], host = new HostRemoteLifecycle(provider, status => phases.push(status.room));
  const opening = host.open(await settings(host));
  const shutdown = host.shutdown(1000); assert.equal(signal.aborted, true);
  release(); await assert.rejects(opening, /cancelled/); assert.equal(await shutdown, true);
  assert.deepEqual(counts(), { revoked: 1, stopped: 1 }); assert.equal(phases.includes('open'), false);
});

test('shutdown deadline does not wait forever for a misbehaving opener and still cleans up if it returns late', async () => {
  const { provider, room, counts } = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  provider.open = async () => { await gate; return room; };
  const host = new HostRemoteLifecycle(provider);
  const opening = host.open(await settings(host));
  assert.equal(await host.shutdown(5), false);
  release(); await assert.rejects(opening, /cancelled/);
  assert.deepEqual(counts(), { revoked: 1, stopped: 1 });
});

test('remote missing-song notifications only reach the host while the current room is open', async () => {
  const { provider } = fixture(); const original = provider.open;
  let notify!: () => void, notifications = 0;
  provider.open = async input => { notify = input.onMissingRequest; return original(input); };
  const host = new HostRemoteLifecycle(provider, () => {}, () => { notifications++; });
  await host.open(await settings(host)); notify(); assert.equal(notifications, 1);
  await host.shutdown(1000); notify(); assert.equal(notifications, 1);
});

test('a file picker returning after shutdown cannot create a usable capability', async () => {
  const { provider } = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  provider.select = async () => { await gate; return { label: 'server.crt', handle: 'PRIVATE' }; };
  const host = new HostRemoteLifecycle(provider);
  const choosing = host.select('certificate');
  assert.equal(await host.shutdown(100), true);
  release(); assert.equal(await choosing, null);
  await assert.rejects(host.select('privateKey'), /not available/);
});

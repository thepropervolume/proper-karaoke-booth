import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { createLanHostProvider } from '../../src/main/remote-provider';
import { Store } from '../../src/main/store';
import type { LanTransportOptions } from '../../src/main/remote-https';
import { HostRemoteLifecycle } from '../../src/main/remote-host-lifecycle';

const secret = () => randomBytes(32).toString('base64url');
const devices = () => ({ wifi: [{ address: '192.168.20.3', family: 'IPv4' as const, internal: false, netmask: '255.255.255.0', cidr: '192.168.20.3/24', mac: '00:00:00:00:00:00' }] });
const staticHandler = async () => false;
const callbacks = { onGuestsChanged: () => {}, onMissingRequest: () => {}, onFailure: () => {}, signal: new AbortController().signal };
async function selected(provider: ReturnType<typeof createLanHostProvider>) {
  const cert = await provider.select('certificate'), key = await provider.select('privateKey');
  assert.ok(cert && key);
  return { certificate: cert.handle, privateKey: key.handle };
}
function setup(extra: Partial<Parameters<typeof createLanHostProvider>[0]> = {}) {
  const store = new Store<ShowState>(':memory:');
  let state = createInitialState('show-00001', 'epoch-0001'); store.save(state);
  let options: LanTransportOptions | undefined, closes = 0, starts = 0;
  const provider = createLanHostProvider({ store, settings: () => DEFAULT_SETTINGS, installCommitted: value => { state = value; },
    interfaces: devices, pickFile: async kind => resolve(`tests/fixtures/tls/test-only.${kind === 'certificate' ? 'crt' : 'key'}`),
    staticHandler, verifyHost: async () => {}, verifyTrust: async () => {},
    startTransport: async value => { options = value; starts++; return { origin: `https://${value.hostname}:${value.port}`, close: async () => { closes++; } }; }, ...extra });
  return { store, provider, get options() { assert.ok(options); return options; }, get closes() { return closes; }, get starts() { return starts; }, get state() { return state; } };
}

test('opt-in provider keeps selected paths private and reuses one authority while revoking room credentials', async () => {
  const s = setup();
  try {
    assert.equal(s.starts, 0);
    const list = s.provider.interfaces(); assert.equal(list.length, 1);
    const first = await selected(s.provider);
    assert.deepEqual(Object.keys(first.certificate as object), []);
    let changes = 0, missingChanges = 0;
    const input = { interfaceId: list[0].id, hostname: 'karaoke.example', port: 4433, ...first,
      onGuestsChanged: () => { changes++; }, onMissingRequest: () => { missingChanges++; }, onFailure: () => {}, signal: new AbortController().signal };
    const room = await s.provider.open(input);
    const invite = room.createInvitation(60000);
    const registration = s.options.authority.join(invite, 'join-id-0001', secret(), 'Alice', 0);
    assert.equal(s.state.singers[0].name, 'Alice');
    assert.deepEqual(room.guests(), [{ singerId: registration.singerId, name: 'Alice' }]);
    assert.equal(changes, 1);
    assert.equal(s.options.authority.submitMissing(registration.session, { commandId: 'missing-0001', title: 'Song', artist: '' }).ok, true);
    assert.equal(missingChanges, 1);
    room.revokeGuest(registration.singerId);
    assert.deepEqual(room.guests(), []);
    assert.throws(() => s.options.authority.snapshot(registration.session));
    assert.equal(changes, 2);
    await Promise.all([room.stop(), room.revokeAll()]);
    assert.equal(s.closes, 1);
    const next = await selected(s.provider);
    const nextRoom = await s.provider.open({ ...input, ...next });
    assert.throws(() => s.options.authority.admissionInfo(invite));
    await Promise.all([nextRoom.revokeAll(), nextRoom.stop()]);
    assert.equal(s.starts, 2);
  } finally { s.store.close(); }
});

test('forged selections and a disappeared or non-private interface cannot start a room', async () => {
  let networks = devices();
  const s = setup({ interfaces: () => networks });
  try {
    const id = s.provider.interfaces()[0].id, files = await selected(s.provider);
    await assert.rejects(s.provider.open({ interfaceId: id, hostname: 'karaoke.example', port: 4433, ...files, certificate: {}, ...callbacks }));
    networks = { wifi: [{ ...devices().wifi[0], address: '8.8.8.8', cidr: '8.8.8.8/24' }] };
    await assert.rejects(s.provider.open({ interfaceId: id, hostname: 'karaoke.example', port: 4433, ...files, ...callbacks }));
    assert.equal(s.starts, 0);
  } finally { s.store.close(); }
});

test('a listener failure while startup is in flight closes a late listener and permits a clean retry', async () => {
  let release!: () => void, announce!: () => void, closed = 0, failCount = 0, attempt = 0;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const s = setup({ startTransport: async options => {
    if (++attempt === 1) { options.onError(new Error('startup failure')); announce(); await gate; }
    return { origin: `https://${options.hostname}:${options.port}`, close: async () => { closed++; } };
  } });
  try {
    const files = await selected(s.provider), id = s.provider.interfaces()[0].id;
    const input = { interfaceId: id, hostname: 'karaoke.example', port: 4433, ...files, onGuestsChanged: () => {}, onMissingRequest: () => {}, onFailure: () => { failCount++; }, signal: new AbortController().signal };
    const pending = s.provider.open(input);
    await started; release();
    await assert.rejects(pending);
    assert.equal(closed, 1); assert.equal(failCount, 1);
    const room = await s.provider.open(input);
    await Promise.all([room.stop(), room.revokeAll()]);
    assert.equal(closed, 2);
  } finally { s.store.close(); }
});

test('trust failure and unexpected listener failure gate guest access and clean up', async () => {
  let failTrust = true;
  const s = setup({ verifyTrust: async () => { if (failTrust) throw new Error('not trusted'); } });
  try {
    const files = await selected(s.provider), id = s.provider.interfaces()[0].id;
    let failures = 0;
    const input = { interfaceId: id, hostname: 'karaoke.example', port: 4433, ...files, onGuestsChanged: () => {}, onMissingRequest: () => {}, onFailure: () => { failures++; }, signal: new AbortController().signal };
    await assert.rejects(s.provider.open(input)); assert.equal(s.closes, 1);
    failTrust = false;
    const room = await s.provider.open(input);
    const invite = room.createInvitation(60000);
    s.options.onError(new Error('failure'));
    assert.throws(() => s.options.authority.admissionInfo(invite));
    assert.throws(() => room.createInvitation(60000));
    await Promise.all([room.stop(), room.revokeAll()]);
    assert.equal(s.closes, 2); assert.equal(failures, 1);
  } finally { s.store.close(); }
});

test('abort during trust verification gates and closes the listener immediately, before the pending check finishes', async () => {
  let release!: () => void, announce!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const s = setup({ verifyTrust: async () => { announce(); await gate; } });
  try {
    const files = await selected(s.provider), id = s.provider.interfaces()[0].id, controller = new AbortController();
    const input = { interfaceId: id, hostname: 'karaoke.example', port: 4433, ...files, ...callbacks, signal: controller.signal };
    const pending = s.provider.open(input);
    await started;
    controller.abort();
    assert.throws(() => s.options.authority.admissionInfo(secret()));
    assert.equal(s.closes, 1, 'The listener must start closing without waiting for trust verification.');
    await assert.rejects(s.provider.open({ ...input, signal: new AbortController().signal }), /already open/);
    release(); await assert.rejects(pending);
  } finally { s.store.close(); }
});

test('abort while resolving hostname prevents authority or network construction', async () => {
  let release!: () => void, announce!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const s = setup({ verifyHost: async () => { announce(); await gate; } });
  try {
    const files = await selected(s.provider), id = s.provider.interfaces()[0].id, controller = new AbortController();
    const pending = s.provider.open({ interfaceId: id, hostname: 'karaoke.example', port: 4433, ...files, ...callbacks, signal: controller.signal });
    await started; controller.abort(); release(); await assert.rejects(pending);
    assert.equal(s.starts, 0);
    // No authority has been created and so the Store can still open its one instance.
    s.store.openRemoteQueue(() => DEFAULT_SETTINGS, () => {});
  } finally { s.store.close(); }
});

test('aborting an open room blocks guest calls synchronously and closes its listener', async () => {
  const s = setup();
  try {
    const files = await selected(s.provider), id = s.provider.interfaces()[0].id, controller = new AbortController();
    const room = await s.provider.open({ interfaceId: id, hostname: 'karaoke.example', port: 4433, ...files, ...callbacks, signal: controller.signal });
    const invite = room.createInvitation(60000);
    controller.abort();
    assert.throws(() => s.options.authority.admissionInfo(invite));
    assert.throws(() => room.createInvitation(60000));
    await Promise.all([room.stop(), room.revokeAll()]);
    assert.equal(s.closes, 1);
  } finally { s.store.close(); }
});

test('failed startup cleanup retains a room handle so shutdown cannot falsely report success', async () => {
  const s = setup({ verifyTrust: async () => { throw new Error('trust failure'); }, startTransport: async options => ({
    origin: `https://${options.hostname}:${options.port}`, close: async () => { throw new Error('listener did not stop'); }
  }) });
  try {
    const lifecycle = new HostRemoteLifecycle(s.provider), id = lifecycle.status().interfaces[0].id;
    const cert = await lifecycle.select('certificate'), key = await lifecycle.select('privateKey'); assert.ok(cert && key);
    await assert.rejects(lifecycle.open({ interfaceId: id, hostname: 'karaoke.example', port: 4433, certificateToken: cert.token, privateKeyToken: key.token }));
    assert.equal(lifecycle.status().room, 'failed');
    assert.equal(lifecycle.needsShutdownWait(), true);
    assert.equal(await lifecycle.shutdown(100), false);
  } finally { s.store.close(); }
});

test('shutdown gate blocks guests immediately but still persists credential revocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-provider-shutdown-'));
  const dbPath = join(directory, 'show.sqlite');
  let store = new Store<ShowState>(dbPath);
  let options: LanTransportOptions | undefined;
  try {
    store.save(createInitialState('show-00001', 'epoch-0001'));
    const provider = createLanHostProvider({ store, settings: () => DEFAULT_SETTINGS, installCommitted: () => {}, interfaces: devices,
      pickFile: async kind => resolve(`tests/fixtures/tls/test-only.${kind === 'certificate' ? 'crt' : 'key'}`), staticHandler,
      verifyHost: async () => {}, verifyTrust: async () => {}, startTransport: async value => { options = value; return { origin: `https://${value.hostname}:${value.port}`, close: async () => {} }; } });
    const files = await selected(provider), controller = new AbortController();
    const room = await provider.open({ interfaceId: provider.interfaces()[0].id, hostname: 'karaoke.example', port: 4433, ...files, ...callbacks, signal: controller.signal });
    const invitation = room.createInvitation(60000), resume = secret();
    const guest = options!.authority.join(invitation, 'join-id-0001', resume, 'Alice', 0);
    store.disableRemoteQueue(); controller.abort();
    assert.throws(() => options!.authority.snapshot(guest.session));
    await Promise.all([room.stop(), room.revokeAll()]);
    store.close(); store = new Store<ShowState>(dbPath);
    const fresh = store.openRemoteQueue(() => DEFAULT_SETTINGS, () => {});
    assert.throws(() => fresh.resume(resume));
    assert.throws(() => fresh.admissionInfo(invitation));
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

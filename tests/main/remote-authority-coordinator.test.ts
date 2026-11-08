import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { RemoteAuthorityCoordinator } from '../../src/main/remote-authority-coordinator';
import { createLanHostProvider } from '../../src/main/remote-provider';
import { RemoteRelayScope } from '../../src/main/remote-relay-scope';
import { Store } from '../../src/main/store';
import type { LanTransportOptions } from '../../src/main/remote-https';

const secret = () => randomBytes(32).toString('base64url');
const network = () => ({ wifi: [{ address: '192.168.20.3', family: 'IPv4' as const, internal: false, netmask: '255.255.255.0', cidr: '192.168.20.3/24', mac: '00:00:00:00:00:00' }] });

test('authority is lazy and LAN and relay share one host store without revoking each other', async () => {
  const store = new Store<ShowState>(':memory:');
  try {
    let state = createInitialState('show-00001', 'epoch-0001'); store.save(state);
    const coordinator = new RemoteAuthorityCoordinator(store, () => DEFAULT_SETTINGS, value => { state = value; });
    let transport: LanTransportOptions | undefined;
    const provider = createLanHostProvider({ store, coordinator, settings: () => DEFAULT_SETTINGS, installCommitted: () => { throw new Error('Wrong installer'); },
      interfaces: network, pickFile: async kind => resolve(`tests/fixtures/tls/test-only.${kind === 'certificate' ? 'crt' : 'key'}`),
      staticHandler: async () => false, verifyHost: async () => {}, verifyTrust: async () => {},
      startTransport: async value => { transport = value; return { origin: `https://${value.hostname}:${value.port}`, close: async () => {} }; } });
    // Constructing the coordinator and provider does not reserve or initialize a queue.
    const queue = coordinator.getAuthority();
    assert.equal(coordinator.getAuthority(), queue);
    assert.throws(() => store.openRemoteQueue(() => DEFAULT_SETTINGS, () => {}), /already open/);
    const relay = new RemoteRelayScope(queue), relayInvite = relay.createInvitation(60000);
    const relayGuest = relay.authority.join(relayInvite, 'relay-join-0001', secret(), 'Relay', 0);
    const cert = await provider.select('certificate'), key = await provider.select('privateKey'); assert.ok(cert && key);
    const room = await provider.open({ interfaceId: provider.interfaces()[0].id, hostname: 'karaoke.example', port: 4433,
      certificate: cert.handle, privateKey: key.handle, signal: new AbortController().signal,
      onGuestsChanged: () => {}, onMissingRequest: () => {}, onFailure: () => {} });
    assert.equal(relay.authority.snapshot(relayGuest.session).singerName, 'Relay');
    const lanInvite = room.createInvitation(60000);
    const lan = transport!.authority.join(lanInvite, 'lan-join-0001', secret(), 'LAN', state.revision);
    assert.equal(state.singers.length, 2);
    await Promise.all([room.stop(), room.revokeAll()]);
    assert.equal(relay.authority.snapshot(relayGuest.session).singerName, 'Relay');
    assert.throws(() => transport!.authority.snapshot(lan.session));
    relay.close();
  } finally { store.close(); }
});

test('installation failure gates acquisition and notifies every transport even if callbacks fail', async () => {
  const store = new Store<ShowState>(':memory:');
  try {
    const initial = createInitialState('show-00001', 'epoch-0001'); store.save(initial);
    const coordinator = new RemoteAuthorityCoordinator(store, () => DEFAULT_SETTINGS, () => { throw new Error('install fault'); });
    let notified = 0, late = 0, acquireBlocked = false, saveBlocked = false;
    let removeSecond = () => {};
    coordinator.onFailure(() => { notified++; removeSecond(); throw new Error('observer fault'); });
    removeSecond = coordinator.onFailure(() => {
      notified++;
      try { coordinator.getAuthority(); } catch { acquireBlocked = true; }
      try { store.save(initial); } catch { saveBlocked = true; } // a reentrant observer cannot overwrite the committed guest state
    });
    coordinator.onFailure(async () => { notified++; throw new Error('async observer fault'); });
    const unsubscribe = coordinator.onFailure(() => { throw new Error('must not run'); }); unsubscribe();
    const queue = coordinator.getAuthority(), invite = queue.createInvitation(60000);
    assert.throws(() => queue.join(invite, 'join-id-0001', secret(), 'Alice', 0), /recovery/);
    assert.equal(notified, 3); assert.equal(acquireBlocked, true); assert.equal(saveBlocked, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    coordinator.onFailure(() => { late++; }); assert.equal(late, 1);
    assert.throws(() => coordinator.getAuthority(), /recovery/);
    assert.throws(() => queue.admissionInfo(invite), /recovery/);
    assert.throws(() => store.save(initial), /recovery/);
    assert.equal(store.load()!.singers[0].name, 'Alice');
  } finally { store.close(); }
});

test('an install fault from a relay request gates both active transport owners', async () => {
  const store = new Store<ShowState>(':memory:');
  try {
    let state = createInitialState('show-00001', 'epoch-0001'), broken = false, lanFailures = 0, relayFailures = 0, stopped = 0;
    state.versions.push({ id: 'version-clean', title: 'Song', artist: 'Artist', rating: 'clean' }); store.save(state);
    const coordinator = new RemoteAuthorityCoordinator(store, () => DEFAULT_SETTINGS, value => { if (broken) throw new Error('install fault'); state = value; });
    let transport: LanTransportOptions | undefined;
    const provider = createLanHostProvider({ store, coordinator, settings: () => DEFAULT_SETTINGS, installCommitted: () => {}, interfaces: network,
      pickFile: async kind => resolve(`tests/fixtures/tls/test-only.${kind === 'certificate' ? 'crt' : 'key'}`), staticHandler: async () => false,
      verifyHost: async () => {}, verifyTrust: async () => {}, startTransport: async value => { transport = value; return { origin: `https://${value.hostname}:${value.port}`, close: async () => { stopped++; } }; } });
    const cert = await provider.select('certificate'), key = await provider.select('privateKey'); assert.ok(cert && key);
    const room = await provider.open({ interfaceId: provider.interfaces()[0].id, hostname: 'karaoke.example', port: 4433,
      certificate: cert.handle, privateKey: key.handle, signal: new AbortController().signal,
      onGuestsChanged: () => {}, onMissingRequest: () => {}, onFailure: () => { lanFailures++; } });
    const lan = transport!.authority.join(room.createInvitation(60000), 'lan-join-0001', secret(), 'LAN', state.revision);
    const queue = coordinator.getAuthority(), relay = new RemoteRelayScope(queue);
    coordinator.onFailure(() => { relayFailures++; relay.close(); });
    const guest = relay.authority.join(relay.createInvitation(60000), 'relay-join-0001', secret(), 'Relay', state.revision);
    const snapshot = relay.authority.snapshot(guest.session); broken = true;
    assert.throws(() => relay.authority.submit(guest.session, { commandId: 'relay-command-1', showId: snapshot.showId,
      hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, versionId: 'version-clean' }), /recovery/);
    assert.equal(lanFailures, 1); assert.equal(relayFailures, 1);
    assert.throws(() => transport!.authority.snapshot(lan.session));
    assert.throws(() => relay.authority.snapshot(guest.session));
    await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(stopped, 1);
  } finally { store.close(); }
});

test('an accidentally asynchronous installer fails closed and notifies its listeners', () => {
  const store = new Store<ShowState>(':memory:');
  try {
    store.save(createInitialState('show-00001', 'epoch-0001'));
    const coordinator = new RemoteAuthorityCoordinator(store, () => DEFAULT_SETTINGS, async () => {});
    let failures = 0; coordinator.onFailure(() => { failures++; });
    const queue = coordinator.getAuthority(), invite = queue.createInvitation(60000);
    assert.throws(() => queue.join(invite, 'join-id-0001', secret(), 'Alice', 0), /recovery/);
    assert.equal(failures, 1); assert.throws(() => coordinator.getAuthority(), /recovery/);
  } finally { store.close(); }
});

test('coordinator refuses a mismatched store and cannot create authority after shutdown', () => {
  const first = new Store<ShowState>(':memory:'), second = new Store<ShowState>(':memory:'), third = new Store<ShowState>(':memory:');
  try {
    const coordinator = new RemoteAuthorityCoordinator(first, () => DEFAULT_SETTINGS, () => {});
    assert.throws(() => createLanHostProvider({ store: second, coordinator, settings: () => DEFAULT_SETTINGS, installCommitted: () => {},
      pickFile: async () => null, staticHandler: async () => false }), /host show store/);
    first.disableRemoteQueue();
    assert.throws(() => coordinator.getAuthority(), /shutting down/);
    const cached = new RemoteAuthorityCoordinator(third, () => DEFAULT_SETTINGS, () => {});
    cached.getAuthority(); third.disableRemoteQueue();
    assert.throws(() => cached.getAuthority(), /shutting down/);
  } finally { first.close(); second.close(); third.close(); }
});

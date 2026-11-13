import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyCommand, createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { Store } from '../../src/main/store';

const secret = () => randomBytes(32).toString('base64url');

test('remote commits update the same authority used for subsequent host and guest writes', () => {
  const store = new Store<ShowState>(':memory:');
  try {
    let state = createInitialState('show-00001', 'epoch-0001');
    state.versions.push({ id: 'version-clean', title: 'Clean', artist: 'Artist', rating: 'clean' });
    store.save(state);
    const remote = store.openRemoteQueue(() => DEFAULT_SETTINGS, committed => { state = committed; });
    assert.throws(() => store.openRemoteQueue(() => DEFAULT_SETTINGS, () => {}), /already open/);
    const invite = remote.createInvitation(10000);
    const guest = remote.join(invite, 'join-id-0001', secret(), 'Alice', state.revision);
    assert.equal(state.singers[0].id, guest.singerId);
    const hostResult = applyCommand(state, { commandId: 'host-command-0001', showId: state.showId, hostEpoch: state.hostEpoch,
      expectedRevision: state.revision, actor: { role: 'host', id: 'host' }, command: { type: 'addSinger', singer: { id: 'host-singer-0001', name: 'Bob' } } });
    assert.equal(hostResult.outcome.ok, true);
    store.save(hostResult.state); state = hostResult.state;
    const snapshot = remote.snapshot(guest.session);
    assert.equal(snapshot.revision, state.revision);
    assert.equal(remote.submit(guest.session, { commandId: 'guest-command-0001', showId: snapshot.showId,
      hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, versionId: 'version-clean' }).ok, true);
    assert.deepEqual(store.load(), state);
    assert.equal(state.singers.length, 2);
    assert.equal(state.requests[0].singerId, guest.singerId);
  } finally { store.close(); }
});

test('all guest operations fail closed after a committed request cannot be installed', () => {
  const store = new Store<ShowState>(':memory:');
  try {
    let state = createInitialState('show-00001', 'epoch-0001');
    state.versions.push({ id: 'version-clean', title: 'Clean', artist: 'Artist', rating: 'clean' });
    store.save(state);
    let fail = false;
    const remote = store.openRemoteQueue(() => DEFAULT_SETTINGS, committed => { if (fail) throw new Error('failure'); state = committed; });
    const invitation = remote.createInvitation(10000), resume = secret();
    const guest = remote.join(invitation, 'join-id-0001', resume, 'Alice', 0);
    const snap = remote.snapshot(guest.session);
    const request = { commandId: 'command-0001', showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-clean' };
    fail = true;
    assert.throws(() => remote.submit(guest.session, request), /needs recovery/);
    assert.throws(() => remote.snapshot(guest.session), /needs recovery/);
    assert.throws(() => remote.catalog(guest.session), /needs recovery/);
    assert.throws(() => remote.catalogItem(guest.session, 'version-clean'), /needs recovery/);
    assert.throws(() => remote.outcome(guest.session, 'command-0001'), /needs recovery/);
    assert.throws(() => remote.resume(resume), /needs recovery/);
    assert.throws(() => remote.admissionInfo(invitation), /needs recovery/);
    assert.throws(() => remote.join(invitation, 'join-id-0002', secret(), 'Bob', snap.revision), /needs recovery/);
    assert.throws(() => remote.revokeInvitations(), /needs recovery/);
    assert.throws(() => remote.closeRoom(), /needs recovery/);
    assert.equal(store.load()!.requests.length, 1);
  } finally { store.close(); }
});

test('a failed state installation blocks host and guest writes until a fresh store reloads the commit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-authority-'));
  const path = join(directory, 'show.sqlite');
  let store = new Store<ShowState>(path);
  try {
    const oldState = createInitialState('show-00001', 'epoch-0001');
    store.save(oldState);
    const remote = store.openRemoteQueue(() => DEFAULT_SETTINGS, () => { throw new Error('simulated installation failure'); });
    const invite = remote.createInvitation(10000);
    assert.throws(() => remote.join(invite, 'join-id-0001', secret(), 'Alice', 0), /needs recovery/);
    assert.throws(() => store.save(oldState), /needs recovery/);
    assert.throws(() => store.checkpoint('generation-0001', 12), /needs recovery/);
    assert.throws(() => store.addMissingSongRequest({ id: 'missing-0001', singer: 'Alice', title: 'Song', artist: '', createdAt: '2026-01-01' }), /needs recovery/);
    assert.throws(() => store.collections.mutate({ type: 'add', playlistId: 'kj-picks', versionId: 'version-0001' }, [], []), /needs recovery/);
    assert.throws(() => remote.createInvitation(10000), /needs recovery/);
    assert.throws(() => remote.revokeGuest('singer-0001'), /needs recovery/);
    assert.equal(store.load()!.singers[0].name, 'Alice'); // diagnostic read; does not clear the latch
    assert.ok(store.collections.snapshot());
    store.close();
    store = new Store<ShowState>(path);
    const recovered = store.load()!;
    assert.equal(recovered.singers[0].name, 'Alice');
    store.save(recovered);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { RemoteAuthorityCoordinator } from '../../src/main/remote-authority-coordinator';
import { RemoteRelayScope } from '../../src/main/remote-relay-scope';
import { dispatchInternetGuestCallAsync } from '../../src/main/internet-queue-client';
import { Store } from '../../src/main/store';
import { parseGuestRequest, projectGuestResponse } from '../../src/relay/protocol';
import { parseGuestSnapshot } from '../../src/remote/guest-response';

const secret = () => randomBytes(32).toString('base64url');

test('applause is bound to authenticated singer and repeat receipts never replay it', async () => {
  const store = new Store<ShowState>(':memory:');
  let state = createInitialState('show-00001', 'epoch-0001');
  store.save(state);
  const calls: { singer: string; event: string }[] = [];
  const coordinator = new RemoteAuthorityCoordinator(store, () => DEFAULT_SETTINGS, value => { state = value; },
    async (singer, event) => { calls.push({ singer, event }); return { ok: true, revision: state.revision }; });
  try {
    const scope = new RemoteRelayScope(coordinator.getAuthority());
    const invitation = scope.createInvitation(60_000);
    const guest = scope.authority.join(invitation, randomUUID(), secret(), 'Sam', state.revision);
    const missing = { commandId: randomUUID(), title: 'Unlisted song', artist: 'Artist' };
    const firstSuggestion = scope.authority.submitMissing(guest.session, missing);
    assert.equal(firstSuggestion.ok, true);
    assert.equal(state.points?.accounts.find(item => item.singerId === guest.singerId)?.points, 10);
    assert.deepEqual(scope.authority.submitMissing(guest.session, missing), firstSuggestion);
    assert.equal(state.points?.accounts.find(item => item.singerId === guest.singerId)?.points, 10);
    const snapshot = scope.authority.snapshot(guest.session);
    assert.equal(snapshot.applauseEnabled, true);
    assert.equal(snapshot.applauseCredits, 3);
    const command = { commandId: randomUUID(), showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision };
    const call = { requestId: randomUUID(), operation: 'applause', payload: { command }, session: guest.session };
    assert.ok(parseGuestRequest('applause', call.payload, guest.session));
    assert.equal(parseGuestRequest('applause', { command: { ...command, singerId: 'someone-else' } }, guest.session), null);
    assert.equal(parseGuestRequest('applause', call.payload), null);
    const reply = await dispatchInternetGuestCallAsync(scope.authority, call, () => invitation);
    assert.deepEqual(reply.body, { ok: true, revision: state.revision });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].singer, guest.singerId);
    assert.match(calls[0].event, /^remote-/);
    assert.deepEqual((await dispatchInternetGuestCallAsync(scope.authority, call, () => invitation)).body, reply.body);
    assert.equal(calls.length, 1);
    assert.deepEqual(scope.authority.outcome(guest.session, command.commandId), reply.body);
    const projected = projectGuestResponse('snapshot', 200, snapshot);
    assert.ok(projected?.body);
    assert.equal(parseGuestSnapshot(projected.body).applauseCredits, 3);
    scope.close();
    assert.equal((await dispatchInternetGuestCallAsync(scope.authority, call, () => invitation)).status, 400);
  } finally { store.close(); }
});

test('guest snapshot rejects impossible or malformed applause balances', () => {
  const snapshot = { showId: 'show-00001', hostEpoch: 'epoch-0001', revision: 1, singerId: 'singer-0001',
    singerName: 'Sam', catalog: [], catalogNextOffset: null, requests: [], applauseEnabled: true, applauseCredits: 3, points: 10 };
  assert.equal(parseGuestSnapshot(snapshot).points, 10);
  for (const update of [{ applauseCredits: 6 }, { applauseCredits: -1 }, { points: -1 }, { applauseEnabled: 'yes' }]) {
    assert.throws(() => parseGuestSnapshot({ ...snapshot, ...update }));
    assert.equal(projectGuestResponse('snapshot', 200, { ...snapshot, ...update }), null);
  }
});

test('a pending applause can recheck guest authorization after a room closes', async () => {
  const store = new Store<ShowState>(':memory:');
  let state = createInitialState('show-00001', 'epoch-0001');
  store.save(state);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let authorizedAfterClose: boolean | undefined;
  const coordinator = new RemoteAuthorityCoordinator(store, () => DEFAULT_SETTINGS, value => { state = value; },
    async (_singer, _event, _show, _epoch, _revision, stillAuthorized) => {
      await wait;
      authorizedAfterClose = stillAuthorized();
      return { ok: false, code: 'ROOM_CLOSED', message: 'Room closed.', revision: state.revision };
    });
  try {
    const scope = new RemoteRelayScope(coordinator.getAuthority());
    const invitation = scope.createInvitation(60_000);
    const guest = scope.authority.join(invitation, randomUUID(), secret(), 'Sam', state.revision);
    const pending = scope.authority.applaud(guest.session, { commandId: randomUUID(), showId: state.showId,
      hostEpoch: state.hostEpoch, expectedRevision: state.revision });
    scope.close();
    release();
    assert.equal((await pending).ok, false);
    assert.equal(authorizedAfterClose, false);
  } finally { store.close(); }
});

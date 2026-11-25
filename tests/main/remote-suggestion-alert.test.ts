import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { RemoteAuthorityCoordinator } from '../../src/main/remote-authority-coordinator';
import { Store } from '../../src/main/store';
import { projectGuestResponse } from '../../src/relay/protocol';
import { parseGuestSnapshot } from '../../src/remote/guest-response';

test('only the authenticated suggestion owner sees a host fulfillment', () => {
  const store = new Store<ShowState>(':memory:');
  let state = createInitialState('show-00001', 'epoch-0001');
  store.save(state);
  const coordinator = new RemoteAuthorityCoordinator(store, () => DEFAULT_SETTINGS, value => { state = value; },
    undefined, undefined, undefined, () => ({ timeline: { generation: null, position: 0, duration: 0, seekable: false, seeking: false },
      preparingVersionIds: new Set() }));
  try {
    const authority = coordinator.getAuthority();
    const invitation = authority.createInvitation(60000);
    const bind = (name: string) => authority.join(invitation, randomUUID(), randomBytes(32).toString('base64url'), name, state.revision);
    const first = bind('Singer');
    const second = bind('Second Singer');
    assert.equal(authority.submitMissing(first.session, { commandId: randomUUID(), title: 'My Song', artist: 'Artist' }).ok, true);
    const request = store.missingSongReviews()[0];
    assert.deepEqual(authority.snapshot(first.session).stage?.fulfilledSuggestions, []);
    assert.equal(store.setMissingSongStatus(request.id, 'pending', 'fulfilled'), true);
    const current = authority.snapshot(first.session);
    const expected = [{ id: request.id, title: 'My Song' }];
    assert.deepEqual(current.stage?.fulfilledSuggestions, expected);
    assert.deepEqual(authority.snapshot(second.session).stage?.fulfilledSuggestions, []);
    const relay = projectGuestResponse('snapshot', 200, { ...current, stage: {
      ...current.stage, fulfilledSuggestions: [{ ...expected[0], owner: first.singerId, privateNote: 'private' }],
    } });
    assert.deepEqual(parseGuestSnapshot(relay?.body).stage?.fulfilledSuggestions, expected);
    assert.equal(parsedLegacyStage(current), undefined);
  } finally { store.close(); }
});

function parsedLegacyStage(snapshot: ReturnType<ReturnType<RemoteAuthorityCoordinator['getAuthority']>['snapshot']>) {
  return parseGuestSnapshot(projectGuestResponse('snapshot', 200, snapshot, true, false)?.body).stage;
}
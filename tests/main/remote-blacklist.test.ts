import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createInitialState, type ShowState } from '../../src/domain';
import { parseSettings } from '../../src/domain/settings';
import { RemoteAuthorityCoordinator } from '../../src/main/remote-authority-coordinator';
import { createGuestApiHandler } from '../../src/main/remote-guest-api';
import { RemoteRelayScope } from '../../src/main/remote-relay-scope';
import { Store } from '../../src/main/store';

const secret = () => randomBytes(32).toString('base64url');
async function http(authority: Parameters<typeof createGuestApiHandler>[0]) {
  const handler = createGuestApiHandler(authority), server = createServer((request, response) => { void handler(request, response); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  return { post: async (path: string, value: unknown, session: string) => {
    const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` }, body: JSON.stringify(value) });
    assert.equal(response.status, 200); return response.json();
  }, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('LAN HTTP and relay authority hide blacklisted metadata and reject stale guest requests without sticky exclusions', async () => {
  const store = new Store<ShowState>(':memory:'); let lan: Awaited<ReturnType<typeof http>> | undefined, internet: typeof lan;
  let relay: RemoteRelayScope | undefined;
  try {
    let state = createInitialState('show-00001', 'epoch-0001');
    state.versions.push({ id: 'version-first', artist: 'Nada Surf', title: 'Amateur', rating: 'clean' },
      { id: 'version-second', artist: 'NADA SURF', title: 'AMATEUR', rating: 'clean' },
      { id: 'version-other', artist: 'Other Artist', title: 'Amateur', rating: 'clean' }); store.save(state);
    const settings = parseSettings({}), originalPolicy = structuredClone(state.policy);
    const coordinator = new RemoteAuthorityCoordinator(store, () => settings, value => { state = value; });
    const queue = coordinator.getAuthority();
    const lanGuest = queue.join(queue.createInvitation(60_000), 'lan-join-0001', secret(), 'LAN Singer', state.revision);
    relay = new RemoteRelayScope(queue);
    const relayGuest = relay.authority.join(relay.createInvitation(60_000), 'relay-join-0001', secret(), 'Remote Singer', state.revision);
    lan = await http(queue); internet = await http(relay.authority);
    const before = queue.snapshot(lanGuest.session), oldRequest = { commandId: 'old-request-0001', showId: before.showId,
      hostEpoch: before.hostEpoch, expectedRevision: before.revision, versionId: 'version-first' };
    assert.equal((await lan.post('/api/v1/request', { command: oldRequest }, lanGuest.session)).ok, true);
    settings.artistBlacklist = ['Nada Surf'];
    for (const [api, guest, authority] of [[lan, lanGuest, queue], [internet, relayGuest, relay.authority]] as const) {
      const projection = await api.post('/api/v1/snapshot', {}, guest.session);
      assert.deepEqual(projection.catalog.map((version: { id: string }) => version.id), ['version-other']);
      assert.deepEqual((await api.post('/api/v1/catalog', { offset: 0, limit: 50, query: 'Nada' }, guest.session)).items, []);
      assert.deepEqual((await api.post('/api/v1/catalog', { offset: 0, limit: 50, query: 'other amateur' }, guest.session)).items.map((version: {id:string}) => version.id), ['version-other']);
      assert.deepEqual(projection.requests, []);
      if ('catalogItem' in authority) {
        assert.equal(authority.catalogItem(guest.session, 'version-first'), null);
        assert.equal(authority.catalogItem(guest.session, 'version-second'), null);
      }
      const command = { commandId: 'blocked-request-1', showId: projection.showId, hostEpoch: projection.hostEpoch,
        expectedRevision: projection.revision, versionId: 'version-second' };
      const outcome = await api.post('/api/v1/request', { command }, guest.session);
      assert.equal(outcome.ok, false); assert.equal(outcome.code, 'NOT_AVAILABLE');
      assert.doesNotMatch(JSON.stringify(outcome), /Nada|Amateur|private|token/i);
      const missing = await api.post('/api/v1/missing-request', { command: { commandId: 'blocked-missing-1', title: 'Another Song', artist: 'Nada Surf' } }, guest.session);
      assert.equal(missing.ok, false); assert.equal(missing.code, 'NOT_AVAILABLE');
    }
    assert.equal(state.requests.length, 1, 'The existing request is retained without accepting a new blocked request.');
    assert.deepEqual(store.missingSongRequests(), []); assert.deepEqual(store.load()!.policy, originalPolicy);
    // Prior acknowledgments stay immutable; retrying one never creates another request.
    assert.equal((await lan.post('/api/v1/request', { command: oldRequest }, lanGuest.session)).ok, true);
    assert.equal(state.requests.length, 1);
    settings.artistBlacklist = [];
    const unblocked = await lan.post('/api/v1/snapshot', {}, lanGuest.session);
    assert.equal(unblocked.catalog.length, 3); assert.equal(unblocked.requests.length, 1);
    assert.equal((await lan.post('/api/v1/request', { command: { commandId: 'new-unblocked-01', showId: unblocked.showId,
      hostEpoch: unblocked.hostEpoch, expectedRevision: unblocked.revision, versionId: 'version-second' } }, lanGuest.session)).ok, true);
    assert.deepEqual(store.load()!.policy, originalPolicy);
  } finally { if (lan) await lan.close(); if (internet) await internet.close(); relay?.close(); store.close(); }
});

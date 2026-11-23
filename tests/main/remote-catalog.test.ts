import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { projectGuestResponse } from '../../src/relay/protocol';
import { parseGuestCatalog, parseGuestSnapshot } from '../../src/remote/guest-response';
import { dispatchInternetGuestCallAsync } from '../../src/main/internet-queue-client';
import { RemoteCatalog, type RemoteCatalogProviders, type RemoteCatalogTrack } from '../../src/main/remote-catalog';
import { createGuestApiHandler } from '../../src/main/remote-guest-api';
import { RemoteRelayScope } from '../../src/main/remote-relay-scope';
import { Store } from '../../src/main/store';

const resumeSecret = () => randomBytes(32).toString('base64url');
const karaokeNerds: RemoteCatalogTrack = { title: 'Wonderwall', artist: 'Oasis', rating: 'unrated', discoveryOrigin: 'karaokenerds',
  source: { provider: 'youtube', videoId: 'abcdefghijk', brandSlug: 'TPV' } };
const karaFun: RemoteCatalogTrack = { title: 'Wonderwall', artist: 'Oasis', rating: 'clean',
  source: { provider: 'karafun', catalog: 'catalog', songId: '178' } };
const partyTyme: RemoteCatalogTrack = { title: 'Wonderwall', artist: 'Oasis', rating: 'unrated',
  source: { provider: 'partytyme', catalog: 'consumer', videoId: '123' } };

function fixture(lookup?: RemoteCatalogProviders['search'], withYouTube = false, pageKaraokeNerds?: RemoteCatalogProviders['pageKaraokeNerds']) {
  const store = new Store<ShowState>(':memory:'), settings = structuredClone(DEFAULT_SETTINGS);
  const initial = createInitialState('show-room', 'host-epoch');
  initial.versions.push({ id: 'local-song', title: 'Wonderwall', artist: 'Oasis', rating: 'clean' });
  store.save(initial);
  const sourceGenerations = { karaokenerds: 0, karafun: 0, partytyme: 0, youtube: 0 };
  let now = 1000;
  const remote = new RemoteCatalog({
    sources: () => (['local', 'karaokenerds', 'karafun', 'partytyme', 'youtube'] as const)
      .filter(source => settings.sourceVisibility[source] && (source !== 'youtube' || withYouTube)),
    generation: source => String(sourceGenerations[source]),
    search: lookup ?? (async source => source === 'karaokenerds' ? [karaokeNerds] : source === 'karafun' ? [karaFun] : [partyTyme]),
    pageKaraokeNerds,
  }, () => now);
  const queue = store.openRemoteQueue(() => settings, () => {}, () => now, undefined, undefined, undefined, remote);
  const join = (name: string) => queue.join(queue.createInvitation(30000), randomUUID(), resumeSecret(), name, store.load()!.revision);
  const request = (session: string, versionId: string) => {
    const { showId, hostEpoch, revision } = queue.snapshot(session);
    return { commandId: randomUUID(), showId, hostEpoch, expectedRevision: revision, versionId };
  };
  return { queue, store, settings, sourceGenerations, join, request, advance: (ms: number) => { now += ms; } };
}

test('authenticated room search returns private-library and exact public identities and rejects another guest’s selections', async () => {
  const f = fixture();
  try {
    const singer = f.join('Singer'), other = f.join('Other singer');
    const snapshot = parseGuestSnapshot(f.queue.snapshot(singer.session));
    assert.deepEqual(snapshot.sources, ['local', 'karaokenerds', 'karafun', 'partytyme']);
    assert.deepEqual(snapshot.catalog, [{ id: 'local-song', title: 'Wonderwall', artist: 'Oasis', source: 'local' }]);
    await assert.rejects(f.queue.searchCatalog('invalid', 0, 50, 'Wonderwall'));
    const search = parseGuestCatalog(await f.queue.searchCatalog(singer.session, 0, 3, 'Wonderwall'), 0, 3);
    const next = parseGuestCatalog(await f.queue.searchCatalog(singer.session, search.nextOffset!, 3, 'Wonderwall'), 3, 3);
    assert.deepEqual([...search.items, ...next.items].map(({ source, recordingId }) => ({ source, recordingId })), [
      { source: 'local', recordingId: undefined }, { source: 'karaokenerds', recordingId: 'youtube:abcdefghijk' },
      { source: 'karafun', recordingId: 'karafun:catalog:178' }, { source: 'partytyme', recordingId: 'partytyme:consumer:123' },
    ]);
    const result = search.items[1];
    assert.equal(f.queue.submit(other.session, f.request(other.session, result.id)).ok, false);
    assert.equal(f.store.load()!.versions.length, 1);
    const request = f.request(singer.session, result.id);
    const accepted = f.queue.submit(singer.session, request);
    assert.equal(accepted.ok, true);
    assert.deepEqual(f.queue.submit(singer.session, request), accepted);
    const state = f.store.load()!;
    assert.equal(state.versions.length, 2);
    assert.deepEqual(state.versions[1].source, karaokeNerds.source);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].singerId, singer.singerId);
    assert.equal(state.requests[0].versionId, state.versions[1].id);
    assert.equal(parseGuestSnapshot(f.queue.snapshot(singer.session)).requests[0].title, 'Wonderwall');
    const deduplicated = await f.queue.searchCatalog(singer.session, 0, 50, 'Wonderwall');
    assert.equal(deduplicated.items.filter(item => item.recordingId === 'youtube:abcdefghijk').length, 1);
  } finally { f.store.close(); }
});

test('account generation, host flags, show policy and singer limits are enforced at request time', async () => {
  const f = fixture();
  try {
    const singer = f.join('Singer');
    const result = async (source: 'karafun' | 'partytyme' | 'karaokenerds') =>
      (await f.queue.searchCatalog(singer.session, 0, 50, 'Wonderwall')).items.find(song => song.source === source)!;
    const staleKaraFun = await result('karafun');
    f.sourceGenerations.karafun++;
    assert.equal(f.queue.submit(singer.session, f.request(singer.session, staleKaraFun.id)).ok, false);
    const stalePartyTyme = await result('partytyme');
    f.settings.sourceVisibility.partytyme = false;
    assert.equal(f.queue.submit(singer.session, f.request(singer.session, stalePartyTyme.id)).ok, false);
    assert.equal(await result('partytyme'), undefined);
    assert.ok(!f.queue.snapshot(singer.session).sources?.includes('partytyme'));
    const staleKaraokeNerds = await result('karaokenerds');
    const state = f.store.load()!;
    f.store.save({ ...state, policy: { ...state.policy, ageRestricted: true } });
    assert.equal(f.queue.submit(singer.session, f.request(singer.session, staleKaraokeNerds.id)).ok, false);
    assert.equal(await result('karaokenerds'), undefined);
    f.settings.maxFutureRequestsPerSinger = 1;
    assert.equal(f.queue.submit(singer.session, f.request(singer.session, 'local-song')).ok, true);
    const freshKaraFun = await result('karafun');
    const rejected = f.queue.submit(singer.session, f.request(singer.session, freshKaraFun.id));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, 'LIMIT');
    assert.equal(f.store.load()!.versions.length, 1, 'a rejected request must not add a recording');
    const expiring = await result('karafun');
    f.advance(601_000);
    assert.equal(f.queue.submit(singer.session, f.request(singer.session, expiring.id)).ok, false);
  } finally { f.store.close(); }
});

test('the internet relay preserves authorized search results and provider failures stay private', async () => {
  const f = fixture(async source => {
    if (source === 'partytyme') throw new Error('private account failure');
    return [source === 'karafun' ? karaFun : karaokeNerds];
  });
  try {
    const scope = new RemoteRelayScope(f.queue), invitation = scope.createInvitation(30000);
    const guest = scope.authority.join(invitation, randomUUID(), resumeSecret(), 'Singer', 0);
    const call = { requestId: randomUUID(), operation: 'catalog', payload: { offset: 0, limit: 50, query: 'Wonderwall' }, session: guest.session };
    const response = await dispatchInternetGuestCallAsync(scope.authority, call, () => invitation);
    assert.equal(response.status, 200);
    const relayed = parseGuestCatalog(projectGuestResponse('catalog', response.status, response.body)?.body, 0, 50);
    assert.deepEqual(relayed.items.map(song => song.source), ['local', 'karaokenerds', 'karafun']);
    assert.doesNotMatch(JSON.stringify(response.body), /private account failure|brandSlug|session/);
    scope.close();
    assert.equal((await dispatchInternetGuestCallAsync(scope.authority, call, () => invitation)).status, 400);
  } finally { f.store.close(); }
});

test('the direct room HTTP handler uses external search and rejects a missing guest session', async () => {
  let providerCalls = 0;
  const f = fixture(async source => {
    providerCalls++;
    return source === 'karaokenerds' ? [karaokeNerds] : [];
  });
  const handler = createGuestApiHandler(f.queue);
  const server = createServer((req, res) => { void handler(req, res); });
  try {
    const guest = f.join('Local singer');
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const post = (session?: string) => fetch(`http://127.0.0.1:${address.port}/api/v1/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) },
      body: JSON.stringify({ offset: 0, limit: 50, query: 'Wonderwall' }),
    });
    assert.equal((await post()).status, 400);
    assert.equal(providerCalls, 0);
    const response = await post(guest.session);
    assert.equal(response.status, 200);
    const result = parseGuestCatalog(await response.json(), 0, 50);
    assert.deepEqual(result.items.map(song => song.source), ['local', 'karaokenerds']);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    f.store.close();
  }
});

test('in-flight lookup cannot restore a source after a host reconnects or disables it', async () => {
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async source => {
    if (source === 'karaokenerds') { await blocked; return [karaokeNerds]; }
    if (source === 'karafun') { await blocked; return [karaFun]; }
    return [partyTyme];
  });
  try {
    const singer = f.join('Singer');
    const search = f.queue.searchCatalog(singer.session, 0, 50, 'Wonderwall');
    f.sourceGenerations.karafun++;
    f.settings.sourceVisibility.karaokenerds = false;
    release();
    assert.deepEqual((await search).items.map(song => song.source), ['local', 'partytyme']);
  } finally { f.store.close(); }
});

test('room search uses desktop song matching to keep generic YouTube as fallback', async () => {
  const regularYouTube: RemoteCatalogTrack = { title: 'Wonderwall', artist: 'Oasis', rating: 'unrated',
    source: { provider: 'youtube', videoId: 'abcdefghijl' } };
  const reverseGuess: RemoteCatalogTrack = { title: 'Oasis', artist: 'Wonderwall', rating: 'unrated', reverseTitleGuess: true,
    source: { provider: 'youtube', videoId: 'abcdefghijm' } };
  const uniqueYouTube: RemoteCatalogTrack = { title: 'Wonderwall Live', artist: 'Oasis', rating: 'unrated',
    source: { provider: 'youtube', videoId: 'abcdefghijn' } };
  const f = fixture(async source => source === 'karaokenerds' ? [karaokeNerds] :
    source === 'youtube' ? [regularYouTube, reverseGuess, uniqueYouTube] : [], true);
  try {
    const state = f.store.load()!;
    state.versions.push({ id: 'saved-youtube', title: 'Wonderwall!', artist: 'Oasis', rating: 'unrated',
      source: { provider: 'youtube', videoId: 'abcdefghijo' } });
    f.store.save(state);
    const singer = f.join('Singer');
    const response = await f.queue.searchCatalog(singer.session, 0, 50, 'Wonderwall');
    assert.deepEqual(response.items.map(song => [song.title, song.source]), [
      ['Wonderwall', 'local'], ['Wonderwall', 'karaokenerds'], ['Wonderwall Live', 'youtube'],
    ]);
    assert.ok(f.store.load()!.versions.some(version => version.id === 'saved-youtube'), 'filtering leaves the library recording intact');
  } finally { f.store.close(); }
});

const pagedTrack = (index: number): RemoteCatalogTrack => ({
  title: `Wonderwall Version ${index}`, artist: 'Oasis', rating: 'unrated', discoveryOrigin: 'karaokenerds',
  source: { provider: 'youtube', videoId: `paged${String(index).padStart(6, '0')}` },
});

test('connected search pages every Karaoke Nerds match and suppresses late YouTube duplicates', async () => {
  const directRows = Array.from({ length: 141 }, (_unused, index) => pagedTrack(index));
  const fallback: RemoteCatalogTrack = { title: 'Wonderwall Version 140', artist: 'Oasis', rating: 'unrated', source: { provider: 'youtube', videoId: 'abcdefghijk' } };
  const unique: RemoteCatalogTrack = { ...fallback, title: 'Wonderwall Live', source: { provider: 'youtube', videoId: 'abcdefghijl' } };
  const cursors: (string | null)[] = [];
  const f = fixture(async source => source === 'youtube' ? [fallback, unique] : [],
    true, async (query, cursor) => {
      assert.equal(query, 'Wonderwall');
      cursors.push(cursor);
      const index = cursor ? Number(cursor) : 0;
      return { tracks: directRows.slice(index, index + 50), nextCursor: index + 50 < directRows.length ? String(index + 50) : null };
    });
  try {
    const show = f.store.load()!;
    // This already-queued recording should preserve its library identity
    // without consuming two spots in the combined search results.
    show.versions.push({ id: 'cached-community', ...pagedTrack(50) });
    f.store.save(show);
    const singer = f.join('Singer'), other = f.join('Other singer');
    await assert.rejects(f.queue.searchCatalog(singer.session, 1000000, 50, 'Wonderwall'));
    assert.deepEqual(cursors, []);
    const first = parseGuestCatalog(await f.queue.searchCatalog(singer.session, 0, 50, 'Wonderwall'), 0, 50);
    assert.equal(first.nextOffset, 50);
    assert.deepEqual(cursors, [null]);
    await assert.rejects(f.queue.searchCatalog(other.session, 50, 50, 'Wonderwall'));
    const second = parseGuestCatalog(await f.queue.searchCatalog(singer.session, 50, 50, 'Wonderwall'), 50, 50);
    assert.equal(second.nextOffset, 100);
    assert.deepEqual(await f.queue.searchCatalog(singer.session, 50, 50, 'Wonderwall'), second);
    assert.deepEqual(cursors, [null, '50']);
    const third = parseGuestCatalog(await f.queue.searchCatalog(singer.session, 100, 50, 'Wonderwall'), 100, 50);
    const visible = [...first.items, ...second.items, ...third.items];
    assert.equal(third.nextOffset, null);
    assert.equal(visible.filter(row => row.source === 'karaokenerds').length, 141);
    assert.equal(new Set(visible.map(row => row.recordingId ?? row.id)).size, visible.length);
    assert.deepEqual(visible.filter(row => row.source === 'youtube').map(row => row.title), ['Wonderwall Live']);
    assert.deepEqual(cursors, [null, '50', '100']);
    const late = third.items.find(row => row.title === 'Wonderwall Version 140' && row.source === 'karaokenerds')!;
    assert.equal(f.queue.submit(other.session, f.request(other.session, late.id)).ok, false);
    assert.equal(f.queue.submit(singer.session, f.request(singer.session, late.id)).ok, true);
    assert.equal(f.queue.snapshot(singer.session).requests[0].title, 'Wonderwall Version 140');
  } finally { f.store.close(); }
});

test('paging resumes after a temporary failure and rejects data after the host disables its source', async () => {
  const positions: (string | null)[] = [];
  let interrupts = 1;
  const f = fixture(async () => [], false, async (_query, cursor) => {
    positions.push(cursor);
    if (cursor === null) return { tracks: [pagedTrack(0)], nextCursor: '1' };
    if (interrupts-- > 0) throw new Error('Temporary provider failure');
    return { tracks: [pagedTrack(1), pagedTrack(2), pagedTrack(3)], nextCursor: '4' };
  });
  try {
    const singer = f.join('Singer');
    await assert.rejects(f.queue.searchCatalog(singer.session, 0, 2, 'Wonderwall'));
    const first = await f.queue.searchCatalog(singer.session, 0, 2, 'Wonderwall');
    assert.equal(first.nextOffset, 2);
    assert.deepEqual(first.items.map(row => row.title), ['Wonderwall', 'Wonderwall Version 0']);
    assert.deepEqual(positions, [null, '1', '1']);
    f.settings.sourceVisibility.karaokenerds = false;
    await assert.rejects(f.queue.searchCatalog(singer.session, 2, 2, 'Wonderwall'));
    const disabled = await f.queue.searchCatalog(singer.session, 0, 2, 'Wonderwall');
    assert.deepEqual(disabled.items.map(row => row.source), ['local']);
    assert.deepEqual(positions, [null, '1', '1']);
  } finally { f.store.close(); }
});

test('the next catalog page returns the latest revision after changes to the show', async () => {
  let calls = 0;
  const f = fixture(async () => [], false, async () => {
    calls++;
    return { tracks: [pagedTrack(0), pagedTrack(1)], nextCursor: '2' };
  });
  try {
    const singer = f.join('Singer');
    const first = await f.queue.searchCatalog(singer.session, 0, 2, 'Wonderwall');
    f.join('New singer');
    const changed = await f.queue.searchCatalog(singer.session, 2, 2, 'Wonderwall');
    assert.equal(changed.revision, first.revision + 1);
    assert.deepEqual(changed.items, []);
    assert.equal(changed.nextOffset, null);
    assert.equal(calls, 1);
  } finally { f.store.close(); }
});

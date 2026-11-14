import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings';
import type { KHostBridgeHandoff, KHostBridgeSearch, KHostBridgeSong } from '../../src/domain/khost-bridge';
import type { KHostBridgeClient, KHostBridgeProfile } from '../../src/main/khost-client';
import { KHostBridgeConnection } from '../../src/main/khost-connection';

type Client = Pick<KHostBridgeClient, 'status' | 'search' | 'handoff' | 'handoffStatus'>;
const song = (artist = 'Artist', title = 'Song'): KHostBridgeSong => ({ resultId: randomUUID(), providerSongId: '1234',
  artist, title, durationSeconds: 180, canHandoff: true });
const results = (songs: KHostBridgeSong[]): KHostBridgeSearch => ({ status: 'ready', songs, externalPlayback: true, embeddedPlayback: false });
const accepted = (requestId: string, state: 'pending' | 'complete' | 'failed' = 'pending'): KHostBridgeHandoff =>
  ({ status: 'handed-off', requestId, state, playback: 'external-khost', queueMayHaveChanged: true });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate: () => boolean) { for (let n = 0; n < 30 && !predicate(); n++) await setImmediate(); assert.ok(predicate(), 'Expected operation to reach the deferred boundary.'); }
function fixture() {
  let settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), khostBridgeConfigFile: 'C:\\private\\connection.json' };
  let policy = createInitialState('show', 'epoch').policy;
  let profile: KHostBridgeProfile = { baseUrl: 'http://127.0.0.1:4052', token: 'a'.repeat(64) };
  let readFailure = false, reads = 0;
  const songs = [song()];
  const calls = { search: [] as string[], handoff: [] as { resultId: string; requestId: string }[], poll: [] as string[], profiles: [] as KHostBridgeProfile[] };
  const behavior: Client = {
    status: async () => ({ status: 'ready', companion: 'KHost', provider: 'karafun', providerAvailable: true, externalPlayback: true, embeddedPlayback: false, acquisition: false }),
    search: async () => results(songs), handoff: async (_, requestId) => accepted(String(requestId)), handoffStatus: async id => accepted(String(id), 'complete'),
  };
  const connection = new KHostBridgeConnection(() => ({ ...settings, policy }), {
    readProfile: async () => { reads++; if (readFailure) throw Error('private path and token'); return { ...profile }; },
    createClient: value => { calls.profiles.push(value); return {
      status: () => behavior.status(),
      search: query => { calls.search.push(String(query)); return behavior.search(query); },
      handoff: (resultId, requestId) => { calls.handoff.push({ resultId: String(resultId), requestId: String(requestId) }); return behavior.handoff(resultId, requestId); },
      handoffStatus: requestId => { calls.poll.push(String(requestId)); return behavior.handoffStatus(requestId); },
    }; },
  });
  return { connection, calls, behavior, songs, get reads() { return reads; },
    settings: (value: Partial<Settings>) => { settings = { ...settings, ...value }; },
    policy: (value: Partial<typeof policy>) => { policy = { ...policy, ...value }; },
    profile: (value: Partial<KHostBridgeProfile>) => { profile = { ...profile, ...value }; },
    failReads: () => { readFailure = true; },
    send: (row = songs[0], requestId = randomUUID()) => connection.handoff({ resultId: row.resultId, requestId }),
  };
}

test('KHost companion is opt-in and restricted shows never read credentials or search', async () => {
  const f = fixture(); f.settings({ khostBridgeConfigFile: '' });
  assert.equal((await f.connection.status()).connection.status, 'not-configured');
  assert.equal((await f.connection.search('Song')).status, 'not-configured');
  f.settings({ khostBridgeConfigFile: 'C:\\private\\connection.json' }); f.policy({ ageRestricted: true });
  assert.equal((await f.connection.search('Song')).status, 'policy-blocked');
  f.policy({ ageRestricted: false, includeVersionIds: [] });
  assert.equal((await f.connection.search('Song')).status, 'policy-blocked');
  assert.equal(f.reads, 0); assert.deepEqual(f.calls.search, []);
});

test('current song and artist blacklists filter results before granting handoff authority', async () => {
  const f = fixture(), allowed = song('Allowed', 'Visible'), artist = song('Banned Artist', 'Other'), track = song('Artist', 'Banned Song');
  f.songs.splice(0, 1, allowed, artist, track);
  f.settings({ artistBlacklist: ['banned artist'], songBlacklist: [{ artist: 'Artist', title: 'Banned Song' }] });
  const response = await f.connection.search('Song'); assert.equal(response.status, 'ready');
  if (response.status === 'ready') assert.deepEqual(response.songs.map(row => row.resultId), [allowed.resultId]);
  assert.equal((await f.send(artist)).status, 'expired-result'); assert.equal((await f.send(track)).status, 'expired-result');
  assert.equal(f.calls.handoff.length, 0);
});

test('policy, blacklist and selected-profile changes block old results before any side effect', async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => f.policy({ ageRestricted: true }),
    (f: ReturnType<typeof fixture>) => f.policy({ includeVersionIds: ['some-approved-local-version'] }),
    (f: ReturnType<typeof fixture>) => f.settings({ artistBlacklist: ['Artist'] }),
    (f: ReturnType<typeof fixture>) => f.settings({ songBlacklist: [{ artist: 'Artist', title: 'Song' }] }),
    (f: ReturnType<typeof fixture>) => f.settings({ khostBridgeConfigFile: 'C:\\other\\connection.json' })]) {
    const f = fixture(); await f.connection.search('Song'); change(f);
    assert.notEqual((await f.send()).status, 'handed-off'); assert.equal(f.calls.handoff.length, 0);
  }
});

test('changed profile contents and failed owner-only reads invalidate old authorized rows', async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => f.profile({ token: 'b'.repeat(64) }), (f: ReturnType<typeof fixture>) => f.failReads()]) {
    const f = fixture(); await f.connection.search('Song'); change(f);
    assert.notEqual((await f.send()).status, 'handed-off'); assert.equal(f.calls.handoff.length, 0);
  }
});

test('profile replacement during a search discards the response and all handoff authority', async () => {
  const f = fixture(), wait = deferred<KHostBridgeSearch>(); f.behavior.search = () => wait.promise;
  const pending = f.connection.search('Song'); await until(() => f.calls.search.length === 1);
  f.profile({ token: 'b'.repeat(64) }); wait.resolve(results(f.songs));
  assert.equal((await pending).status, 'unavailable'); assert.equal((await f.send()).status, 'expired-result');
  assert.equal(f.calls.handoff.length, 0);
});

test('the latest search wins even when an older response finishes last', async () => {
  const f = fixture(), first = deferred<KHostBridgeSearch>(), second = deferred<KHostBridgeSearch>(), newer = song('New Artist', 'New Song');
  f.behavior.search = query => String(query).includes('first') ? first.promise : second.promise;
  const old = f.connection.search('first'); await until(() => f.calls.search.length === 1);
  const recent = f.connection.search('second'); await until(() => f.calls.search.length === 2);
  second.resolve(results([newer])); assert.equal((await recent).status, 'ready');
  first.resolve(results(f.songs)); assert.equal((await old).status, 'unavailable');
  assert.equal((await f.send()).status, 'expired-result'); assert.equal((await f.send(newer)).status, 'handed-off');
  assert.equal(f.calls.handoff.length, 1);
});

test('search cancellation revokes rows and a delayed result cannot reinstate them', async () => {
  const f = fixture(), wait = deferred<KHostBridgeSearch>(); f.behavior.search = () => wait.promise;
  const pending = f.connection.search('Song'); await until(() => f.calls.search.length === 1);
  f.connection.cancelSearch(); wait.resolve(results(f.songs));
  assert.equal((await pending).status, 'unavailable'); assert.equal((await f.send()).status, 'expired-result');
  assert.equal(f.calls.handoff.length, 0);
});

test('untrusted caller metadata and mutated result objects do not grant new authority', async () => {
  const f = fixture(), response = await f.connection.search('Song'); assert.equal(response.status, 'ready');
  if (response.status !== 'ready') return;
  const original = f.songs[0]; response.songs[0].title = 'Forged title'; response.songs[0].resultId = randomUUID();
  assert.equal((await f.connection.handoff({ resultId: original.resultId, requestId: randomUUID(), title: 'Forgery' })).status, 'invalid-request');
  assert.equal((await f.connection.handoff({ resultId: response.songs[0].resultId, requestId: randomUUID() })).status, 'expired-result');
  const id = randomUUID(); await f.send(original, id);
  assert.equal((await f.connection.status()).pending?.title, 'Song'); assert.equal(f.calls.handoff.length, 1);
});

test('repeating an existing handoff polls its original UUID and never posts it twice', async () => {
  const f = fixture(); await f.connection.search('Song'); const id = randomUUID();
  assert.deepEqual(await f.send(undefined, id), accepted(id));
  assert.deepEqual(await f.send(undefined, id), accepted(id, 'complete'));
  assert.deepEqual(f.calls.poll, [id]); assert.equal(f.calls.handoff.length, 1);
  assert.equal((await f.connection.handoff({ resultId: randomUUID(), requestId: id })).status, 'idempotency-conflict');
  assert.equal(f.calls.handoff.length, 1);
});

test('ambiguous results lock new requests until the host explicitly checks the external queue', async () => {
  const f = fixture(); f.behavior.handoff = async (_, id) => ({ status: 'unavailable', requestId: String(id), mayHaveBeenAccepted: true });
  await f.connection.search('Song'); const id = randomUUID(); await f.send(undefined, id);
  const blocked = await f.send(); assert.equal(blocked.status, 'busy'); assert.equal(blocked.requestId, id);
  assert.equal(f.calls.handoff.length, 1); assert.equal(f.connection.acknowledgeHandoff(randomUUID()), false);
  assert.equal(f.connection.acknowledgeHandoff(id), true);
  // An old request remains observation-only after its warning is acknowledged.
  assert.equal((await f.send(undefined, id)).status, 'handed-off'); assert.equal(f.calls.handoff.length, 1);
});

test('an in-flight side effect cannot be acknowledged or automatically retried', async () => {
  const f = fixture(), wait = deferred<KHostBridgeHandoff>(); f.behavior.handoff = () => wait.promise;
  await f.connection.search('Song'); const id = randomUUID(), pending = f.send(undefined, id);
  await until(() => f.calls.handoff.length === 1);
  assert.equal(f.connection.acknowledgeHandoff(id), false);
  assert.deepEqual(await f.send(undefined, id), { status: 'unavailable', requestId: id, mayHaveBeenAccepted: true });
  assert.equal(f.calls.poll.length, 0); assert.equal((await f.send()).status, 'busy');
  wait.resolve(accepted(id)); await pending; assert.equal(f.calls.handoff.length, 1);
});

test('policy changes during a POST preserve the original ambiguous request and allow read-only recovery', async () => {
  const f = fixture(), wait = deferred<KHostBridgeHandoff>(); f.behavior.handoff = () => wait.promise;
  await f.connection.search('Song'); const id = randomUUID(), pending = f.send(undefined, id);
  await until(() => f.calls.handoff.length === 1); f.policy({ ageRestricted: true }); wait.resolve(accepted(id));
  assert.deepEqual(await pending, { status: 'unavailable', requestId: id, mayHaveBeenAccepted: true });
  assert.equal((await f.connection.status()).pending?.requestId, id);
  assert.deepEqual(await f.connection.handoffStatus(id), accepted(id, 'complete'));
  assert.equal((await f.send()).status, 'policy-blocked'); assert.equal(f.calls.handoff.length, 1);
});

test('changed profile cannot observe the original request and does not silently unlock it', async () => {
  const f = fixture(); await f.connection.search('Song'); const id = randomUUID(); await f.send(undefined, id);
  f.profile({ token: 'c'.repeat(64) });
  assert.deepEqual(await f.connection.handoffStatus(id), { status: 'configuration-error', requestId: id, mayHaveBeenAccepted: true });
  assert.equal(f.calls.poll.length, 0); await f.connection.search('Song');
  assert.equal((await f.send()).status, 'busy'); assert.equal((await f.connection.status()).pending?.requestId, id);
  assert.equal(f.calls.handoff.length, 1);
});

test('concurrent handoff attempts reserve only one external side effect', async () => {
  const f = fixture(), wait = deferred<KHostBridgeHandoff>(); f.behavior.handoff = () => wait.promise;
  await f.connection.search('Song'); const id = randomUUID(), first = f.send(undefined, id), second = f.send();
  assert.equal((await second).status, 'busy'); assert.equal(f.calls.handoff.length, 1);
  wait.resolve(accepted(id)); await first; assert.equal(f.calls.handoff.length, 1);
});

test('overlapping observations share one GET and cannot overwrite a newer terminal outcome', async () => {
  const f = fixture(), wait = deferred<KHostBridgeHandoff>(); await f.connection.search('Song');
  const id = randomUUID(); await f.send(undefined, id); f.behavior.handoffStatus = () => wait.promise;
  const first = f.connection.handoffStatus(id), second = f.connection.handoffStatus(id);
  await until(() => f.calls.poll.length === 1); wait.resolve(accepted(id, 'complete'));
  assert.deepEqual(await first, accepted(id, 'complete')); assert.deepEqual(await second, accepted(id, 'complete'));
  assert.equal(f.calls.poll.length, 1); assert.equal((await f.connection.status()).pending, null);
});

test('obsolete profile reads cannot replace a newer installed connection', async () => {
  const first = deferred<KHostBridgeProfile>(); let reads = 0; const profiles: string[] = [];
  const f = fixture(); const connection = new KHostBridgeConnection(() => ({ ...DEFAULT_SETTINGS,
    khostBridgeConfigFile: 'C:\\private\\connection.json', policy: createInitialState('show', 'epoch').policy }), {
    readProfile: () => ++reads === 1 ? first.promise : Promise.resolve({ baseUrl: 'http://127.0.0.1:4052', token: 'b'.repeat(64) }),
    createClient: profile => { profiles.push(profile.token); return f.behavior; },
  });
  const older = connection.status(); await until(() => reads === 1);
  assert.equal((await connection.status()).connection.status, 'ready');
  first.resolve({ baseUrl: 'http://127.0.0.1:4052', token: 'a'.repeat(64) });
  assert.equal((await older).connection.status, 'unavailable'); assert.deepEqual(profiles, ['b'.repeat(64)]);
});

test('private profile failures never project raw paths or credentials', async () => {
  const f = fixture(); f.failReads();
  assert.doesNotMatch(JSON.stringify(await f.connection.status()), /private path|token|connection\.json|127\.0\.0\.1/);
  assert.equal((await f.connection.search('Song')).status, 'configuration-error');
});

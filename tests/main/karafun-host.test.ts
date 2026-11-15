import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KaraFunHost } from '../../src/main/karafun-host';
import { applyCommand, createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings';
import type { KaraFunSong } from '../../src/domain/karafun';
import { KaraFunMediaError, type KaraFunMediaCache, type KaraFunPreparedMedia } from '../../src/main/karafun-media';
import type { KaraFunSource } from '../../src/domain/streaming-source';
import type { StoredMedia } from '../../src/main/store';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(check: () => boolean): Promise<void> { for (let attempt = 0; attempt < 50; attempt++) { if (check()) return; await turn(); } assert.ok(check(), 'the expected background operation did not complete'); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const song: KaraFunSong = { catalog: 'catalog', songId: '6229', title: 'Synthetic title', artist: 'Synthetic artist', durationSeconds: 20, explicit: false };
const firstScope = 'a'.repeat(64), secondScope = 'b'.repeat(64), hash = 'c'.repeat(32);
function fixture() {
  let state: ShowState = createInitialState('show', 'epoch'), settings: Settings = structuredClone(DEFAULT_SETTINGS);
  state.singers.push({ id: 's', name: 'Synthetic singer' });
  let revision = 1, scope = firstScope, connected = true, commitError = false;
  let query: (input: string, signal: AbortSignal) => Promise<KaraFunSong[]> = async () => [song];
  let authorize: (source: KaraFunSource, signal: AbortSignal) => Promise<{ md5: string; expectedBytes: number | null }> = async () => ({ md5: hash, expectedBytes: 100 });
  let beforePublish: (call: number, signal: AbortSignal) => Promise<void> = async () => {};
  const media = new Map<string, StoredMedia>(), calls: { source: KaraFunSource; scope: string; signal: AbortSignal }[] = [];
  const disk = new Map<string, KaraFunPreparedMedia>(), hydrations: { source: KaraFunSource; scope: string }[] = [];
  let commits = 0, authorizations = 0;
  const account = {
    status: () => ({ state: connected ? 'connected' as const : 'disconnected' as const, revision, persistence: 'memory-only' as const }),
    revision: () => revision, accountScope: () => connected ? scope : null,
    search: (value: string, signal: AbortSignal) => query(value, signal),
    requestMedia: async (source: KaraFunSource, signal: AbortSignal) => {
      authorizations++; if (!connected || signal.aborted) throw new Error('The KaraFun account is unavailable.');
      const descriptor = await authorize(source, signal);
      return { ...descriptor, url: 'https://media.karafun.com/private-placeholder', revision, accountScope: scope };
    },
  };
  const cache = { prepare: async (source: KaraFunSource, accountScope: string, getDescriptor: (signal: AbortSignal) => Promise<{ md5: string; expectedBytes: number | null }>, options: { signal: AbortSignal; existingOnly?: boolean; progress(value: unknown): void }) => {
    options.progress({ phase: 'authorizing', received: 0, total: null });
    const descriptor = await getDescriptor(options.signal);
    if (options.signal.aborted) throw new Error('Preparation was cancelled.');
    const diskKey = `${accountScope}:${source.catalog}:${source.songId}:${descriptor.md5}`;
    if (options.existingOnly) {
      hydrations.push({ source: { ...source }, scope: accountScope });
      const retained = disk.get(diskKey);
      if (!retained || retained.bytes !== descriptor.expectedBytes) throw new KaraFunMediaError('cache-miss', 'No verified cached recording is available.');
      options.progress({ phase: 'ready', received: retained.bytes, total: retained.bytes });
      return retained;
    }
    const call = calls.push({ source: { ...source }, scope: accountScope, signal: options.signal });
    await beforePublish(call, options.signal);
    if (options.signal.aborted) throw new Error('Preparation was cancelled.');
    options.progress({ phase: 'ready', received: 100, total: 100 });
    const prepared = { source: { ...source }, accountScope, path: `/private/${accountScope}/${source.catalog}-${source.songId}.kit`, fingerprint: 'd'.repeat(64), md5: descriptor.md5, bytes: descriptor.expectedBytes || 100, kit: { timing: { durationSeconds: 20 }, stems: [] } } as unknown as KaraFunPreparedMedia;
    disk.set(diskKey, prepared); return prepared;
  } } as unknown as KaraFunMediaCache;
  const host = new KaraFunHost(account as never, cache, {
    state: () => state, settings: () => settings, media: id => media.get(id), changed: () => {},
    commit: (next, updates = []) => { if (commitError) throw new Error('Durable save failed.'); commits++; state = next; for (const update of updates) media.set(update.id, update); },
  });
  const request = async (requestId = 'r') => {
    const result = await host.search('Synthetic'); assert.equal(result.status, 'ok'); assert.ok(result.searchId);
    return host.request({ searchId: result.searchId, songId: song.songId, catalog: song.catalog, singerId: 's', requestId });
  };
  return { host, account, calls, media, hydrations, request, state: () => state, settings: () => settings,
    commits: () => commits, authorizations: () => authorizations,
    setSearch: (value: typeof query) => { query = value; }, setAuthorize: (value: typeof authorize) => { authorize = value; },
    setGate: (value: typeof beforePublish) => { beforePublish = value; }, setCommitError: (value: boolean) => { commitError = value; },
    accept: (requestId: string) => {
      const result = applyCommand(state, { commandId: `accept-${requestId}`, showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision,
        actor: { id: 'host', role: 'host' }, command: { type: 'accept', requestId } }, settings, Date.now());
      assert.equal(result.outcome.ok, true); state = result.state; host.sync();
    },
    changeAccount: (value: boolean, valueScope = scope) => { connected = value; scope = valueScope; revision++; host.accountChanged(); },
  };
}

test('native host commits an ordinary request and background preparation without staging, autoplay, or provider secrets', async t => {
  const f = fixture(); t.after(() => f.host.shutdown());
  const queued = await f.request(); assert.equal(queued.ok, true); assert.ok(queued.versionId);
  await until(() => f.media.has(queued.versionId!));
  assert.equal(f.state().requests.length, 1); assert.equal(f.state().requests[0].status, 'accepted');
  assert.equal(f.state().stagedRequestId, null); assert.equal(f.state().playback, null);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].scope, firstScope);
  assert.deepEqual(f.state().versions[0].source, { provider: 'karafun', catalog: 'catalog', songId: '6229' });
  assert.equal(JSON.stringify(f.state()).includes('private-placeholder'), false);
  assert.equal(JSON.stringify(f.host.status()).includes(firstScope), false);
  const prepared = await f.host.authorizeStart(queued.versionId!); assert.equal(prepared.accountScope, firstScope);
  assert.equal(f.authorizations(), 2, 'starting obtains a fresh descriptor even after a verified download');
  assert.equal(f.state().playback, null, 'authorization itself never starts a performance');
});
test('native receipts reject forged metadata, stale searches, expiry and account changes', async t => {
  const f = fixture(); t.after(() => f.host.shutdown());
  const first = await f.host.search('Synthetic'); assert.ok(first.searchId);
  const value = { searchId: first.searchId, songId: song.songId, catalog: song.catalog, singerId: 's', requestId: 'r' };
  assert.equal(f.host.request({ ...value, title: 'Forged' }).ok, false);
  assert.equal(f.host.request({ ...value, songId: '9999' }).ok, false);
  assert.equal(f.host.request({ ...value, catalog: 'community' }).ok, false);
  await f.host.search('Another'); assert.equal(f.host.request(value).ok, false);
  const fresh = await f.host.search('Synthetic');
  const now = Date.now; try { Date.now = () => now() + 600_001; assert.equal(f.host.request({ ...value, searchId: fresh.searchId }).ok, false); } finally { Date.now = now; }
  f.changeAccount(true, secondScope); assert.equal(f.host.request({ ...value, searchId: fresh.searchId }).ok, false);
  assert.equal(f.state().versions.length, 0); assert.equal(f.commits(), 0); assert.equal(f.calls.length, 0);
});
test('refused queue requests and durable commit failures leave no orphan versions or downloads', async t => {
  const f = fixture(); t.after(() => f.host.shutdown());
  const result = await f.host.search('Synthetic');
  const bad = f.host.request({ searchId: result.searchId, songId: song.songId, catalog: song.catalog, singerId: 'missing', requestId: 'r' });
  assert.equal(bad.ok, false); assert.equal(f.state().versions.length, 0); assert.equal(f.calls.length, 0);
  f.setCommitError(true); assert.throws(() => f.host.request({ searchId: result.searchId, songId: song.songId, catalog: song.catalog, singerId: 's', requestId: 'r' }), /Durable save failed/);
  assert.equal(f.state().versions.length, 0); assert.equal(f.calls.length, 0);
});
test('search applies current policy after network completion and abandons superseded or signed-out work', async t => {
  const f = fixture(); t.after(() => f.host.shutdown());
  let gate = deferred(); f.setSearch(async () => { await gate.promise; return [song]; });
  const stalePolicy = f.host.search('Synthetic'); f.settings().artistBlacklist = [song.artist]; gate.resolve();
  assert.deepEqual((await stalePolicy).songs, [], 'newly blacklisted artists must not appear in results');
  f.settings().artistBlacklist = [];
  gate = deferred(); const obsolete = f.host.search('Synthetic'); const newer = f.host.search('Another'); gate.resolve();
  assert.equal((await obsolete).status, 'unavailable'); assert.equal((await newer).status, 'ok');
  gate = deferred(); const pending = f.host.search('Synthetic'); f.changeAccount(false); gate.resolve();
  assert.notEqual((await pending).status, 'ok'); assert.deepEqual(f.host.status(), []);
});
test('sign-out cancels preparation and makes both cached media and earlier search receipts unusable', async t => {
  const f = fixture(); t.after(() => f.host.shutdown());
  f.setGate(async (_call, signal) => { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); });
  const queued = await f.request(); await until(() => f.calls.length === 1);
  f.changeAccount(false); await until(() => f.calls[0].signal.aborted); await turn();
  assert.equal(f.media.size, 0); assert.deepEqual(f.host.status(), []);
  await assert.rejects(f.host.authorizeStart(queued.versionId!), /Sign in/);
  assert.equal(f.state().requests[0].status, 'accepted'); assert.equal(f.state().playback, null);
});
test('an account switch retries a previously running preparation under only the new account', async t => {
  const f = fixture(); t.after(() => f.host.shutdown());
  f.setGate(async (call, signal) => { if (call === 1) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); });
  const queued = await f.request(); await until(() => f.calls.length === 1);
  f.changeAccount(true, secondScope);
  await until(() => f.calls.length === 2 && f.media.has(queued.versionId!));
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.calls[1].scope, secondScope);
  const prepared = await f.host.authorizeStart(queued.versionId!); assert.equal(prepared.accountScope, secondScope);
});
test('source or policy changes during preparation cannot publish stale media or authorize it', async t => {
  const f = fixture(); t.after(() => f.host.shutdown()); const gate = deferred(); f.setGate(async () => gate.promise);
  const queued = await f.request(); await until(() => f.calls.length === 1);
  f.state().versions[0].source = { provider: 'karafun', catalog: 'catalog', songId: '7777' }; gate.resolve();
  await until(() => f.host.status().some(item => item.phase === 'failed'));
  assert.equal(f.media.size, 0); assert.equal(f.commits(), 1);
  f.settings().artistBlacklist = [song.artist]; await assert.rejects(f.host.authorizeStart(queued.versionId!), /Sign in/);
});
test('a cached KIT cannot bypass a fresh entitlement refusal and changed recordings trigger preparation rather than playback', async t => {
  const f = fixture(); t.after(() => f.host.shutdown());
  const queued = await f.request(); await until(() => f.media.has(queued.versionId!));
  f.setAuthorize(async () => { throw new Error('Subscription unavailable.'); });
  await assert.rejects(f.host.authorizeStart(queued.versionId!), /Subscription unavailable/);
  f.setAuthorize(async () => ({ md5: 'e'.repeat(32), expectedBytes: 200 }));
  await assert.rejects(f.host.authorizeStart(queued.versionId!), /recording changed/);
  await until(() => f.calls.length === 2 && f.media.get(queued.versionId!)?.path !== undefined && f.host.status().some(item => item.phase === 'ready'));
  assert.equal((await f.host.authorizeStart(queued.versionId!)).md5, 'e'.repeat(32));
  assert.equal(f.state().playback, null);
});
test('failed durable preparation publication cannot leave a start-authorized ready entry', async t => {
  const f = fixture(); t.after(() => f.host.shutdown()); const gate = deferred(); f.setGate(async () => gate.promise);
  const queued = await f.request(); await until(() => f.calls.length === 1);
  f.setCommitError(true); gate.resolve(); await until(() => f.host.status().some(item => item.phase === 'failed'));
  assert.equal(f.media.size, 0);
  await assert.rejects(f.host.authorizeStart(queued.versionId!), /Durable save failed/);
  assert.equal(f.media.size, 0, 'a verified disk file still requires the durable media commit before it can start');
  f.setCommitError(false); const recovered = await f.host.authorizeStart(queued.versionId!);
  assert.equal(f.media.get(queued.versionId!)?.path, recovered.path); assert.equal(f.calls.length, 1, 'the successful retry hydrates the verified disk file without a second download');
  assert.equal(f.state().playback, null);
});
test('relinking a prepared library entry cannot authorize mismatched memory from its previous media mapping', async t => {
  const f = fixture(); t.after(() => f.host.shutdown());
  const queued = await f.request(); await until(() => f.media.has(queued.versionId!));
  f.media.set(queued.versionId!, { id: queued.versionId!, path: '/changed/foreign.kit', fingerprint: '9'.repeat(64) });
  const authorized = await f.host.authorizeStart(queued.versionId!);
  assert.equal(f.hydrations.length, 1, 'the mismatched mapping must pass through fresh cache authorization/verification');
  assert.notEqual(authorized.path, '/changed/foreign.kit'); assert.equal(f.media.get(queued.versionId!)?.path, authorized.path);
  assert.equal(f.calls.length, 1, 'verified current-account bytes can repair the mapping without another download');
  assert.equal(f.state().playback, null);
});
test('canonical clean classifications survive native request planning under a restricted show', async t => {
  const f = fixture(); t.after(() => f.host.shutdown()); f.state().policy.ageRestricted = true;
  const queued = await f.request(); assert.equal(queued.ok, true); assert.equal(f.state().versions[0].rating, 'clean');
  await until(() => f.media.has(queued.versionId!));
  f.setSearch(async () => [{ ...song, songId: '7777', explicit: null }, { ...song, songId: '8888', explicit: true }]);
  assert.deepEqual((await f.host.search('Synthetic')).songs, [], 'unclassified and explicit tracks stay hidden under the restricted policy');
});
test('manual moderation defers native acquisition until acceptance and future-request limits retain existing entries', async t => {
  const f = fixture(); t.after(() => f.host.shutdown()); f.settings().autoApprove = false; f.settings().maxFutureRequestsPerSinger = 1;
  const queued = await f.request(); assert.equal(queued.ok, true); assert.equal(f.state().requests[0].status, 'pending');
  await turn(); assert.equal(f.calls.length, 0);
  const tooMany = await f.request('extra'); assert.equal(tooMany.ok, false); assert.equal(f.state().versions.length, 1); assert.equal(f.state().requests.length, 1);
  f.accept('r'); await until(() => f.media.has(queued.versionId!)); assert.equal(f.calls.length, 1); assert.equal(f.state().playback, null); assert.equal(f.state().stagedRequestId, null);
});
test('an evicted queued KIT hydrates from verified current-account disk after fresh authorization in one start attempt', async t => {
  const f = fixture(); t.after(() => f.host.shutdown()); const versionIds: string[] = [];
  for (const [index, songId] of ['6229', '7777', '8888'].entries()) {
    f.setSearch(async () => [{ ...song, songId }]);
    const result = await f.host.search('Synthetic');
    const queued = f.host.request({ searchId: result.searchId, songId, catalog: 'catalog', singerId: 's', requestId: `r${index}` });
    assert.equal(queued.ok, true); versionIds.push(queued.versionId!); await until(() => f.media.has(queued.versionId!));
  }
  assert.equal(f.calls.length, 3); assert.equal(f.authorizations(), 3);
  const prepared = await f.host.authorizeStart(versionIds[0]);
  assert.equal(prepared.source.songId, '6229'); assert.equal(f.hydrations.length, 1); assert.equal(f.calls.length, 3);
  assert.equal(f.authorizations(), 4, 'RAM eviction never bypasses current authorization');
  assert.equal(f.media.get(versionIds[0])?.path, prepared.path); assert.equal(f.state().playback, null);
});

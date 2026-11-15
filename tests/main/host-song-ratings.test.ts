import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../../src/main/store';
import { HostSongRatings } from '../../src/main/host-song-ratings';
import { migrateShowSchema, inspectShowSchema, SHOW_SCHEMA_VERSION } from '../../src/main/schema-migrations';
import { createInitialState, type ShowState } from '../../src/domain';
const fingerprint = 'a'.repeat(64), local = `sha256:${fingerprint}` as const, global = 'youtube:Abcdefghijk' as const;
const empty = { recordingKey: local, average: null, count: 0, ownVote: null };
const makeStore = (filename = ':memory:') => {
  const store = new Store<{ revision: number }>(filename);
  store.save({ revision: 7 }, [{ id: 'local-one', path: '/private/one.mp4', fingerprint }]);
  return store;
};

test('local ratings persist, replace and clear without touching shared credentials or network', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tpv-local-ratings-'))), file = join(directory, 'show.sqlite');
  let store = makeStore(file);
  let remote = 0;
  const shared = () => { remote++; throw new Error('No remote configuration is available.'); };
  try {
    let host = new HostSongRatings(store, shared);
    assert.deepEqual(await host.lookup([local]), { status: 'ready', items: [empty], canVote: true,
      canVoteByKey: { [local]: true }, storageByKey: { [local]: 'local' } });
    assert.deepEqual(await host.vote(local, 8), { status: 'ready', item: { ...empty, average: 8, count: 1, ownVote: 8 }, canVote: true, storage: 'local' });
    store.close(); store = new Store(file); host = new HostSongRatings(store, shared);
    const restored = await host.lookup([local]); assert.equal(restored.status, 'ready');
    if (restored.status === 'ready') assert.equal(restored.items[0].ownVote, 8);
    assert.equal((await host.vote(local, 10)).status, 'ready');
    assert.deepEqual(store.localSongRatings([local]), [{ ...empty, average: 10, count: 1, ownVote: 10 }]);
    assert.equal((await host.vote(local, null)).status, 'ready');
    assert.deepEqual(store.localSongRatings([local]), [empty]);
    assert.equal(remote, 0);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('local identity follows exact file contents through relinking, metadata edits and identical copies', () => {
  const store = makeStore();
  try {
    store.rateLocalSong(local, 9);
    assert.equal(store.relinkMedia(store.media('local-one')!, '/other/location.mp4'), true);
    store.save({ revision: 8 }, [{ id: 'identical-copy', path: '/copy.mp4', fingerprint }]);
    assert.deepEqual(store.localSongRatings([local]), [{ ...empty, average: 9, count: 1, ownVote: 9 }]);
    assert.equal(store.load()?.revision, 8);
    assert.throws(() => store.rateLocalSong(`sha256:${'b'.repeat(64)}`, 7), /unavailable/);
    assert.throws(() => store.rateLocalSong(global as never, 7), /Choose a local/);
    for (const score of [0, 11, 4.5, NaN, '8']) assert.throws(() => store.rateLocalSong(local, score as never), /Choose a local/);
    assert.equal(store.localSongRatings([local])[0].ownVote, 9);
  } finally { store.close(); }
});

test('mixed results keep per-key capabilities and send only provider IDs to the authenticated shared client', async () => {
  const store = makeStore(); let sharedLookups = 0, sharedVotes = 0;
  const globalRating = { recordingKey: global, average: 8, count: 4, ownVote: null };
  const host = new HostSongRatings(store, () => ({
    lookup: async keys => { sharedLookups++; assert.deepEqual(keys, [global]); return { status: 'ready', items: [globalRating], canVote: false }; },
    vote: async (key, value) => { sharedVotes++; assert.equal(key, global); assert.equal(value, 7); return { status: 'configuration-required' }; },
  }));
  try {
    const mixed = await host.lookup([local, global]);
    assert.equal(mixed.status, 'ready');
    if (mixed.status === 'ready') {
      assert.deepEqual(mixed.items, [empty, globalRating]); assert.equal(mixed.canVote, false);
      assert.deepEqual(mixed.canVoteByKey, { [local]: true, [global]: false });
      assert.deepEqual(mixed.storageByKey, { [local]: 'local', [global]: 'global' });
    }
    assert.deepEqual(await host.vote(global, 7), { status: 'configuration-required' });
    assert.deepEqual(store.localSongRatings([local]), [empty]);
    assert.equal(sharedLookups, 1); assert.equal(sharedVotes, 1);
  } finally { store.close(); }
});

test('shared failure leaves local ratings available and never saves an unconfirmed global vote locally', async () => {
  const store = makeStore(); store.rateLocalSong(local, 6);
  const host = new HostSongRatings(store, () => ({ lookup: async () => ({ status: 'unauthorized' }), vote: async () => ({ status: 'timed-out' }) }));
  try {
    const mixed = await host.lookup([global, local]);
    assert.equal(mixed.status, 'ready');
    if (mixed.status === 'ready') {
      assert.equal(mixed.globalStatus, 'unauthorized'); assert.equal(mixed.items.length, 1);
      assert.equal(mixed.items[0].recordingKey, local); assert.equal(mixed.items[0].ownVote, 6);
      assert.equal(mixed.canVoteByKey[local], true); assert.equal(mixed.canVoteByKey[global], false);
    }
    assert.deepEqual(await host.lookup([global]), { status: 'unauthorized' });
    assert.deepEqual(await host.vote(global, 4), { status: 'timed-out' });
    assert.equal(store.localSongRatings([local])[0].ownVote, 6);
  } finally { store.close(); }
});

test('successful provider votes remain exact provider keys and are explicitly confirmed as global', async () => {
  const store = makeStore();
  const host = new HostSongRatings(store, () => ({
    lookup: async keys => ({ status: 'ready', items: keys.map(recordingKey => ({ recordingKey, average: 4, count: 1, ownVote: 4 })), canVote: true }),
    vote: async (recordingKey, value) => ({ status: 'ready', item: { recordingKey, average: value, count: value === null ? 0 : 1, ownVote: value }, canVote: true }),
  }));
  try {
    const result = await host.vote(global, 4);
    assert.deepEqual(result, { status: 'ready', item: { recordingKey: global, average: 4, count: 1, ownVote: 4 }, canVote: true, storage: 'global' });
    assert.equal((await host.lookup([local, global])).status, 'ready');
    assert.deepEqual(store.localSongRatings([local]), [empty]);
  } finally { store.close(); }
});

test('KaraFun ratings route exact catalog/community identities globally before any media import', async () => {
  const catalog='karafun:catalog:6229' as const, community='karafun:community:6229' as const;
  const store=makeStore(); let sharedVotes=0;
  const host=new HostSongRatings(store,()=>({
    lookup:async keys=>{assert.deepEqual(keys,[catalog,community]);return{status:'ready',items:keys.map(recordingKey=>({recordingKey,average:null,count:0,ownVote:null})),canVote:true};},
    vote:async(recordingKey,value)=>{sharedVotes++;assert.equal(recordingKey,catalog);return{status:'ready',item:{recordingKey,average:value,count:value===null?0:1,ownVote:value},canVote:true};},
  }));
  try {
    const result=await host.lookup([catalog,local,community]);assert.equal(result.status,'ready');
    if(result.status==='ready'){
      assert.deepEqual(result.storageByKey,{[local]:'local',[catalog]:'global',[community]:'global'});
      assert.equal(result.canVoteByKey[catalog],true);assert.equal(result.canVoteByKey[community],true);
    }
    assert.deepEqual(await host.vote(catalog,9),{status:'ready',item:{recordingKey:catalog,average:9,count:1,ownVote:9},canVote:true,storage:'global'});
    assert.equal(sharedVotes,1);assert.deepEqual(store.localSongRatings([local]),[empty]);
  }finally{store.close();}
});

test('invalid batches, votes and unknown local hashes are refused without a shared request', async () => {
  const store = makeStore(); let called = 0;
  const host = new HostSongRatings(store, () => { called++; throw new Error(); });
  try {
    for (const value of [null, ['file:/private/song.mp4'], [local, local], Array(101).fill(global)])
      assert.deepEqual(await host.lookup(value), { status: 'invalid-request' });
    for (const value of [0, 11, '8', NaN]) assert.deepEqual(await host.vote(local, value), { status: 'invalid-request' });
    assert.deepEqual(await host.vote('untrusted:identity', 8), { status: 'invalid-request' });
    assert.deepEqual(await host.vote(`sha256:${'b'.repeat(64)}`, 8), { status: 'unavailable' });
    assert.equal(called, 0); assert.deepEqual(store.localSongRatings([local]), [empty]);
  } finally { store.close(); }
});

test('version2 shows upgrade atomically and local rating data is validated during backup inspection', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    db.exec("INSERT INTO show_state VALUES (1, '{\"revision\":7}'); DROP TABLE local_song_ratings; PRAGMA user_version = 2;");
    inspectShowSchema(db); migrateShowSchema(db);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SHOW_SCHEMA_VERSION);
    assert.equal((db.prepare('SELECT value FROM show_state').get() as { value: string }).value, '{"revision":7}');
    db.prepare('INSERT INTO local_song_ratings VALUES (?, ?, ?)').run(fingerprint, 8, '2026-11-14T00:00:00.000Z');
    inspectShowSchema(db);
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare('UPDATE local_song_ratings SET value = 11').run();
    assert.throws(() => inspectShowSchema(db), /invalid local song rating/);
    assert.throws(() => migrateShowSchema(db), /invalid local song rating/);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SHOW_SCHEMA_VERSION);
  } finally { db.close(); }
});

test('new local votes participate in normal show snapshots and survive reopen without network', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tpv-local-rating-backup-')));
  const file = join(directory, 'show.sqlite'), backup = join(directory, 'backup.sqlite');
  const store = new Store<ShowState>(file);
  try {
    const state = createInitialState('rating-backup-show', 'rating-backup-epoch'); state.revision = 7;
    state.versions.push({ id: 'local-one', title: 'Local Song', artist: 'Local Artist', rating: 'unrated' });
    store.save(state, [{ id: 'local-one', path: '/private/one.mp4', fingerprint }]);
    store.rateLocalSong(local, 7); await store.backup(backup);
    const restored = new Store<ShowState>(backup);
    try { assert.equal(restored.localSongRatings([local])[0].ownVote, 7); assert.deepEqual(restored.load(), state); }
    finally { restored.close(); }
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('an empty legacy ratings table with text score affinity cannot be adopted as a numeric schema', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    db.exec(`INSERT INTO show_state VALUES (1, '{}'); DROP TABLE local_song_ratings; PRAGMA user_version = 2;
      CREATE TABLE local_song_ratings (fingerprint TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    assert.throws(() => migrateShowSchema(db), /column types are incompatible/);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    assert.equal((db.prepare('SELECT type FROM pragma_table_info(\'local_song_ratings\') WHERE name = \'value\'').get() as { type: string }).type, 'TEXT');
  } finally { db.close(); }
});

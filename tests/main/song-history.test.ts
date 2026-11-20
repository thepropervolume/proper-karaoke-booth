import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { Store } from '../../src/main/store';
import { migrateShowSchema, SHOW_SCHEMA_VERSION } from '../../src/main/schema-migrations';

const song = { id: 'recording', artist: 'Nada Surf', title: 'Popular', rating: 'unrated' } as const;

test('queue history is durable across shows, compares recordings by song, and conservatively handles unknown artists', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-song-history-'));
  const filename = join(directory, 'show.sqlite');
  try {
    let store = new Store<ShowState>(filename);
    const first = createInitialState('first', 'epoch');
    first.versions.push(song);
    store.save(first);
    assert.equal(store.songSeenBefore(song), false);
    first.requests.push({ id: 'r1', singerId: null, versionId: song.id, status: 'accepted', round: 1, order: 1 });
    store.save(first);
    assert.equal(store.songSeenBefore({ artist: 'nada   surf', title: 'POPULAR' }), true);
    assert.equal(store.songSeenBefore({ artist: '', title: 'Unknown' }), true);
    store.close();

    store = new Store<ShowState>(filename);
    const next = createInitialState('next-show', 'next-epoch');
    next.versions.push({ ...song, id: 'different-recording' });
    store.save(next);
    assert.equal(store.songSeenBefore(next.versions[0]), true);
    assert.equal(store.songSeenBefore({ artist: 'Nada Surf', title: 'Amateur' }), false);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('correcting queued metadata records the corrected identity without losing the original', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-song-history-edit-'));
  const filename = join(directory, 'show.sqlite');
  try {
    let store = new Store<ShowState>(filename);
    const original = createInitialState('show', 'epoch');
    original.versions.push({ ...song });
    original.requests.push({ id: 'r1', singerId: null, versionId: song.id, status: 'accepted', round: 1, order: 1 });
    store.save(original);
    const corrected = structuredClone(original);
    corrected.versions[0].title = 'Amateur';
    assert.equal(store.songSeenBefore(corrected.versions[0]), false);
    store.save(corrected);
    assert.equal(store.songSeenBefore(corrected.versions[0]), true);
    assert.equal(store.songSeenBefore(song), true);
    store.close();

    store = new Store<ShowState>(filename);
    store.save(createInitialState('next-show', 'next-epoch'));
    assert.equal(store.songSeenBefore(corrected.versions[0]), true);
    assert.equal(store.songSeenBefore(song), true);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the schema upgrade seeds saved queue and performance history in its transaction', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    db.exec('DROP TABLE song_queue_history; PRAGMA user_version = 6;');
    const saved = createInitialState('show', 'epoch');
    saved.versions.push(song);
    saved.requests.push({ id: 'queued', singerId: null, versionId: song.id, status: 'accepted', round: 1, order: 1 });
    db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(saved));
    db.prepare('INSERT INTO performance_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('gen', null, '', 'old', 'Everlong', 'Foo Fighters', 'completed', '2026-01-01');
    const original = db.exec.bind(db);
    let interrupted = true;
    db.exec = (sql: string) => {
      if (interrupted && sql.includes(`PRAGMA user_version = ${SHOW_SCHEMA_VERSION}`)) { interrupted = false; throw new Error('interrupted'); }
      return original(sql);
    };
    assert.throws(() => migrateShowSchema(db), /interrupted/);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 6);
    assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='song_queue_history'").get(), undefined);
    migrateShowSchema(db);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SHOW_SCHEMA_VERSION);
    assert.equal((db.prepare('SELECT count(*) AS n FROM song_queue_history').get() as { n: number }).n, 2);
  } finally { db.close(); }
});

test('failed queue persistence rolls back the show and the corresponding history together', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-song-history-rollback-'));
  const filename = join(directory, 'show.sqlite');
  try {
    const store = new Store<ShowState>(filename);
    const before = createInitialState('show', 'epoch');
    before.versions.push(song);
    store.save(before);
    const fault = new DatabaseSync(filename);
    fault.exec("CREATE TRIGGER refuse_queue_history BEFORE INSERT ON song_queue_history BEGIN SELECT RAISE(ABORT, 'fault'); END;");
    const after = structuredClone(before);
    after.requests.push({ id: 'queued', singerId: null, versionId: song.id, status: 'accepted', round: 1, order: 1 });
    assert.throws(() => store.save(after), /fault/);
    assert.deepEqual(store.load(), before);
    assert.equal(store.songSeenBefore(song), false);
    fault.close();
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

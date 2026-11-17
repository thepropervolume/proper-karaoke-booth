import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrateShowSchema, SHOW_SCHEMA_VERSION } from '../../src/main/schema-migrations';
import { Store } from '../../src/main/store';

const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const names = (db: DatabaseSync) => (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);

test('schema 5 format upgrade preserves show and media bytes and rolls back an interrupted marker',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    migrateShowSchema(db);db.exec('PRAGMA user_version=5');const show='{"saved":"unchanged"}';db.prepare('INSERT INTO show_state VALUES (1,?)').run(show);db.prepare('INSERT INTO media VALUES (?,?,?)').run('song','private-path','fingerprint');
    const original=db.exec.bind(db);let interrupted=true;
    db.exec=(sql:string)=>{if(interrupted&&/PRAGMA user_version = 6/.test(sql)){interrupted=false;throw Error('Simulated interrupted marker');}return original(sql);};
    assert.throws(()=>migrateShowSchema(db),/interrupted/);assert.equal(version(db),5);
    assert.equal((db.prepare('SELECT value FROM show_state').get() as {value:string}).value,show);
    migrateShowSchema(db);assert.equal(version(db),6);assert.equal((db.prepare('SELECT path FROM media').get() as {path:string}).path,'private-path');
  }finally{db.close();}
});

test('schema 3 upgrades its format marker while preserving local ratings, media and show bytes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    db.prepare('INSERT INTO show_state VALUES (1, ?)').run('{"revision":9}');
    db.prepare('INSERT INTO media VALUES (?, ?, ?)').run('v1', '/private/original.mp4', 'a'.repeat(64));
    db.prepare('INSERT INTO local_song_ratings VALUES (?, ?, ?)').run('b'.repeat(64), 7, '2026-11-14T00:00:00Z');
    db.exec(`DROP TABLE performance_history;
      CREATE TABLE performance_history (generation_id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, singer TEXT NOT NULL,
        version_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, outcome TEXT NOT NULL, performed_at TEXT NOT NULL);`);
    db.exec('PRAGMA user_version = 3');
    const tables = names(db);
    migrateShowSchema(db);
    assert.equal(version(db), SHOW_SCHEMA_VERSION);
    assert.deepEqual(names(db), tables);
    assert.equal((db.prepare('SELECT value FROM show_state').get() as {value:string}).value, '{"revision":9}');
    assert.equal((db.prepare('SELECT path FROM media').get() as {path:string}).path, '/private/original.mp4');
    assert.equal((db.prepare('SELECT value FROM local_song_ratings').get() as {value:number}).value, 7);
  } finally { db.close(); }
});

test('new and existing unversioned shows migrate without losing show, media or playlist rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-schema-')), file = join(dir, 'show.sqlite');
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE media (id TEXT PRIMARY KEY, path TEXT NOT NULL, fingerprint TEXT NOT NULL);
      CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, singer_id TEXT);
      INSERT INTO show_state VALUES (1, '{"revision":7}');
      INSERT INTO media VALUES ('v1', '/private/source.mp4', 'hash');
      INSERT INTO playlists VALUES ('p1', 'Favorites', 's1');`);
    legacy.close();
    let store = new Store<{ revision: number }>(file);
    assert.deepEqual(store.load(), { revision: 7 }); assert.equal(store.media('v1')?.path, '/private/source.mp4');
    assert.ok(store.collections.snapshot().playlists.some(item => item.id === 'p1'));
    store.close();
    const verify = new DatabaseSync(file, { readOnly: true });
    assert.equal(version(verify), SHOW_SCHEMA_VERSION); verify.close();
    store = new Store(file); assert.deepEqual(store.load(), { revision: 7 }); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed migration rolls back every schema change and can be retried', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO show_state VALUES (1, '{"revision":7}');
      CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, singer_id TEXT);
      CREATE TRIGGER fail_migration BEFORE INSERT ON playlists BEGIN SELECT RAISE(ABORT, 'fault'); END;`);
    const before = names(db);
    assert.throws(() => migrateShowSchema(db));
    assert.equal(version(db), 0); assert.deepEqual(names(db), before);
    assert.equal((db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string }).value, '{"revision":7}');
    db.exec('DROP TRIGGER fail_migration'); migrateShowSchema(db);
    assert.equal(version(db), SHOW_SCHEMA_VERSION); assert.ok(names(db).includes('media'));
  } finally { db.close(); }
});

test('future, unrelated and incompatible databases are rejected before modification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-future-schema-'));
  try {
    const future = join(dir, 'future.sqlite'), db = new DatabaseSync(future);
    db.exec('CREATE TABLE sentinel (id INTEGER); INSERT INTO sentinel VALUES (42); PRAGMA user_version = 999;');
    const journal = (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode; db.close();
    assert.throws(() => new Store(future), /newer or unsupported/);
    const inspect = new DatabaseSync(future, { readOnly: true });
    assert.equal(version(inspect), 999); assert.deepEqual(names(inspect), ['sentinel']);
    assert.equal((inspect.prepare('SELECT id FROM sentinel').get() as { id: number }).id, 42);
    assert.equal((inspect.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, journal); inspect.close();
    const unrelated = new DatabaseSync(':memory:'); unrelated.exec('CREATE TABLE other (id INTEGER)');
    assert.throws(() => migrateShowSchema(unrelated), /not a recognizable/); assert.equal(version(unrelated), 0); unrelated.close();
    const incompatible = new DatabaseSync(':memory:'); incompatible.exec('CREATE TABLE show_state (id INTEGER)');
    assert.throws(() => migrateShowSchema(incompatible), /incompatible/); assert.equal(version(incompatible), 0); incompatible.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid state and a missing versioned table do not get silently repaired', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO show_state VALUES (1, '{broken');");
    assert.throws(() => migrateShowSchema(db), /invalid/); assert.equal(version(db), 0);
    db.exec("UPDATE show_state SET value = '{}' WHERE id = 1"); migrateShowSchema(db);
    db.exec('DROP TABLE media');
    assert.throws(() => migrateShowSchema(db), /missing/); assert.equal(version(db), SHOW_SCHEMA_VERSION);
  } finally { db.close(); }
});

test('a same-named view and incompatible primary key stop migration before version stamping', () => {
  const view = new DatabaseSync(':memory:');
  try {
    view.exec("CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO show_state VALUES (1, '{}'); CREATE VIEW media AS SELECT 'fake' AS id;");
    assert.throws(() => migrateShowSchema(view), /missing/);
    assert.equal(version(view), 0); assert.deepEqual(names(view), ['show_state']);
    assert.equal((view.prepare("SELECT type FROM sqlite_schema WHERE name = 'media'").get() as { type: string }).type, 'view');
  } finally { view.close(); }
  const badKey = new DatabaseSync(':memory:');
  try {
    badKey.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE media (id TEXT, path TEXT NOT NULL, fingerprint TEXT NOT NULL);');
    assert.throws(() => migrateShowSchema(badKey), /incompatible/); assert.equal(version(badKey), 0);
    assert.deepEqual(names(badKey), ['media', 'show_state']);
  } finally { badKey.close(); }
});

test('missing show state with orphaned application data is rejected rather than treated as a new show', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE media (id TEXT PRIMARY KEY, path TEXT NOT NULL, fingerprint TEXT NOT NULL);
      INSERT INTO media VALUES ('v1', '/private/song.mp4', 'hash');`);
    assert.throws(() => migrateShowSchema(db), /state is missing/);
    assert.equal(version(db), 0); assert.deepEqual(names(db), ['media', 'show_state']);
    assert.equal((db.prepare('SELECT path FROM media').get() as { path: string }).path, '/private/song.mp4');
  } finally { db.close(); }
});

test('legacy guest uniqueness and extra required columns are checked before stamping', () => {
  const guests = new DatabaseSync(':memory:');
  try {
    guests.exec(`CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE remote_guests (id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, show_id TEXT NOT NULL, resume_hash TEXT NOT NULL,
        resume_expires INTEGER NOT NULL, join_id TEXT NOT NULL, join_name TEXT NOT NULL, join_revision INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);`);
    assert.throws(() => migrateShowSchema(guests), /uniqueness/); assert.equal(version(guests), 0);
  } finally { guests.close(); }
  const extra = new DatabaseSync(':memory:');
  try {
    extra.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE media (id TEXT PRIMARY KEY, path TEXT NOT NULL, fingerprint TEXT NOT NULL, required_extra TEXT NOT NULL);');
    assert.throws(() => migrateShowSchema(extra), /incompatible/); assert.equal(version(extra), 0);
  } finally { extra.close(); }
  const customUnique = new DatabaseSync(':memory:');
  try {
    customUnique.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE media (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL);');
    assert.throws(() => migrateShowSchema(customUnique), /unique constraint/); assert.equal(version(customUnique), 0);
  } finally { customUnique.close(); }
});

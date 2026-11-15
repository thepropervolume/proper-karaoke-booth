import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createInitialState } from '../../src/domain';
import { inspectShowSchema, migrateShowSchema, SHOW_SCHEMA_VERSION } from '../../src/main/schema-migrations';
import { createShowSnapshot, restoreShowSnapshotToNewFile } from '../../src/main/show-snapshots';
import { Store } from '../../src/main/store';

function makeVersionOne(path: string) {
  const db = new DatabaseSync(path);
  try {
  migrateShowSchema(db);
  db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(createInitialState('show-00001', 'epoch-0001')));
  db.exec(`INSERT INTO missing_song_requests VALUES ('host', 'Alice', 'Song A', 'Artist A', '2026-01-01');
    INSERT INTO missing_song_requests VALUES ('guest', 'Bob', 'Song B', 'Artist B', '2026-01-02');
    INSERT INTO remote_missing_song_owners VALUES ('guest', 'guest-id', 'singer-id', 'show-id');
    DROP TABLE missing_song_request_reviews;
    DROP TABLE performance_history;
    CREATE TABLE performance_history (generation_id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, singer TEXT NOT NULL,
      version_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, outcome TEXT NOT NULL, performed_at TEXT NOT NULL);
    PRAGMA user_version=1;`);
  return db;
  } catch (error) { db.close(); throw error; }
}
test('version-1 host and remote requests migrate intact and review status persists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-review-')), path = join(dir, 'show.sqlite');
  let old: DatabaseSync | undefined, store: Store<unknown> | undefined, db: DatabaseSync | undefined;
  try {
    old = makeVersionOne(path); inspectShowSchema(old); old.close(); old = undefined;
    store = new Store(path);
    assert.deepEqual(store.missingSongReviews().map(r => [r.id, r.status, r.updatedAt]), [['guest', 'pending', null], ['host', 'pending', null]]);
    assert.equal(store.setMissingSongStatus('guest', 'pending', 'reviewing'), true);
    assert.equal(store.setMissingSongStatus('guest', 'pending', 'fulfilled'), false);
    assert.equal(store.setMissingSongStatus('missing', 'pending', 'fulfilled'), false);
    assert.throws(() => store!.setMissingSongStatus('host', 'pending', 'bad' as never), /Invalid/);
    store.close(); store = undefined; store = new Store(path);
    assert.equal(store.missingSongReviews().find(r => r.id === 'guest')?.status, 'reviewing');
    assert.ok(store.missingSongReviews().find(r => r.id === 'guest')?.updatedAt);
    assert.equal(store.missingSongRequests().length, 2); store.close(); store = undefined;
    db = new DatabaseSync(path, { readOnly: true });
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SHOW_SCHEMA_VERSION);
    assert.deepEqual({ ...db.prepare('SELECT * FROM remote_missing_song_owners').get() }, { request_id: 'guest', guest_id: 'guest-id', singer_id: 'singer-id', show_id: 'show-id' });
  } finally { old?.close(); store?.close(); db?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('version-1 backup remains restorable and upgrades when opened', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-review-backup-'));
  let old: DatabaseSync | undefined, store: Store<unknown> | undefined;
  try {
    old = makeVersionOne(join(dir, 'old.sqlite'));
    await createShowSnapshot(old, join(dir, 'backup.sqlite')); old.close(); old = undefined;
    await restoreShowSnapshotToNewFile(join(dir, 'backup.sqlite'), join(dir, 'restored.sqlite'));
    store = new Store(join(dir, 'restored.sqlite'));
    assert.equal(store.missingSongReviews().length, 2);
  } finally { old?.close(); store?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('incompatible version-1 review-table collision rolls back migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-review-collision-'));
  let db: DatabaseSync | undefined;
  try {
    db = makeVersionOne(join(dir, 'show.sqlite'));
    db.exec("CREATE VIEW missing_song_request_reviews AS SELECT 'fake' AS request_id");
    assert.throws(() => migrateShowSchema(db!), /missing/);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM missing_song_requests').get() as { n: number }).n, 2);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('invalid or orphaned preexisting review rows prevent migration and backup inspection without deleting data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-review-invalid-'));
  let db: DatabaseSync | undefined;
  try {
    db = makeVersionOne(join(dir, 'show.sqlite'));
    db.exec("CREATE TABLE missing_song_request_reviews (request_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO missing_song_request_reviews VALUES ('host', 'wrong', 'now');");
    assert.throws(() => migrateShowSchema(db!), /invalid missing-song review/);
    assert.throws(() => inspectShowSchema(db!), /invalid missing-song review/);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
    db.exec("UPDATE missing_song_request_reviews SET status='pending', request_id='unknown'");
    assert.throws(() => migrateShowSchema(db!), /orphaned/);
    assert.throws(() => inspectShowSchema(db!), /orphaned/);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM missing_song_request_reviews').get() as { n: number }).n, 1);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

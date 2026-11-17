import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInitialState, type ShowState } from '../../src/domain';
import { Store } from '../../src/main/store';
import { migrateShowSchema, inspectShowSchema, SHOW_SCHEMA_VERSION } from '../../src/main/schema-migrations';
import { inspectShowSnapshot, restoreShowSnapshotToNewFile } from '../../src/main/show-snapshots';
import { historyCsv } from '../../src/main/history-export';

const oldHistory = `CREATE TABLE performance_history (generation_id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, singer TEXT NOT NULL,
  version_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, outcome TEXT NOT NULL, performed_at TEXT NOT NULL);`;
function state(singerId: string | null) {
  const value = createInitialState('show', 'epoch');
  if (singerId) value.singers.push({ id: singerId, name: 'Alice' });
  value.versions.push({ id: 'v', title: 'Song', artist: 'Artist', rating: 'clean' });
  value.requests.push({ id: 'r', singerId, versionId: 'v', status: 'staged', round: 1, order: 1 });
  value.stagedRequestId = 'r'; value.nextOrder = 2;
  return value;
}
function legacy(db: DatabaseSync) {
  migrateShowSchema(db);
  db.exec('DROP TABLE performance_history'); db.exec(oldHistory); db.exec('PRAGMA user_version = 4');
  db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(state('a')));
  db.prepare('INSERT INTO performance_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('old-g', 'a', 'Alice', 'v', 'Song', 'Artist', 'completed', '2026-11-14');
}
const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const nullable = (db: DatabaseSync) => (db.prepare('PRAGMA table_info(performance_history)').all() as { name: string; notnull: number }[]).find(row => row.name === 'singer_id')!.notnull === 0;

test('schema 4 history migrates to the current schema without changing assigned show/history bytes or explicit indexes/triggers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    legacy(db);
    db.exec(`CREATE INDEX history_singer ON performance_history(singer_id);
      CREATE TRIGGER history_observer AFTER INSERT ON performance_history BEGIN SELECT 1; END;`);
    const before = db.prepare('SELECT * FROM performance_history').all(), show = db.prepare('SELECT value FROM show_state').get();
    migrateShowSchema(db);
    assert.equal(version(db), SHOW_SCHEMA_VERSION); assert.equal(nullable(db), true);
    assert.deepEqual(db.prepare('SELECT * FROM performance_history').all(), before);
    assert.deepEqual(db.prepare('SELECT value FROM show_state').get(), show);
    assert.deepEqual((db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('history_singer','history_observer') ORDER BY name").all() as { name: string }[]).map(row => row.name), ['history_observer', 'history_singer']);
    inspectShowSchema(db); inspectShowSnapshot(db);
  } finally { db.close(); }
});

test('an interrupted history-table rebuild rolls back data, old constraints and schema marker before retry', () => {
  const db = new DatabaseSync(':memory:');
  try {
    legacy(db); const before = db.prepare('SELECT * FROM performance_history').all();
    const exec = db.exec.bind(db);
    db.exec = (sql: string) => { if (sql.startsWith('ALTER TABLE performance_history_v5')) throw Error('Injected interruption after old table drop'); return exec(sql); };
    assert.throws(() => migrateShowSchema(db), /Injected interruption/);
    db.exec = exec;
    assert.equal(version(db), 4); assert.equal(nullable(db), false);
    assert.deepEqual(db.prepare('SELECT * FROM performance_history').all(), before);
    assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='performance_history_v5'").get(), undefined);
    migrateShowSchema(db); assert.equal(version(db), SHOW_SCHEMA_VERSION); assert.equal(nullable(db), true);
  } finally { db.close(); }
});

test('backup validation accepts true null ownership only with the schema-5 format marker', () => {
  const db = new DatabaseSync(':memory:');
  try {
    legacy(db);
    db.prepare('UPDATE show_state SET value=? WHERE id=1').run(JSON.stringify(state(null)));
    assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/);
    migrateShowSchema(db); assert.equal(inspectShowSnapshot(db).requests, 1);
    const malformed = state(null); (malformed.requests[0] as { singerId: unknown }).singerId = undefined;
    db.prepare('UPDATE show_state SET value=? WHERE id=1').run(JSON.stringify(malformed));
    assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/);
  } finally { db.close(); }
});

test('unassigned queue/history survives database restart, backup, restore and CSV without a fake singer', async () => {
  const parent = realpathSync(tmpdir()), directory = mkdtempSync(join(parent, 'tpv-unassigned-persistence-'));
  let store: Store<ShowState> | undefined;
  try {
    const file = join(directory, 'live.sqlite'), backup = join(directory, 'backup.sqlite'), restored = join(directory, 'restored.sqlite');
    store = new Store<ShowState>(file);
    const history = { generationId: 'unassigned-g', singerId: null, singer: '', versionId: 'v', title: 'Song', artist: 'Artist', outcome: 'completed' as const, at: '2026-11-15' };
    store.save(state(null), [], history); await store.backup(backup); store.close(); store = undefined;
    await restoreShowSnapshotToNewFile(backup, restored);
    store = new Store<ShowState>(restored);
    assert.equal(store.load()!.requests[0].singerId, null); assert.equal(store.load()!.stagedRequestId, 'r');
    assert.deepEqual(store.load()!.singers, []); assert.deepEqual(store.collections.snapshot().history, [history]);
    assert.ok(historyCsv(store.collections.snapshot().history).includes('"2026-11-15","","Artist","Song","completed"'));
  } finally {
    store?.close(); const resolved = realpathSync(directory);
    assert.equal(dirname(resolved), parent); assert.ok(basename(resolved).startsWith('tpv-unassigned-persistence-'));
    rmSync(resolved, { recursive: true, force: true });
  }
});

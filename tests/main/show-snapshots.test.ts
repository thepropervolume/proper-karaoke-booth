import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrateShowSchema } from '../../src/main/schema-migrations';
import { createShowSnapshot, restoreShowSnapshotToNewFile, SnapshotCleanupError } from '../../src/main/show-snapshots';
import { Store } from '../../src/main/store';
import { createInitialState } from '../../src/domain';

test('a live WAL-backed show can be backed up and restored to a separate database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-backup-')), live = join(dir, 'live.sqlite'), snapshot = join(dir, 'backup.sqlite'), restored = join(dir, 'restored.sqlite');
  const db = new DatabaseSync(live);
  try {
    migrateShowSchema(db); db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
    const state = createInitialState('show-00001', 'epoch-0001'); state.revision = 4;
    state.singers.push({ id: 's1', name: 'Alice' });
    state.versions.push({ id: 'v1', title: 'Song', artist: 'Artist', rating: 'clean' });
    state.requests.push({ id: 'r1', singerId: 's1', versionId: 'v1', status: 'playing', round: 1, order: 1 });
    state.requests.push({ id: 'r2', singerId: 's1', versionId: 'v1', status: 'rejected', round: null, order: null },
      { id: 'r3', singerId: 's1', versionId: 'v1', status: 'withdrawn', round: 2, order: 2 });
    state.playback = { requestId: 'r1', generationId: 'g1', status: 'playing' }; state.usedGenerationIds.push('g1');
    db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    db.exec(`INSERT INTO media VALUES ('v1', '/private/song.mp4', 'hash');
      INSERT INTO missing_song_requests VALUES ('m1', 'Alice', 'Song', 'Artist', '2026-01-01');`);
    assert.equal(existsSync(`${live}-wal`), true);
    await createShowSnapshot(db, snapshot);
    state.revision = 5; db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    await restoreShowSnapshotToNewFile(snapshot, restored);
    const copy = new Store<typeof state>(restored);
    try {
      assert.equal(copy.load()?.revision, 4); assert.equal(copy.media('v1')?.path, '/private/song.mp4');
      assert.equal(copy.load()?.playback?.generationId, 'g1'); assert.equal(copy.load()?.requests[0].status, 'playing');
      assert.deepEqual(copy.load()?.requests.map(request => request.status), ['playing', 'rejected', 'withdrawn']);
      assert.equal(copy.missingSongRequests()[0].singer, 'Alice');
    } finally { copy.close(); }
    assert.equal(JSON.parse((db.prepare('SELECT value FROM show_state').get() as { value: string }).value).revision, 5);
    assert.ok(!readdirSync(dir).some(name => name.startsWith('.tpv-snapshot-')));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('existing files and stale SQLite sidecars are never overwritten during backup or restore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-backup-existing-')), db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db); db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(createInitialState('show-00001', 'epoch-0001')));
    const snapshot = join(dir, 'backup.sqlite'); await createShowSnapshot(db, snapshot);
    const destination = join(dir, 'occupied.sqlite'); writeFileSync(destination, 'keep');
    await assert.rejects(createShowSnapshot(db, destination), /already exists/);
    await assert.rejects(restoreShowSnapshotToNewFile(snapshot, destination), /already exists/);
    assert.equal(readFileSync(destination, 'utf8'), 'keep');
    const other = join(dir, 'other.sqlite'); writeFileSync(`${other}-wal`, 'keep-sidecar');
    await assert.rejects(restoreShowSnapshotToNewFile(snapshot, other), /sidecar/);
    assert.equal(existsSync(other), false); assert.equal(readFileSync(`${other}-wal`, 'utf8'), 'keep-sidecar');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a failure before publication leaves no destination or temporary database and preserves the source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-backup-interrupt-')), db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db); const state = createInitialState('show-00001', 'epoch-0001'); state.revision = 4;
    db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    const destination = join(dir, 'backup.sqlite');
    await assert.rejects(createShowSnapshot(db, destination, { beforePublish: () => { throw new Error('simulated interruption'); } }), /interruption/);
    assert.equal(existsSync(destination), false); assert.deepEqual(readdirSync(dir), []);
    assert.equal(JSON.parse((db.prepare('SELECT value FROM show_state').get() as { value: string }).value).revision, 4);
    await createShowSnapshot(db, destination); assert.equal(existsSync(destination), true);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('an interrupted restore leaves the original backup intact and can be retried', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-restore-interrupt-')), db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db); const state = createInitialState('show-00001', 'epoch-0001'); state.revision = 7;
    db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    const snapshot = join(dir, 'backup.sqlite'), restored = join(dir, 'restored.sqlite'); await createShowSnapshot(db, snapshot);
    await assert.rejects(restoreShowSnapshotToNewFile(snapshot, restored, { beforePublish: () => { throw new Error('simulated interruption'); } }), /interruption/);
    assert.equal(existsSync(restored), false); assert.equal(existsSync(snapshot), true);
    assert.ok(!readdirSync(dir).some(name => name.startsWith('.tpv-snapshot-')));
    await restoreShowSnapshotToNewFile(snapshot, restored);
    const copy = new Store<{ revision: number }>(restored); try { assert.equal(copy.load()?.revision, 7); } finally { copy.close(); }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('cleanup failure reports whether the snapshot was published and offers a retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-backup-cleanup-')), db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db); db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(createInitialState('show-00001', 'epoch-0001')));
    const snapshot = join(dir, 'backup.sqlite'); let recovery: SnapshotCleanupError | undefined;
    try { await createShowSnapshot(db, snapshot, { beforeCleanup: () => { throw new Error('cleanup fault'); } }); assert.fail('Expected cleanup error'); }
    catch (error) { assert.ok(error instanceof SnapshotCleanupError); recovery = error; }
    assert.equal(recovery!.published, true); assert.equal(existsSync(snapshot), true);
    await recovery!.retryCleanup(); await recovery!.retryCleanup();
    assert.deepEqual(readdirSync(dir), ['backup.sqlite']);
    const restored = join(dir, 'restored.sqlite'); await restoreShowSnapshotToNewFile(snapshot, restored);
    assert.equal(existsSync(restored), true);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('corrupt and unsupported backups are rejected without creating a restored file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-backup-invalid-'));
  try {
    const corrupt = join(dir, 'corrupt.sqlite'), restored = join(dir, 'restored.sqlite'); writeFileSync(corrupt, 'not a database');
    await assert.rejects(restoreShowSnapshotToNewFile(corrupt, restored)); assert.equal(existsSync(restored), false);
    const future = join(dir, 'future.sqlite'), db = new DatabaseSync(future); db.exec('PRAGMA user_version=999'); db.close();
    await assert.rejects(restoreShowSnapshotToNewFile(future, restored), /unsupported/); assert.equal(existsSync(restored), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('well-formed SQLite files with incomplete or internally inconsistent show state are rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-backup-state-')), file = join(dir, 'invalid.sqlite'), target = join(dir, 'restored.sqlite');
  try {
    const db = new DatabaseSync(file); migrateShowSchema(db);
    for (const state of [null, {}, { revision: 1 }]) {
      db.prepare('INSERT OR REPLACE INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
      await assert.rejects(createShowSnapshot(db, target), /incomplete or incompatible/); assert.equal(existsSync(target), false);
    }
    const bad = createInitialState('show-00001', 'epoch-0001');
    bad.requests.push({ id: 'r1', singerId: 'missing-singer', versionId: 'missing-version', status: 'accepted', round: 1, order: 1 });
    db.prepare('INSERT OR REPLACE INTO show_state VALUES (1, ?)').run(JSON.stringify(bad)); db.close();
    await assert.rejects(restoreShowSnapshotToNewFile(file, target), /incomplete or incompatible/); assert.equal(existsSync(target), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

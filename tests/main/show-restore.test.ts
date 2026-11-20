import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { SHOW_SCHEMA_VERSION } from '../../src/main/schema-migrations';
import { InvalidShowBackupError, prepareShowRestore } from '../../src/main/show-restore';
import { Store } from '../../src/main/store';

function readShow(path: string): { version: number; state: ShowState } {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const value = (db.prepare('SELECT value FROM show_state WHERE id=1').get() as { value: string }).value;
    return { version, state: JSON.parse(value) };
  } finally { db.close(); }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-restore-test-'));
  const profile = join(directory, 'profile');
  await mkdir(profile);
  const live = join(profile, 'show.sqlite');
  const store = new Store<ShowState>(live);
  const current = createInitialState('current-show', 'host-current');
  current.revision = 9;
  store.save(current);
  const older = createInitialState('backup-show', 'host-old');
  older.revision = 4;
  older.singers.push({ id: 'saved-singer', name: 'Restored Singer' });
  const backup = join(directory, 'backup.sqlite');
  const legacy = new DatabaseSync(backup);
  legacy.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);');
  legacy.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(older));
  legacy.close();
  let closed = false;
  const close = () => { if (!closed) { closed = true; store.close(); } };
  return { backup, profile, live, older, current, store, close, cleanup: async () => { close(); await rm(directory, { recursive: true, force: true }); } };
}

test('previews an older backup, preserves later committed edits, and replaces the database only after close', async () => {
  const f = await fixture();
  try {
    const original = await readFile(f.backup);
    const prepared = await prepareShowRestore(f.backup, f.profile);
    assert.deepEqual(prepared.summary, { revision: 4, singers: 1, songs: 0, requests: 0 });
    assert.deepEqual(f.store.load(), f.current, 'review is read-only for the active show');
    const latest = { ...f.current, revision: 10 };
    f.store.save(latest);
    let undo!: string;
    await prepared.install(async path => {
      undo = path;
      const protecting = f.store.backupBeforeRestore(path);
      assert.throws(() => f.store.save({ ...latest, revision: 11 }), /restarting/);
      await protecting;
    }, f.close);
    await prepared.discard();
    assert.deepEqual(readShow(f.live), { version: SHOW_SCHEMA_VERSION, state: f.older });
    assert.deepEqual(readShow(undo), { version: SHOW_SCHEMA_VERSION, state: latest });
    assert.deepEqual(await readFile(f.backup), original);
    assert.deepEqual((await readdir(f.profile)).sort(), ['show-restore-backups', 'show.sqlite']);
  } finally { await f.cleanup(); }
});

test('cancellation discards only the private candidate and leaves the current show open', async () => {
  const f = await fixture();
  try {
    const prepared = await prepareShowRestore(f.backup, f.profile);
    await prepared.discard();
    assert.deepEqual(f.store.load(), f.current);
    assert.equal((await readdir(f.profile)).some(name => name.startsWith('.tpv-restore-')), false);
  } finally { await f.cleanup(); }
});

test('unsafe schemas, invalid data, copied WAL headers, and sidecars cannot reach confirmation', async () => {
  const f = await fixture();
  try {
    const trigger = join(f.profile, 'trigger-backup.sqlite');
    await copyFile(f.backup, trigger);
    const db = new DatabaseSync(trigger);
    db.exec('CREATE TRIGGER unsafe AFTER UPDATE ON show_state BEGIN DELETE FROM show_state; END;');
    db.close();
    await assert.rejects(prepareShowRestore(trigger, f.profile), InvalidShowBackupError);
    const walMode = join(f.profile, 'wal-backup.sqlite');
    await copyFile(f.backup, walMode);
    const wal = new DatabaseSync(walMode);
    wal.exec('PRAGMA journal_mode = WAL;');
    wal.close();
    await assert.rejects(prepareShowRestore(walMode, f.profile), InvalidShowBackupError);
    await writeFile(`${f.backup}-wal`, 'sidecar');
    await assert.rejects(prepareShowRestore(f.backup, f.profile), InvalidShowBackupError);
    await writeFile(trigger, 'garbage');
    await assert.rejects(prepareShowRestore(trigger, f.profile), InvalidShowBackupError);
    await assert.rejects(prepareShowRestore(f.live, f.profile), InvalidShowBackupError);
    assert.equal((await readdir(f.profile)).some(name => name.startsWith('.tpv-restore-')), false);
    assert.deepEqual(f.store.load(), f.current);
  } finally { await f.cleanup(); }
});

test('failure to protect the current show stops the swap before closing the writer', async () => {
  const f = await fixture();
  try {
    const candidate = await prepareShowRestore(f.backup, f.profile);
    await assert.rejects(candidate.install(async () => { throw new Error('backup interrupted'); }, () => assert.fail('Store must remain open')), /backup interrupted/);
    await candidate.discard();
    assert.deepEqual(f.store.load(), f.current);
  } finally { await f.cleanup(); }
});

test('unexpected database sidecars after closing block replacement and leave a checked rollback', async () => {
  const f = await fixture();
  try {
    const candidate = await prepareShowRestore(f.backup, f.profile);
    const sidecar = `${f.live}-wal`;
    let undo!: string;
    await assert.rejects(candidate.install(async path => { undo = path; await f.store.backup(path); }, () => {
      f.close();
      writeFileSync(sidecar, 'simulated external WAL');
    }), /exists/);
    await candidate.discard();
    assert.equal(await readFile(sidecar, 'utf8'), 'simulated external WAL');
    await unlink(sidecar);
    assert.deepEqual(readShow(f.live).state, f.current);
    assert.deepEqual(readShow(undo).state, f.current);
  } finally { await f.cleanup(); }
});

test('the staged bytes must match the backup the host reviewed', async () => {
  const f = await fixture();
  try {
    const candidate = await prepareShowRestore(f.backup, f.profile);
    const workName = (await readdir(f.profile)).find(name => name.startsWith('.tpv-restore-'))!;
    const staged = new DatabaseSync(join(f.profile, workName, 'show.sqlite'));
    staged.prepare('UPDATE show_state SET value=? WHERE id=1').run(JSON.stringify(f.current));
    staged.close();
    await assert.rejects(candidate.install(async () => assert.fail('No write is allowed'), () => assert.fail('Store stays open')), /changed/);
    await candidate.discard();
    assert.deepEqual(f.store.load(), f.current);
  } finally { await f.cleanup(); }
});

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { SINGER_ON_HOLD } from '../../src/domain/singer-availability';
import { SHOW_SCHEMA_VERSION } from '../../src/main/schema-migrations';
import { inspectShowSnapshot } from '../../src/main/show-snapshots';
import { Store } from '../../src/main/store';

function olderDatabase(filename: string): DatabaseSync {
  const store = new Store<ShowState>(filename);
  store.save(createInitialState('show-1', 'host-1'));
  store.close();
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; DROP TABLE song_queue_history; PRAGMA user_version = 6;');
  // Keep this connection open so the update is still in the WAL when the new host opens.
  const latest = { ...createInitialState('show-1', 'host-1'), revision: 42 };
  db.prepare('UPDATE show_state SET value = ?').run(JSON.stringify(latest));
  return db;
}

test('host upgrade preserves committed WAL data in a checked snapshot of the old schema', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-show-upgrade-'));
  const filename = join(directory, 'show.sqlite');
  const older = olderDatabase(filename);
  let store: Store<ShowState> | undefined;
  try {
    store = await Store.openForHost(filename);
    assert.equal(store.load()?.revision, 42);
    assert.equal(Object.values(older.prepare('PRAGMA user_version').get()!)[0], SHOW_SCHEMA_VERSION);
    const backups = join(directory, 'show-upgrade-backups');
    const names = readdirSync(backups);
    assert.equal(names.length, 1);
    assert.ok(names[0].startsWith(`show-v6-before-v${SHOW_SCHEMA_VERSION}-`));
    const snapshot = new DatabaseSync(join(backups, names[0]), { readOnly: true });
    try {
      assert.equal(inspectShowSnapshot(snapshot).revision, 42);
      assert.equal(Object.values(snapshot.prepare('PRAGMA user_version').get()!)[0], 6);
    } finally { snapshot.close(); }
    store.close(); store = await Store.openForHost(filename);
    assert.deepEqual(readdirSync(backups), names);
  } finally { store?.close(); older.close(); rmSync(directory, { force: true, recursive: true }); }
});

test('backup failure leaves the old database and its show revision untouched', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-show-upgrade-fail-'));
  const filename = join(directory, 'show.sqlite');
  const older = olderDatabase(filename);
  try {
    writeFileSync(join(directory, 'show-upgrade-backups'), 'already in use');
    await assert.rejects(Store.openForHost(filename), /backup could not be saved and verified/);
    assert.equal(Object.values(older.prepare('PRAGMA user_version').get()!)[0], 6);
    assert.match(String(older.prepare('SELECT value FROM show_state').get()?.value), /"revision":42/);
  } finally { older.close(); rmSync(directory, { force: true, recursive: true }); }
});

test('host opening a fresh database avoids creating an upgrade backup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-show-fresh-'));
  try {
    const store = await Store.openForHost(join(directory, 'show.sqlite'));
    try {
      assert.equal(store.load(), undefined);
      assert.ok(!readdirSync(directory).includes('show-upgrade-backups'));
    } finally { store.close(); }
  } finally { rmSync(directory, { force: true, recursive: true }); }
});

test('an unversioned legacy show can be backed up before the baseline migration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-show-legacy-'));
  const filename = join(directory, 'show.sqlite');
  try {
    const old = new DatabaseSync(filename);
    try {
      old.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      old.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(createInitialState('legacy-show', 'legacy-host')));
    } finally { old.close(); }
    const store = await Store.openForHost(filename);
    try { assert.equal(store.load()?.showId, 'legacy-show'); }
    finally { store.close(); }
    const directoryPath = join(directory, 'show-upgrade-backups');
    const [name] = readdirSync(directoryPath);
    assert.ok(name.startsWith(`show-v0-before-v${SHOW_SCHEMA_VERSION}-`));
    const snapshot = new DatabaseSync(join(directoryPath, name), { readOnly: true });
    try {
      assert.equal(inspectShowSnapshot(snapshot).revision, 0);
      assert.equal(Object.values(snapshot.prepare('PRAGMA user_version').get()!)[0], 0);
    } finally { snapshot.close(); }
  } finally { rmSync(directory, { force: true, recursive: true }); }
});

test('schema 7 upgrades with a checked rollback copy and the current show preserves a held singer on disk', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-show-hold-upgrade-'));
  const filename = join(directory, 'show.sqlite');
  const original = createInitialState('show', 'host');
  original.singers = [{ id: 'singer', name: 'Singer', unavailableUntilMs: 120000 }];
  let store: Store<ShowState> | undefined;
  try {
    store = new Store<ShowState>(filename);
    store.save(original);
    store.close(); store = undefined;
    const earlier = new DatabaseSync(filename);
    try { earlier.exec('PRAGMA user_version = 7;'); } finally { earlier.close(); }
    store = await Store.openForHost(filename);
    assert.deepEqual(store.load(), original);
    const [name] = readdirSync(join(directory, 'show-upgrade-backups'));
    assert.ok(name.startsWith(`show-v7-before-v${SHOW_SCHEMA_VERSION}-`));
    const previous = new DatabaseSync(join(directory, 'show-upgrade-backups', name), { readOnly: true });
    try {
      assert.equal(previous.prepare('PRAGMA user_version').get()?.user_version, 7);
      assert.equal(inspectShowSnapshot(previous).singers, 1);
      assert.deepEqual(JSON.parse(String(previous.prepare('SELECT value FROM show_state WHERE id=1').get()?.value)), original);
    } finally { previous.close(); }
    store.save({ ...original, singers: [{ ...original.singers[0], unavailableUntilMs: SINGER_ON_HOLD }] });
    store.close(); store = undefined;
    store = await Store.openForHost(filename);
    assert.equal(store.load()?.singers[0].unavailableUntilMs, SINGER_ON_HOLD);
  } finally { store?.close(); rmSync(directory, { force: true, recursive: true }); }
});

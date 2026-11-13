import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CommunityCatalogStore } from '../../src/catalog/karaokenerds';

const DAY = 24 * 60 * 60 * 1000;
const catalog = { Items: [{ Id: 0, Artist: 'Example Artist', Title: 'Example Track', Brand: 'EX', Watch: 'https://youtu.be/00000000000', Created: null }] };

test('retirement persists, blocks refresh, and rollback imposes a new cooldown', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-sqlite-retire-')); const file = path.join(dir, 'catalog.sqlite');
  let store = new CommunityCatalogStore(file); let calls = 0;
  try {
    store.seed(catalog, DAY);
    assert.equal(store.sqliteRefreshStatus().state, 'available');
    assert.throws(() => store.retireSQLiteRefresh(false, DAY + 1), /Stop all old updaters/);
    const retired = store.retireSQLiteRefresh(true, DAY + 1);
    assert.deepEqual(retired, { state: 'retired', retiredAt: DAY + 1, lastAttempt: DAY + 1, nextAttempt: 2 * DAY + 1, attemptOutstanding: false });
    store.close(); store = new CommunityCatalogStore(file);
    assert.equal((await store.refresh(async () => { calls++; return catalog; }, 3 * DAY)).status, 'retired');
    assert.equal(calls, 0);
    assert.throws(() => store.resumeSQLiteRefresh(false, 3 * DAY, 3 * DAY), /Stop the central updater/);
    const resumed = store.resumeSQLiteRefresh(true, 4 * DAY, 3 * DAY);
    assert.equal(resumed.state, 'available'); assert.equal(resumed.lastAttempt, 4 * DAY);
    assert.equal((await store.refresh(async () => { calls++; return catalog; }, 5 * DAY - 1)).status, 'not-due');
    assert.equal((await store.refresh(async () => { calls++; return catalog; }, 5 * DAY)).status, 'updated');
    assert.equal(calls, 1);
    assert.equal(store.sqliteRefreshStatus().attemptOutstanding, false);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('in-flight refresh prevents retirement until completed; stale recovery is explicit', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-sqlite-active-')); const file = path.join(dir, 'catalog.sqlite');
  const first = new CommunityCatalogStore(file), second = new CommunityCatalogStore(file);
  let finish!: (value: unknown) => void;
  try {
    first.seed(catalog, DAY);
    const pending = first.refresh(() => new Promise(resolve => { finish = resolve; }), 2 * DAY);
    assert.equal(second.sqliteRefreshStatus().attemptOutstanding, true);
    assert.throws(() => second.retireSQLiteRefresh(true, 2 * DAY + 1), /explicit recovery/);
    finish(catalog);
    assert.equal((await pending).status, 'updated');
    assert.equal(second.sqliteRefreshStatus().attemptOutstanding, false);
    second.retireSQLiteRefresh(true, 2 * DAY + 1);
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }

  const other = mkdtempSync(path.join(tmpdir(), 'tpv-sqlite-stale-')); const otherFile = path.join(other, 'catalog.sqlite');
  const store = new CommunityCatalogStore(otherFile);
  try {
    store.seed(catalog, DAY);
    const raw = new DatabaseSync(otherFile);
    try { raw.exec("UPDATE community_catalog SET attempt_id = 'old-process' WHERE id = 1"); } finally { raw.close(); }
    assert.throws(() => store.recoverStaleSQLiteAttempt(false, DAY + 2), /confirm recovery/);
    assert.throws(() => store.retireSQLiteRefresh(true, DAY + 2), /explicit recovery/);
    const state = store.recoverStaleSQLiteAttempt(true, DAY + 2);
    assert.equal(state.attemptOutstanding, false); assert.equal(state.lastAttempt, DAY + 2);
    assert.equal((await store.refresh(async () => catalog, 2 * DAY + 1)).status, 'not-due');
  } finally { store.close(); rmSync(other, { recursive: true, force: true }); }
});

test('an outstanding refresh stays exclusive after a day and gates from its actual completion', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-sqlite-suspended-')); const file = path.join(dir, 'catalog.sqlite');
  const first = new CommunityCatalogStore(file), second = new CommunityCatalogStore(file);
  let finish!: (value: unknown) => void, fail!: (error: Error) => void, extraCalls = 0;
  try {
    first.seed(catalog, DAY);
    const pending = first.refresh(() => new Promise(resolve => { finish = resolve; }), 2 * DAY, () => 4 * DAY + 100);
    const next = await second.refresh(async () => { extraCalls++; return catalog; }, 3 * DAY + 1);
    assert.equal(next.status, 'in-progress'); assert.equal(extraCalls, 0);
    assert.throws(() => second.retireSQLiteRefresh(true, 3 * DAY + 1), /explicit recovery/);
    finish(catalog);
    const result = await pending;
    assert.equal(result.status, 'updated'); assert.equal(result.lastAttempt, 4 * DAY + 100);
    assert.equal(result.lastSuccess, 4 * DAY + 100);
    assert.equal((await second.refresh(async () => { extraCalls++; return catalog; }, 5 * DAY + 99)).status, 'not-due');
    const failed = first.refresh(() => new Promise((_, reject) => { fail = reject; }), 5 * DAY + 100, () => 7 * DAY + 101);
    assert.equal((await second.refresh(async () => { extraCalls++; return catalog; }, 6 * DAY + 101)).status, 'in-progress');
    fail(new Error('Synthetic upstream failure'));
    const failure = await failed;
    assert.equal(failure.status, 'failed'); assert.equal(failure.lastAttempt, 7 * DAY + 101);
    assert.equal(failure.lastSuccess, 4 * DAY + 100); assert.deepEqual(first.read(), catalog);
    assert.equal((await second.refresh(async () => { extraCalls++; return catalog; }, 8 * DAY + 100)).status, 'not-due');
    assert.equal(extraCalls, 0);
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('malformed retirement markers fail closed without fetching', async () => {
  for (const ddl of [
    "CREATE TABLE community_refresh_control (id INTEGER PRIMARY KEY, state TEXT, retired_at INTEGER); INSERT INTO community_refresh_control VALUES (1, 'available', 1)",
    "CREATE VIEW community_refresh_control AS SELECT 1 AS id, 'retired' AS state, 1 AS retired_at",
    'CREATE TABLE community_refresh_control (id INTEGER PRIMARY KEY, state TEXT)',
  ]) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tpv-sqlite-corrupt-')); const file = path.join(dir, 'catalog.sqlite');
    const store = new CommunityCatalogStore(file); let calls = 0;
    try {
      store.seed(catalog, 0);
      const raw = new DatabaseSync(file); try { raw.exec(ddl); } finally { raw.close(); }
      await assert.rejects(store.refresh(async () => { calls++; return catalog; }, 2 * DAY));
      assert.equal(calls, 0);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test('operator CLI requires explicit confirmation and reports retired state without credentials', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-sqlite-cutover-cli-')); const file = path.join(dir, 'catalog.sqlite');
  const store = new CommunityCatalogStore(file);
  try {
    store.seed(catalog, DAY); store.close();
    const env = { ...process.env, TPV_KARAOKENNERDS_DATABASE: file, TPV_KARAOKENNERDS_CONFIRMED_STOPPED: 'true' };
    const command = ['--import', 'tsx', 'scripts/karaokenerds-catalog.ts'];
    const retired = JSON.parse(execFileSync(process.execPath, [...command, 'sqlite-refresh-retire'], { env, encoding: 'utf8' }));
    assert.equal(retired.state, 'retired');
    const refresh = spawnSync(process.execPath, [...command, 'refresh'], { env, encoding: 'utf8' });
    assert.equal(refresh.status, 1); assert.match(refresh.stderr, /SQLite refresh is retired/);
    const noCentralTime = spawnSync(process.execPath, [...command, 'sqlite-refresh-resume'], { env, encoding: 'utf8' });
    assert.equal(noCentralTime.status, 1); assert.match(noCentralTime.stderr, /provide its last attempt time/);
    const resumeEnv = { ...env, TPV_KARAOKENNERDS_CENTRAL_LAST_ATTEMPT: String(Date.now()) };
    const resumed = JSON.parse(execFileSync(process.execPath, [...command, 'sqlite-refresh-resume'], { env: resumeEnv, encoding: 'utf8' }));
    assert.equal(resumed.state, 'available'); assert.ok(resumed.nextAttempt > Date.now());
  } finally { try { store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
});

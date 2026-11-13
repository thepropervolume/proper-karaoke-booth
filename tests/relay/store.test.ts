import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { RelayError, RelayStore } from '../../src/relay/store';

const owner = () => randomUUID();
const request = (slug = 'my-party') => ({ slug, openId: randomUUID() });
const code = (status: number) => (error: unknown) => error instanceof RelayError && error.status === status;
function fixture(run: (store: RelayStore, db: DatabaseSync, advance: (ms: number) => void) => void): void {
  const db = new DatabaseSync(':memory:'); let now = 1000;
  const store = new RelayStore(db, { now: () => now, publicOrigin: 'https://queue.example.test' });
  try { run(store, db, ms => { now += ms; }); } finally { db.close(); }
}

test('room lease and same-open retries preserve identity, URL and expiry without renewal', () => fixture((store, _db, advance) => {
  const id = owner(), input = request();
  const first = store.open(id, input);
  assert.equal(first.publicUrl, 'https://queue.example.test/my-party');
  assert.equal(first.expiresAt, 1000 + 12 * 60 * 60 * 1000);
  assert.equal(first.pollAfterMs, 0);
  advance(10_000); assert.deepEqual(store.open(id, input), first);
  assert.throws(() => store.open(id, { ...input, slug: 'different' }), code(409));
  assert.throws(() => store.assertActive(owner(), first), code(403));
}));

test('rotation fences old identities and keeps owner-bound slug reservations after close', () => fixture((store, _db) => {
  const id = owner(), firstInput = request(), first = store.open(id, firstInput);
  const fenced: string[] = []; store.onFence(room => fenced.push(room.roomId));
  const next = store.open(id, request('another-party'));
  assert.notEqual(next.roomId, first.roomId); assert.notEqual(next.generation, first.generation);
  assert.deepEqual(fenced, [first.roomId]);
  assert.throws(() => store.assertActive(id, first), code(410));
  assert.throws(() => store.open(id, firstInput), code(410));
  assert.throws(() => store.open(owner(), request('my-party')), code(409));
  store.close(id, next);
  assert.equal(store.lookup('another-party')?.active, false);
  assert.throws(() => store.assertActive(id, next), code(410));
  assert.throws(() => store.open(owner(), request('another-party')), code(409));
}));

test('reopening the same slug rotates its room and generation without growing reservations', () => fixture((store, db) => {
  const id = owner(), one = store.open(id, request()), two = store.open(id, request());
  assert.notEqual(one.roomId, two.roomId); assert.notEqual(one.generation, two.generation);
  assert.equal((db.prepare('SELECT COUNT(*) AS total FROM relay_leases').get() as { total: number }).total, 1);
  assert.throws(() => store.assertActive(id, one), code(410));
}));

test('server restart invalidates active rooms while preserving reservations and closed-open tombstones', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-relay-store-')), filename = join(directory, 'leases.sqlite');
  const id = owner(), input = request(); let db = new DatabaseSync(filename);
  const original = new RelayStore(db, { now: () => 1000 }).open(id, input); db.close();
  try {
    db = new DatabaseSync(filename); const restarted = new RelayStore(db, { now: () => 1001 });
    assert.equal(restarted.lookup(input.slug)?.active, false);
    assert.throws(() => restarted.assertActive(id, original), code(410));
    assert.throws(() => restarted.open(id, input), code(410));
    assert.throws(() => restarted.open(owner(), request(input.slug)), code(409));
    const fresh = restarted.open(id, request(input.slug)); assert.notEqual(fresh.roomId, original.roomId);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('expired reservations can be claimed without letting old identities reach the new owner', () => fixture((store, _db, advance) => {
  const id = owner(), input = request(), old = store.open(id, input);
  advance(12 * 60 * 60 * 1000);
  assert.equal(store.lookup(input.slug), null);
  assert.throws(() => store.open(id, input), code(410));
  const other = owner(), current = store.open(other, request(input.slug));
  assert.notEqual(current.roomId, old.roomId);
  assert.throws(() => store.assertActive(other, old), code(410));
  assert.throws(() => store.assertActive(id, current), code(403));
}));

test('four reservations per owner and two hundred global reservations are enforced transactionally', () => fixture((store, db) => {
  const id = owner();
  for (let index = 0; index < 4; index++) store.open(id, request(`party-${index}`));
  assert.throws(() => store.open(id, request('party-five')), code(429));
  store.open(id, request('party-0'));
  for (let index = 4; index < 200; index++) store.open(owner(), request(`party-${index}`));
  assert.throws(() => store.open(owner(), request('overflow-party')), code(503));
  assert.equal((db.prepare('SELECT COUNT(*) AS total FROM relay_leases').get() as { total: number }).total, 200);
}));

test('invalid owner/slug/identity input is rejected before SQL and failed rotation leaves the old room active', () => fixture((store, db) => {
  const id = owner(), prior = store.open(id, request()); let fenced = 0; store.onFence(() => { fenced++; });
  for (const slug of ['../secret', 'admin', 'UPPER', "a'; DROP TABLE relay_leases;--", 'a'])
    assert.throws(() => store.open(id, request(slug)), code(400));
  assert.throws(() => store.open('not-a-uuid', request()), code(400));
  assert.throws(() => store.assertActive(id, { roomId: '', generation: '' }), code(400));
  db.exec("CREATE TRIGGER fail_open BEFORE INSERT ON relay_opens BEGIN SELECT RAISE(ABORT,'fixture'); END;");
  assert.throws(() => store.open(id, request('safe-rotation')));
  assert.equal(fenced, 0); assert.equal(store.assertActive(id, prior).active, true); assert.equal(store.lookup('safe-rotation'), null);
}));

test('schema version one is initialized atomically and unrelated or unsupported databases remain unchanged', () => {
  for (const setup of [
    "CREATE TABLE unrelated(id TEXT); INSERT INTO unrelated VALUES('keep-me');",
    'PRAGMA user_version=99;',
    'CREATE TABLE relay_leases(slug TEXT); CREATE TABLE relay_opens(owner_id TEXT); PRAGMA user_version=1;',
  ]) {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(setup);
      const before = JSON.stringify(db.prepare('SELECT name,type,sql FROM sqlite_schema ORDER BY name').all());
      const version = db.prepare('PRAGMA user_version').get();
      assert.throws(() => new RelayStore(db), code(503));
      assert.equal(JSON.stringify(db.prepare('SELECT name,type,sql FROM sqlite_schema ORDER BY name').all()), before);
      assert.deepEqual(db.prepare('PRAGMA user_version').get(), version);
      if (setup.includes('unrelated')) assert.equal((db.prepare('SELECT id FROM unrelated').get() as { id: string }).id, 'keep-me');
    } finally { db.close(); }
  }
  const db = new DatabaseSync(':memory:');
  try {
    new RelayStore(db);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
    new RelayStore(db);
  } finally { db.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Store } from '../../src/main/store';

type State = { revision: number };
const database = (store: Store<State>) => (store as unknown as { db: DatabaseSync }).db;

test('an uncertain commit locks show writes until restart and preserves the committed state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-show-commit-'));
  const path = join(directory, 'show.sqlite');
  let store: Store<State> | null = new Store<State>(path);
  try {
    store.save({ revision: 0 });
    const db = database(store), original = db.exec.bind(db);
    let injected = false;
    db.exec = (sql: string) => {
      if (sql === 'COMMIT' && !injected) { injected = true; original(sql); throw new Error('injected post-commit failure'); }
      return original(sql);
    };
    assert.throws(() => store!.save({ revision: 1 }), /needs recovery/i);
    assert.equal(store.load()?.revision, 1, 'simulated commit really persisted the newer state');
    assert.throws(() => store!.save({ revision: 0 }), /needs recovery/i, 'stale in-memory state must not overwrite it');
    assert.throws(() => store!.checkpoint('generation', 1), /needs recovery/i);
    store.close(); store = new Store<State>(path);
    assert.equal(store.load()?.revision, 1, 'restart recovers the committed show');
    store.save({ revision: 2 });
    assert.equal(store.load()?.revision, 2);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a failed commit with successful rollback remains safe to retry', () => {
  const store = new Store<State>(':memory:');
  try {
    store.save({ revision: 0 });
    const db = database(store), original = db.exec.bind(db);
    let injected = false;
    db.exec = (sql: string) => {
      if (sql === 'COMMIT' && !injected) { injected = true; throw new Error('injected pre-commit failure'); }
      return original(sql);
    };
    assert.throws(() => store.save({ revision: 1 }), /injected pre-commit failure/);
    assert.equal(store.load()?.revision, 0);
    store.save({ revision: 2 });
    assert.equal(store.load()?.revision, 2);
  } finally { store.close(); }
});

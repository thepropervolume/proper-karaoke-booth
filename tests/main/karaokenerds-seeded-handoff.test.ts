import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Pool } from 'mysql2/promise';
import { MySqlCommunityCatalogStore, parseCatalogRefreshGate } from '../../src/catalog/karaokenerds-mysql';

const snapshot = { Items: [{ Id: 1, Artist: 'Artist', Title: 'Song', Brand: 'SYN', Watch: 'https://youtu.be/abcdefghij1', Created: null }] };
const hour = 3_600_000, day = 24 * hour;
const quiescenceVerifiedAtMs = 1_795_420_000_000;
const seedSha256 = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
const handoff = { seedSha256, quiescenceVerifiedAtMs };
const gate = { legacyUpdatersStopped: true, singleUpdaterConfirmed: true, seededHandoff: handoff };

function fixture() {
  // Mirror MySQL's JSON key reordering and its use of the server clock.
  const state = { snapshot: { Items: snapshot.Items.map(({ Watch, Created, Id, Artist, Title, Brand }) => ({ Watch, Created, Id, Artist, Title, Brand })) },
    import_sha256: seedSha256, sqlite_retired_ms: null as number | null, last_attempt_ms: null as number | null,
    last_success_ms: null as number | null, attempt_token: null as string | null, now_ms: quiescenceVerifiedAtMs + day - 1 };
  let lock = false, commits = 0, rollbacks = 0;
  const pool = { getConnection: async () => ({
    beginTransaction: async () => assert.equal(lock, true),
    query: async (sql: string) => {
      if (sql.startsWith('SELECT GET_LOCK')) {
        if (lock) return [[{ acquired: 0 }]];
        lock = true;
        return [[{ acquired: 1 }]];
      }
      if (sql.startsWith('SELECT RELEASE_LOCK')) {
        assert.equal(lock, true);
        lock = false;
        return [[{ released: 1 }]];
      }
      assert.match(sql, /^SELECT snapshot,/);
      assert.equal(lock, true);
      return [[{ ...state }]];
    },
    execute: async (sql: string, values: [number, string] | [string]) => {
      assert.equal(lock, true);
      if (sql.startsWith('UPDATE tpv_kn_state SET last_attempt_ms = ?, attempt_token = ?')) {
        state.last_attempt_ms = values[0] as number;
        state.attempt_token = values[1]!;
      } else {
        assert.match(sql, /^UPDATE tpv_kn_state SET last_attempt_ms = GREATEST/);
        assert.equal(values[0], state.attempt_token);
        state.last_attempt_ms = state.now_ms;
        state.attempt_token = null;
      }
      return [{ affectedRows: 1 }];
    },
    commit: async () => { commits++; },
    rollback: async () => { rollbacks++; },
    release: () => {},
  }) } as unknown as Pool;
  return { state, store: new MySqlCommunityCatalogStore(pool), counts: () => ({ commits, rollbacks }) };
}

test('seeded handoff accepts only explicit, validated private attestations', () => {
  assert.deepEqual(parseCatalogRefreshGate(gate), handoff);
  assert.equal(parseCatalogRefreshGate({ legacyUpdatersStopped: true, singleUpdaterConfirmed: true, importAndCooldownVerified: true }), undefined);
  for (const input of [{ ...gate, legacyUpdatersStopped: 1 }, { ...gate, importAndCooldownVerified: true }, { ...gate, singleUpdaterConfirmed: false },
    { ...gate, seededHandoff: { ...handoff, seedSha256: 'f'.repeat(63) } },
    { ...gate, seededHandoff: { ...handoff, quiescenceVerifiedAtMs: Number.MAX_SAFE_INTEGER } }]) {
    assert.throws(() => parseCatalogRefreshGate(input), /Invalid catalog refresh gate/);
  }
});

test('the seeded cache holds for 24 hours by DB time, then commits the first real attempt before network work', async () => {
  const { store, state, counts } = fixture();
  const never = async () => assert.fail('fetch must remain disabled');
  assert.deepEqual(await store.refresh(never), { status: 'not-initialized', lastAttempt: null, lastSuccess: null, nextAttempt: null });
  assert.deepEqual(await store.refresh(never, handoff), { status: 'not-due', lastAttempt: null, lastSuccess: null, nextAttempt: quiescenceVerifiedAtMs + day });
  assert.deepEqual(counts(), { commits: 0, rollbacks: 2 });
  state.now_ms++;
  const first = await store.refresh(async () => {
    assert.deepEqual(counts(), { commits: 1, rollbacks: 2 });
    assert.equal(state.last_attempt_ms, quiescenceVerifiedAtMs + day);
    assert.equal(state.last_success_ms, null);
    assert.ok(state.attempt_token);
    assert.equal((await store.refresh(never, handoff)).status, 'in-progress');
    state.now_ms += 1000;
    throw new Error('synthetic upstream failure');
  }, handoff);
  assert.deepEqual(first, { status: 'failed', lastAttempt: state.now_ms, lastSuccess: null, nextAttempt: state.now_ms + day });
  assert.equal(state.sqlite_retired_ms, null);
  assert.deepEqual(state.snapshot, snapshot);
  assert.equal((await store.refresh(never, handoff)).status, 'not-due');
});

test('mismatched seed bytes, stale hash, imported history and interrupted reservations cannot start a seeded attempt', async () => {
  const { state, store, counts } = fixture();
  state.now_ms++;
  const never = async () => assert.fail('unverified seed must not run');
  assert.equal((await store.refresh(never, { ...handoff, seedSha256: 'a'.repeat(64) })).status, 'not-initialized');
  state.snapshot.Items[0].Title = 'Unexpected snapshot';
  assert.equal((await store.refresh(never, handoff)).status, 'not-initialized');
  state.snapshot.Items[0].Title = 'Song';
  state.sqlite_retired_ms = 1000;
  assert.equal((await store.refresh(never, handoff)).status, 'not-initialized');
  state.sqlite_retired_ms = null;
  state.attempt_token = 'outstanding';
  assert.equal((await store.refresh(never, handoff)).status, 'recovery-required');
  assert.equal(state.last_attempt_ms, null);
  assert.equal(counts().commits, 0);
});

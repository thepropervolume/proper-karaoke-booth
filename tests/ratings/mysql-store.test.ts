/** Explicitly disposable MySQL test schema only. No production databases are modified. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { test } from 'node:test';
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { checkMySqlRatingsStore, initializeMySqlRatingsStore, MySqlRatingsStore, provisionRatingsVoter } from '../../src/ratings/mysql-store';
import { isRatingValue, isRecordingKey, parseRecordingKeys, RatingsError } from '../../src/ratings/schema';

const youtube = 'youtube:abcDEF_123-';
const sha = 'sha256:' + 'a'.repeat(64);
const credential = () => { const token = randomBytes(32).toString('base64url'); return { token, hash: createHash('sha256').update(token).digest('hex') }; };
const code = (status: number, reason?: string) => (error: unknown) => error instanceof RatingsError && error.status === status && (!reason || error.code === reason);
const socket = process.env.TPV_RATINGS_MYSQL_TEST_SOCKET, database = process.env.TPV_RATINGS_MYSQL_TEST_DATABASE;
const enabled = !!socket && isAbsolute(socket) && !!database && /^tpv_ratings_test_[a-zA-Z0-9_]+$/.test(database);

test('recording keys, integer values and bounded lookups preserve exact identity', () => {
  assert.equal(isRecordingKey(youtube), true); assert.equal(isRecordingKey(sha), true);
  assert.equal(isRecordingKey('karafun:catalog:6229'),true);assert.equal(isRecordingKey('karafun:community:6229'),true);
  for(const key of ['karafun:6229','karafun:catalog:06229','karafun:catalog:0','karafun:other:6229','karafun:catalog:1234567890123'])assert.equal(isRecordingKey(key),false);
  for (const key of ['youtube:too-short', 'youtube:abcDEF_123-?q=1', 'sha256:' + 'A'.repeat(64), 'sha256:' + 'a'.repeat(63), 'Nada Surf:Amateur', 'file:/private/song.mp4']) assert.equal(isRecordingKey(key), false);
  for (const value of [1, 10, null]) assert.equal(isRatingValue(value), true);
  for (const value of [0, 11, 1.5, '1', Number.NaN]) assert.equal(isRatingValue(value), false);
  assert.deepEqual(parseRecordingKeys([youtube, sha]), [youtube, sha]);
  assert.equal(parseRecordingKeys([youtube, youtube]), null); assert.equal(parseRecordingKeys(Array(101).fill(youtube)), null);
});

test('persistent MySQL global ratings, scoped credentials and atomic current votes', { skip: !enabled, timeout: 90_000 }, async t => {
  const pool = createPool({ socketPath: socket, user: 'root', database, connectionLimit: 8,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  const [identity] = await pool.query<(RowDataPacket & { db: string; user: string; version: string })[]>('SELECT DATABASE() AS db,CURRENT_USER() AS user,VERSION() AS version');
  assert.equal(identity[0].db, database); assert.match(identity[0].db, /^tpv_ratings_test_/); assert.match(identity[0].user, /^root@/); assert.match(identity[0].version, /^8\./);
  const reset = async () => {
    const [tables] = await pool.query<(RowDataPacket & { name: string })[]>('SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    assert.ok(tables.every(table => ['schema_version', 'voters', 'votes'].includes(table.name)), 'refuse to reset unrelated tables');
    for (const table of ['votes', 'voters', 'schema_version']) await pool.query(`DROP TABLE IF EXISTS ${table}`);
  };
  const fresh = async () => { await reset(); await initializeMySqlRatingsStore(pool); return new MySqlRatingsStore(pool); };
  const voter = async () => { const id = randomUUID(), key = credential(); await provisionRatingsVoter(pool, { voterId: id, tokenHashHex: key.hash }); return { id, ...key }; };
  try {
    await t.test('controlled provisioning stores only credential hashes and disabled credentials are denied', async () => {
      const store = await fresh(); await initializeMySqlRatingsStore(pool); await checkMySqlRatingsStore(pool);
      const one = await voter();
      assert.equal(await store.authenticate(one.hash), one.id); assert.equal(await store.authenticate(credential().hash), null);
      const [rows] = await pool.query<(RowDataPacket & { token_hash: Buffer; disabled: number })[]>('SELECT token_hash,disabled FROM voters');
      assert.ok(Buffer.isBuffer(rows[0].token_hash)); assert.equal(rows[0].token_hash.toString('hex'), one.hash);
      assert.equal(JSON.stringify(rows).includes(one.token), false);
      await provisionRatingsVoter(pool, { voterId: one.id, tokenHashHex: one.hash, disabled: true });
      assert.equal(await store.authenticate(one.hash), null); await assert.rejects(store.vote(youtube, 8, one.id, one.hash), code(401));
      await assert.rejects(provisionRatingsVoter(pool, { voterId: randomUUID(), tokenHashHex: one.hash }), code(400, 'VOTER_CONFLICT'));
      assert.equal(Number((await pool.query<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM voters'))[0][0].total), 1);
    });

    await t.test('each voter has one current score; updates, aggregates, own vote and clear survive restart', async () => {
      const store = await fresh(), one = await voter(), two = await voter();
      assert.deepEqual(await store.lookup([youtube, sha], null), [
        { recordingKey: youtube, average: null, count: 0, ownVote: null }, { recordingKey: sha, average: null, count: 0, ownVote: null },
      ]);
      assert.deepEqual(await store.vote(youtube, 8, one.id, one.hash), { recordingKey: youtube, average: 8, count: 1, ownVote: 8 });
      assert.deepEqual(await store.vote(youtube, 8, one.id, one.hash), { recordingKey: youtube, average: 8, count: 1, ownVote: 8 });
      assert.deepEqual(await store.vote(youtube, 10, one.id, one.hash), { recordingKey: youtube, average: 10, count: 1, ownVote: 10 });
      assert.deepEqual(await store.vote(youtube, 1, two.id, two.hash), { recordingKey: youtube, average: 5.5, count: 2, ownVote: 1 });
      assert.deepEqual(await store.lookup([youtube], null), [{ recordingKey: youtube, average: 5.5, count: 2, ownVote: null }]);
      const restarted = new MySqlRatingsStore(pool); await checkMySqlRatingsStore(pool);
      assert.deepEqual(await restarted.lookup([youtube], one.id), [{ recordingKey: youtube, average: 5.5, count: 2, ownVote: 10 }]);
      assert.deepEqual(await restarted.vote(youtube, null, one.id, one.hash), { recordingKey: youtube, average: 1, count: 1, ownVote: null });
      assert.deepEqual(await restarted.vote(youtube, null, one.id, one.hash), { recordingKey: youtube, average: 1, count: 1, ownVote: null });
      assert.deepEqual(await restarted.vote(youtube, null, two.id, two.hash), { recordingKey: youtube, average: null, count: 0, ownVote: null });
    });

    await t.test('case-sensitive YouTube IDs and separate local SHA-256 identities never merge', async () => {
      const store = await fresh(), one = await voter(), otherYouTube = 'youtube:AbcDEF_123-', otherSha = 'sha256:' + 'b'.repeat(64);
      await store.vote(youtube, 1, one.id, one.hash); await store.vote(otherYouTube, 10, one.id, one.hash);
      await store.vote(sha, 2, one.id, one.hash); await store.vote(otherSha, 9, one.id, one.hash);
      const result = await store.lookup([otherSha, youtube, sha, otherYouTube], one.id);
      assert.deepEqual(result.map(rating => [rating.recordingKey, rating.average, rating.count]), [[otherSha, 9, 1], [youtube, 1, 1], [sha, 2, 1], [otherYouTube, 10, 1]]);
    });

    await t.test('concurrent repeated votes cannot duplicate a voter and simultaneous voters remain isolated', async () => {
      const store = await fresh(), one = await voter(), two = await voter(), three = await voter();
      await Promise.all([store.vote(youtube, 3, one.id, one.hash), store.vote(youtube, 9, one.id, one.hash)]);
      const own = (await store.lookup([youtube], one.id))[0]; assert.equal(own.count, 1); assert.ok([3, 9].includes(own.ownVote!)); assert.equal(own.average, own.ownVote);
      await Promise.all([store.vote(youtube, 5, two.id, two.hash), store.vote(youtube, 7, three.id, three.hash)]);
      const result = (await store.lookup([youtube], one.id))[0]; assert.equal(result.count, 3); assert.equal(result.average, (own.ownVote! + 5 + 7) / 3);
      assert.equal((await store.lookup([youtube], two.id))[0].ownVote, 5); assert.equal((await store.lookup([youtube], three.id))[0].ownVote, 7);
    });

    await t.test('token rotation between authentication and write is rejected under the voter row lock', async () => {
      const store = await fresh(), one = await voter(); await store.vote(youtube, 8, one.id, one.hash);
      const authenticated = await store.authenticate(one.hash); assert.equal(authenticated, one.id);
      const rotated = credential(); await provisionRatingsVoter(pool, { voterId: one.id, tokenHashHex: rotated.hash });
      assert.equal(await store.authenticate(one.hash), null); assert.equal(await store.authenticate(rotated.hash), one.id);
      await assert.rejects(store.vote(youtube, 1, authenticated!, one.hash), code(401));
      await assert.rejects(store.vote(youtube, null, authenticated!, one.hash), code(401));
      assert.deepEqual((await store.lookup([youtube], one.id))[0], { recordingKey: youtube, average: 8, count: 1, ownVote: 8 });
      assert.equal((await store.vote(youtube, 9, one.id, rotated.hash)).ownVote, 9);
      await provisionRatingsVoter(pool, { voterId: one.id, tokenHashHex: rotated.hash, disabled: true });
      await assert.rejects(store.vote(youtube, 2, one.id, rotated.hash), code(401));
    });

    await t.test('scoped lookup rechecks rotated or disabled credentials while anonymous aggregates stay public', async () => {
      const store = await fresh(), one = await voter(); await store.vote(youtube, 8, one.id, one.hash);
      assert.equal(await store.authenticate(one.hash), one.id);
      const rotated = credential(); await provisionRatingsVoter(pool, { voterId: one.id, tokenHashHex: rotated.hash });
      await assert.rejects(store.lookup([youtube], one.id, one.hash), code(401));
      assert.deepEqual(await store.lookup([youtube], one.id, rotated.hash), [{ recordingKey: youtube, average: 8, count: 1, ownVote: 8 }]);
      await provisionRatingsVoter(pool, { voterId: one.id, tokenHashHex: rotated.hash, disabled: true });
      await assert.rejects(store.lookup([youtube], one.id, rotated.hash), code(401));
      await assert.rejects(store.lookup([], one.id, rotated.hash), code(401));
      assert.deepEqual(await store.lookup([youtube], null), [{ recordingKey: youtube, average: 8, count: 1, ownVote: null }]);
    });

    await t.test('failed writes roll back and pool pressure does not corrupt or invent aggregates', async () => {
      const store = await fresh(), one = await voter(); await store.vote(youtube, 8, one.id, one.hash);
      const failed = { getConnection: async () => {
        const connection = await pool.getConnection();
        return new Proxy(connection, { get(target, property) {
          if (property === 'commit') return async () => { throw new Error('synthetic private commit failure'); };
          const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
        } }) as PoolConnection;
      } } as unknown as Pool;
      await assert.rejects(new MySqlRatingsStore(failed).vote(youtube, 1, one.id, one.hash), error => code(503)(error) && !(error as Error).message.includes('private'));
      assert.equal((await store.lookup([youtube], one.id))[0].ownVote, 8);
      const pressured = { getConnection: async () => { throw new Error('synthetic pool exhausted'); } } as unknown as Pool;
      await assert.rejects(new MySqlRatingsStore(pressured).vote(youtube, 1, one.id, one.hash), code(503));
      assert.equal((await store.lookup([youtube], one.id))[0].ownVote, 8);
    });

    await t.test('unrelated or unsupported schemas are preserved and database checks enforce score bounds', async () => {
      await reset(); await pool.query('CREATE TABLE unrelated(id INT PRIMARY KEY,value VARCHAR(32)) ENGINE=InnoDB');
      await pool.query("INSERT INTO unrelated(id,value) VALUES(1,'preserve-me')");
      await assert.rejects(initializeMySqlRatingsStore(pool), code(503, 'UNSUPPORTED_SCHEMA'));
      await assert.rejects(checkMySqlRatingsStore(pool), code(503, 'UNSUPPORTED_SCHEMA'));
      assert.equal((await pool.query<(RowDataPacket & { value: string })[]>('SELECT value FROM unrelated WHERE id=1'))[0][0].value, 'preserve-me');
      await pool.query('DROP TABLE unrelated');
      const store = await fresh(), one = await voter();
      await assert.rejects(pool.execute('INSERT INTO votes(recording_key,voter_id,value,updated_at) VALUES(?,?,0,UTC_TIMESTAMP(6))', [youtube, one.id]));
      await store.vote(youtube, 8, one.id, one.hash); await pool.query('UPDATE schema_version SET version=99 WHERE id=1');
      await assert.rejects(initializeMySqlRatingsStore(pool), code(503, 'UNSUPPORTED_SCHEMA'));
      await assert.rejects(checkMySqlRatingsStore(pool), code(503, 'UNSUPPORTED_SCHEMA'));
      assert.equal((await store.lookup([youtube], one.id))[0].ownVote, 8);
    });

    await t.test('invalid identities, values and lookup sizes are rejected before SQL', async () => {
      const store = await fresh(), one = await voter();
      for (const value of [0, 11, -1, 1.5]) await assert.rejects(store.vote(youtube, value, one.id, one.hash), code(400));
      await assert.rejects(store.vote('file:/private/song.mp4', 8, one.id, one.hash), code(400));
      await assert.rejects(store.vote(youtube, 8, 'claimed-voter-id', one.hash), code(400));
      await assert.rejects(store.vote(youtube, 8, randomUUID(), one.hash), code(401));
      await assert.rejects(store.lookup(Array(101).fill(youtube), null), code(400));
      await assert.rejects(store.lookup([youtube, youtube], null), code(400));
      assert.deepEqual(await store.lookup([], null), []);
    });
  } finally { await reset(); await pool.end(); }
});

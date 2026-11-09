/** Explicit opt-in only: a disposable local MySQL database with synthetic credentials. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { catalogMigrationIntegrity, type CatalogMigrationPayload } from '../../src/catalog/karaokenerds-migration-schema';
import { initializeMySqlCatalog, MySqlCommunityCatalogStore } from '../../src/catalog/karaokenerds-mysql';
import { createMySqlCatalogReader } from '../../src/catalog/karaokenerds-mysql-reader';

const rawPort = process.env.TPV_MYSQL_DISPOSABLE_TEST_PORT;
const enabled = !!rawPort && /^\d{1,5}$/.test(rawPort) && Number(rawPort) > 0 && Number(rawPort) <= 65535;
const entry = { Id: 0, Artist: 'Synthetic Artist', Title: 'Synthetic Song', Brand: 'SYN', Watch: 'https://youtu.be/abcdefghij1', Created: null };
const payload: CatalogMigrationPayload = {
  snapshot: { Items: [entry, ...['abcdefghij2', 'abcdefghij3', 'abcdefghij4'].map(id => ({ ...entry, Watch: `https://youtu.be/${id}` }))] }, lastAttempt: 1000, lastSuccess: 900,
  sqliteRetirement: { state: 'retired', retiredAt: 800, attemptOutstanding: false },
  brandMappings: [{ slug: 'SyntheticBrand', name: 'Sýnthetic 🎤 Brand', upstreamBrand: 'SYN', observedAt: 100 }],
  videoMetadata: [{ youtubeId: 'abcdefghij1', brandSlug: 'SyntheticBrand', producerTrackCode: 'SYN-003', codeSource: 'host-confirmed' }],
  videoDates: [{ youtubeId: 'abcdefghij1', uploadDate: '2025-01-01', releaseDate: null, source: 'yt-dlp', observedAt: 101 }],
};
const bundle = { ...payload, integrity: catalogMigrationIntegrity(payload) };

test('MySQL 8 catalog import, daily gate, cross-connection lock and failure retention', { skip: !enabled }, async () => {
  // Intentionally cannot select a remote host or user database: this suite is
  // intended exclusively for the locally spawned disposable test container.
  const pool = createPool({ host: '127.0.0.1', port: Number(rawPort), user: 'tpvtest', password: 'synthetic_test_only', database: 'tpvtest',
    connectionLimit: 4, supportBigNumbers: true, bigNumberStrings: true });
  try {
    const [identity] = await pool.query<(RowDataPacket & { db: string; user: string; version: string })[]>('SELECT DATABASE() AS db, CURRENT_USER() AS user, VERSION() AS version');
    assert.equal(identity[0].db, 'tpvtest'); assert.match(identity[0].user, /^tpvtest@/); assert.match(identity[0].version, /^8\.0\./);
    const [existing] = await pool.query<(RowDataPacket & { total: number })[]>("SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()");
    assert.equal(Number(existing[0].total), 0, 'test database must be new and empty');
    await initializeMySqlCatalog(pool); await initializeMySqlCatalog(pool);
    const first = new MySqlCommunityCatalogStore(pool), second = new MySqlCommunityCatalogStore(pool);
    let calls = 0;
    assert.equal(await first.read(), null);
    assert.equal((await first.refresh(async () => { calls++; return payload.snapshot; })).status, 'not-initialized');
    assert.equal(calls, 0);
    const failPool = { getConnection: async () => {
      const connection = await pool.getConnection();
      return new Proxy(connection, { get(target, property) {
        if (property === 'execute') return async (sql: string, values: Parameters<PoolConnection['execute']>[1]) => {
          if (sql.startsWith('INSERT INTO tpv_kn_brands')) throw new Error('Synthetic import failure');
          return target.execute(sql, values);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } }) as PoolConnection;
    } } as unknown as Pool;
    await assert.rejects(new MySqlCommunityCatalogStore(failPool).importCatalog(bundle), /Synthetic import failure/);
    assert.equal(await first.read(), null);
    assert.equal((await first.brandMappings()).length, 0);
    await pool.query("INSERT INTO tpv_kn_brands (slug, display_name, upstream_brand, observed_at) VALUES ('Stray', 'Synthetic stray', 'STRAY', 1)");
    await assert.rejects(first.importCatalog(bundle), /metadata tables are not empty/);
    assert.equal(await first.read(), null); assert.equal((await first.brandMappings()).length, 1);
    await pool.query("DELETE FROM tpv_kn_brands WHERE slug = 'Stray'");
    const { sqliteRetirement: ignored, ...withoutRetirement } = bundle;
    void ignored;
    await assert.rejects(first.importCatalog(withoutRetirement), /Invalid catalog migration export/);
    // The second 01:30 occurs at the end of daylight saving time. Using a
    // local DATETIME as input to UNIX_TIMESTAMP may map it to the first 01:30.
    const tzPool = createPool({ host: '127.0.0.1', port: Number(rawPort), user: 'tpvtest', password: 'synthetic_test_only', database: 'tpvtest',
      connectionLimit: 1, supportBigNumbers: true, bigNumberStrings: true });
    try {
      const session = await tzPool.getConnection();
      await session.query("SET time_zone = 'America/New_York'");
      await session.query('SET timestamp = 1730615400');
      session.release();
      const tzStore = new MySqlCommunityCatalogStore(tzPool);
      await tzStore.importCatalog(bundle);
      assert.equal((await tzStore.status()).lastAttempt, 1_730_615_400_000);
    } finally { await tzPool.end(); }
    const before = Date.now();
    await pool.query("UPDATE tpv_kn_state SET last_attempt_ms = CAST(TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', UTC_TIMESTAMP(3)) DIV 1000 AS UNSIGNED) WHERE id = 1");
    assert.deepEqual(await first.read(), payload.snapshot);
    assert.deepEqual(await first.brandMappings(), payload.brandMappings);
    assert.deepEqual(await first.videoMetadata(), payload.videoMetadata);
    assert.deepEqual(await first.videoDates('abcdefghij1'), { uploadDate: '2025-01-01', releaseDate: null, source: 'yt-dlp', observedAt: 101 });
    assert.equal((await first.searchSnapshot()).revision, '1');
    const reader = createMySqlCatalogReader(first);
    const request = { query: 'Synthetic', artist: '', brandSlug: 'SyntheticBrand', cursor: null, limit: 1 };
    assert.equal((await reader.search(request)).items.length, 1);
    await first.saveBrandMapping({ slug: 'SyntheticBrand', name: 'Sýnthetic 🎤 Brand', upstreamBrand: 'SYN' }, 102, ['abcdefghij2']);
    await first.saveProducerTrackCode('abcdefghij2', 'SYN-004', 'creator-catalog');
    await first.saveVideoDates('abcdefghij2', { uploadDate: '2026-05-01', releaseDate: null, provenance: 'yt-dlp' }, 103);
    const coherent = await first.searchSnapshot();
    assert.equal(coherent.revision, '4'); assert.equal(coherent.videoMetadata.length, 2); assert.equal(coherent.videoDates.length, 2);
    assert.equal(coherent.videoMetadata[1].producerTrackCode, 'SYN-004');
    const firstPage = await reader.search(request); assert.equal(firstPage.items.length, 1); assert.ok(firstPage.nextCursor);
    await assert.rejects(first.saveBrandMapping({ slug: 'syntheticbrand', name: 'Conflict', upstreamBrand: 'OTHER' }, 104), /conflicts/);
    await assert.rejects(first.saveProducerTrackCode('abcdefghij2', 'SYN-005', 'creator-catalog'), /conflicting/);
    assert.equal((await first.searchSnapshot()).revision, '4');
    await assert.rejects(first.importCatalog(bundle), /already initialized/);
    const due = await first.refresh(async () => { calls++; return payload.snapshot; });
    assert.equal(due.status, 'not-due'); assert.ok(due.lastAttempt! >= before - 5000); assert.equal(calls, 0);

    await pool.query('UPDATE tpv_kn_state SET last_attempt_ms = 1 WHERE id = 1');
    let finish!: (value: unknown) => void, started!: () => void;
    const startedSignal = new Promise<void>(resolve => { started = resolve; });
    const pending = first.refresh(() => { calls++; started(); return new Promise(resolve => { finish = resolve; }); });
    await startedSignal;
    assert.equal((await second.refresh(async () => { calls++; return payload.snapshot; })).status, 'in-progress');
    finish(payload.snapshot);
    assert.equal((await pending).status, 'updated'); assert.equal(calls, 1);
    assert.equal((await first.searchSnapshot()).revision, '5');
    await assert.rejects(reader.search({ ...request, cursor: firstPage.nextCursor }), /stale/);
    assert.equal((await second.refresh(async () => { calls++; return payload.snapshot; })).status, 'not-due');

    await pool.query('UPDATE tpv_kn_state SET last_attempt_ms = 1 WHERE id = 1');
    const bad = await first.refresh(async () => ({ Items: [entry] }));
    assert.equal(bad.status, 'failed'); assert.deepEqual(await first.read(), payload.snapshot);
    assert.equal((await first.searchSnapshot()).revision, '5');
    assert.equal((await second.refresh(async () => { calls++; return payload.snapshot; })).status, 'not-due');
    assert.equal(calls, 1);

    // Kill the exact disposable test session while its fetch is suspended.
    // The saved reservation blocks a second fetch and the dead session cannot publish.
    await pool.query('UPDATE tpv_kn_state SET last_attempt_ms = 1 WHERE id = 1');
    let continueFetch!: (value: unknown) => void, suspended!: () => void;
    const suspendedSignal = new Promise<void>(resolve => { suspended = resolve; });
    const interrupted = first.refresh(() => { calls++; suspended(); return new Promise(resolve => { continueFetch = resolve; }); });
    await suspendedSignal;
    const [holder] = await pool.query<(RowDataPacket & { owner: string | number | null })[]>("SELECT IS_USED_LOCK('tpv-karaoke-community-refresh-v1') AS owner");
    const owner = Number(holder[0].owner); assert.ok(Number.isSafeInteger(owner) && owner > 0);
    await pool.query(`KILL CONNECTION ${owner}`);
    assert.equal((await second.refresh(async () => { calls++; return payload.snapshot; })).status, 'recovery-required');
    await pool.query('UPDATE tpv_kn_state SET last_attempt_ms = 1 WHERE id = 1');
    assert.equal((await second.refresh(async () => { calls++; return payload.snapshot; })).status, 'recovery-required');
    continueFetch({ Items: [entry, entry] });
    await assert.rejects(interrupted);
    assert.deepEqual(await second.read(), payload.snapshot); assert.equal(calls, 2);
    assert.equal((await second.status()).recoveryRequired, true);
    const recovery = await second.recoverInterruptedRefresh();
    assert.ok(recovery.nextAttempt - recovery.lastAttempt >= 86_400_000);
    assert.equal((await second.status()).recoveryRequired, false);
    assert.equal((await second.refresh(async () => { calls++; return payload.snapshot; })).status, 'not-due');

    // The observed real feed is roughly ten MB. Verify transport and JSON storage
    // with synthetic rows of a comparable size, never the real private snapshot.
    const [settings] = await pool.query<(RowDataPacket & { bytes: string | number })[]>('SELECT @@max_allowed_packet AS bytes');
    assert.ok(Number(settings[0].bytes) > 12 * 1024 * 1024, 'disposable MySQL packet limit must support this fixture');
    const large = { Items: Array.from({ length: 1200 }, (_, index) => ({ ...entry, Id: index, Title: 'Synthetic '.repeat(900) })) };
    assert.ok(Buffer.byteLength(JSON.stringify(large)) > 10 * 1024 * 1024);
    await pool.query('UPDATE tpv_kn_state SET last_attempt_ms = 1 WHERE id = 1');
    assert.equal((await first.refresh(async () => large)).status, 'updated');
    assert.equal((await first.read())?.Items.length, 1200);
  } finally { await pool.end(); }
});

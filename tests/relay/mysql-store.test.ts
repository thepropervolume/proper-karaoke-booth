/** Opt-in only: this suite resets only its explicitly named disposable MySQL schema. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { test } from 'node:test';
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { initializeMySqlRelayStore, MySqlRelayStore } from '../../src/relay/mysql-store';
import { RelayError } from '../../src/relay/store';

const socket = process.env.TPV_QUEUE_MYSQL_TEST_SOCKET;
const database = process.env.TPV_QUEUE_MYSQL_TEST_DATABASE;
const enabled = !!socket && isAbsolute(socket) && !!database && /^tpv_queue_test_[a-zA-Z0-9_]+$/.test(database);
const request = (slug = 'proper-party') => ({ slug, openId: randomUUID() });
const mobileOwner = () => 'f17e0001-' + randomUUID().slice(9);
const desktopOwner = () => 'de5c0001-' + randomUUID().slice(9);
const code = (status: number, reason?: string) => (error: unknown) => error instanceof RelayError && error.status === status && (!reason || error.code === reason);

test('configured owner retention accepts bounded UUIDs and rejects malformed retention configuration before database access', () => {
  const unusedPool = {} as Pool;
  for (const retainedOwnerIds of [null, 'owner', ['not-an-id'], [42], Array.from({ length: 101 }, () => randomUUID())]) {
    assert.throws(() => new MySqlRelayStore(unusedPool, { retainedOwnerIds: retainedOwnerIds as readonly string[] }), code(400, 'invalid-configuration'));
  }
  assert.doesNotThrow(() => new MySqlRelayStore(unusedPool, { retainedOwnerIds: [mobileOwner(), desktopOwner()] }));
});

test('MySQL relay metadata lifecycle, isolation and transaction invariants', { skip: !enabled, timeout: 120_000 }, async t => {
  const pool = createPool({ socketPath: socket, user: 'root', database, connectionLimit: 8,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  const [identity] = await pool.query<(RowDataPacket & { db: string; user: string; version: string })[]>('SELECT DATABASE() AS db,CURRENT_USER() AS user,VERSION() AS version');
  assert.equal(identity[0].db, database); assert.match(identity[0].db, /^tpv_queue_test_/); assert.match(identity[0].user, /^root@/); assert.match(identity[0].version, /^8\./);
  const reset = async () => {
    const [tables] = await pool.query<(RowDataPacket & { name: string })[]>('SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    assert.ok(tables.every(table => ['relay_opens', 'relay_leases', 'relay_owners', 'relay_version'].includes(table.name)), 'refuse to reset unrelated tables');
    for (const table of ['relay_opens', 'relay_leases', 'relay_owners', 'relay_version']) await pool.query(`DROP TABLE IF EXISTS ${table}`);
  };
  const fresh = async (now = () => 1000, retainedOwnerIds: readonly string[] = []) => {
    await reset(); await initializeMySqlRelayStore(pool);
    const store = new MySqlRelayStore(pool, { now, publicOrigin: 'https://queue.example.test', retainedOwnerIds });
    await store.initializeRuntime(); return store;
  };
  try {
    await t.test('explicit initialization and same-open retry are idempotent without renewing expiry', async () => {
      const store = await fresh();
      await initializeMySqlRelayStore(pool);
      const owner = randomUUID(), input = request(), first = await store.open(owner, input);
      assert.equal(first.publicUrl, 'https://queue.example.test/proper-party');
      assert.equal(first.expiresAt, 1000 + 12 * 60 * 60 * 1000); assert.equal(first.pollAfterMs, 0);
      assert.deepEqual(await store.open(owner, input), first);
      await assert.rejects(store.open(owner, { ...input, slug: 'different-party' }), code(409, 'open-conflict'));
      await assert.rejects(store.assertActive(randomUUID(), first), code(403, 'owner-forbidden'));
      assert.equal((await store.lookup(input.slug))?.ownerId, owner);
      await store.initializeRuntime(); assert.equal((await store.assertActive(owner, first)).active, true);
    });

    await t.test('rotation, close, expiry and restart fence old generations while preserving reservations', async () => {
      let now = 1000; const store = await fresh(() => now), owner = randomUUID(), input = request();
      const first = await store.open(owner, input), fences: string[] = [];
      store.onFence(room => fences.push(room.roomId));
      const second = await store.open(owner, request('second-party'));
      assert.deepEqual(fences, [first.roomId]);
      await assert.rejects(store.assertActive(owner, first), code(410)); await assert.rejects(store.open(owner, input), code(410));
      await assert.rejects(store.open(randomUUID(), request(input.slug)), code(409));
      await store.close(owner, second); assert.equal((await store.lookup('second-party'))?.active, false);
      const thirdInput = request('second-party'), third = await store.open(owner, thirdInput);
      const restarted = new MySqlRelayStore(pool, { now: () => now });
      await assert.rejects(restarted.lookup('second-party'), code(503));
      await restarted.initializeRuntime();
      assert.equal((await restarted.lookup('second-party'))?.active, false);
      await assert.rejects(restarted.assertActive(owner, third), code(410)); await assert.rejects(restarted.open(owner, thirdInput), code(410));
      await assert.rejects(restarted.open(randomUUID(), request('second-party')), code(409));
      now += 12 * 60 * 60 * 1000;
      assert.equal(await restarted.lookup('second-party'), null);
      await assert.rejects(restarted.open(owner, thirdInput), code(410));
      const newOwner = randomUUID(), current = await restarted.open(newOwner, request('second-party'));
      assert.notEqual(current.roomId, third.roomId); await assert.rejects(restarted.assertActive(owner, current), code(403));
    });

    await t.test('concurrent owners cannot share a slug and concurrent same-owner opens leave exactly one active lease', async () => {
      const store = await fresh(), owners = [randomUUID(), randomUUID()];
      const competing = await Promise.allSettled(owners.map(owner => store.open(owner, request('same-slug'))));
      assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
      assert.ok(competing.some(result => result.status === 'rejected' && code(409, 'slug-unavailable')(result.reason)));
      const owner = randomUUID(), input = request('idempotent-party');
      const [first, duplicate] = await Promise.all([store.open(owner, input), store.open(owner, input)]);
      assert.deepEqual(first, duplicate);
      await Promise.all([store.open(owner, request('left-party')), store.open(owner, request('right-party'))]);
      const [active] = await pool.execute<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM relay_leases WHERE owner_id=? AND active=1', [owner]);
      assert.equal(Number(active[0].total), 1);
      const [generated] = await pool.execute<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM relay_leases WHERE active_owner=?', [owner]);
      assert.equal(Number(generated[0].total), 1);
    });

    await t.test('per-owner and global reservation caps hold across concurrent transactions', async () => {
      const store = await fresh(), owner = randomUUID();
      for (let index = 0; index < 4; index++) await store.open(owner, request(`owner-party-${index}`));
      await assert.rejects(store.open(owner, request('owner-party-five')), code(429));
      for (let index = 4; index < 199; index++) await store.open(randomUUID(), request(`global-party-${index}`));
      const last = await Promise.allSettled([store.open(randomUUID(), request('last-party-one')), store.open(randomUUID(), request('last-party-two'))]);
      assert.equal(last.filter(result => result.status === 'fulfilled').length, 1);
      assert.ok(last.some(result => result.status === 'rejected' && code(503, 'reservation-capacity')(result.reason)));
      const [total] = await pool.query<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM relay_leases');
      assert.equal(Number(total[0].total), 200);
    });

    await t.test('anonymous mobile quotas include closed reservations and preserve 150 desktop slots under contention', async () => {
      const store = await fresh(), firstOwner = mobileOwner();
      const closed = await store.open(firstOwner, request('mobile-closed'));
      await store.close(firstOwner, closed);
      await assert.rejects(store.open(firstOwner, request('mobile-second-slug')), code(429, 'owner-reservation-limit'));
      for (let index = 1; index < 49; index++) await store.open(mobileOwner(), request(`mobile-reserved-${index}`));
      const lastMobile = await Promise.allSettled([
        store.open(mobileOwner(), request('mobile-final-one')),
        store.open(mobileOwner(), request('mobile-final-two')),
      ]);
      assert.equal(lastMobile.filter(result => result.status === 'fulfilled').length, 1);
      assert.ok(lastMobile.some(result => result.status === 'rejected' && code(503, 'mobile-reservation-capacity')(result.reason)));
      await assert.rejects(store.open(mobileOwner(), request('mobile-over-capacity')), code(503, 'mobile-reservation-capacity'));
      const [mobileCount] = await pool.query<(RowDataPacket & { total: string | number })[]>("SELECT COUNT(*) AS total FROM relay_leases WHERE owner_id LIKE 'f17e0001-%'");
      assert.equal(Number(mobileCount[0].total), 50, 'closed leases remain reserved, and concurrent mobile opens cannot exceed their subquota');
      for (let index = 0; index < 149; index++) await store.open(desktopOwner(), request(`desktop-reserved-${index}`));
      const lastDesktop = await Promise.allSettled([
        store.open(desktopOwner(), request('desktop-final-one')),
        store.open(desktopOwner(), request('desktop-final-two')),
      ]);
      assert.equal(lastDesktop.filter(result => result.status === 'fulfilled').length, 1);
      assert.ok(lastDesktop.some(result => result.status === 'rejected' && code(503, 'reservation-capacity')(result.reason)));
      const [counts] = await pool.query<(RowDataPacket & { total: string | number; mobile: string | number })[]>(
        "SELECT COUNT(*) AS total,SUM(owner_id LIKE 'f17e0001-%') AS mobile FROM relay_leases");
      assert.equal(Number(counts[0].total), 200); assert.equal(Number(counts[0].mobile), 50);
      assert.equal(Number(counts[0].total) - Number(counts[0].mobile), 150);
      assert.equal(store.isAvailable(), true, 'expected quota rejections must not latch existing shows unavailable');
    });

    await t.test('only anonymous orphans expire after all lease and retry references, while configured and desktop owners remain', async () => {
      const leaseMs = 12 * 60 * 60 * 1000, initial = 1000;
      let now = initial;
      const configuredPrefixOwner = mobileOwner(), desktop = desktopOwner(), expiredOwner = mobileOwner();
      const configured = [configuredPrefixOwner], store = await fresh(() => now, configured);
      configured.length = 0;
      await pool.execute('INSERT INTO relay_owners(owner_id) VALUES(?),(?)', [configuredPrefixOwner, desktop]);
      const input = request('anonymous-expiry'), opened = await store.open(expiredOwner, input);
      await store.close(expiredOwner, opened);
      const owners = async () => {
        const [rows] = await pool.query<(RowDataPacket & { owner_id: string })[]>('SELECT owner_id FROM relay_owners');
        return new Set(rows.map(row => row.owner_id));
      };
      await store.expire(); assert.equal((await owners()).has(expiredOwner), true, 'a closed but reserved lease protects its owner');
      now = initial + leaseMs;
      await store.expire();
      assert.equal(await store.lookup(input.slug), null);
      assert.equal((await owners()).has(expiredOwner), true, 'a retry tombstone alone must retain the anonymous owner');
      await assert.rejects(store.open(expiredOwner, input), code(410, 'room-ended'));
      now = initial + 2 * leaseMs - 1;
      await store.expire(); assert.equal((await owners()).has(expiredOwner), true, 'retain the full retry window');
      // Exercise the lease-only invariant independently of retry retention. This
      // fixture edit is confined to the explicitly disposable schema above.
      const leaseOnlyOwner = mobileOwner(), activeLease = await store.open(leaseOnlyOwner, request('lease-reference-only'));
      await pool.execute('DELETE FROM relay_opens WHERE owner_id=?', [leaseOnlyOwner]);
      now++;
      await store.expire();
      const retained = await owners();
      assert.equal(retained.has(expiredOwner), false, 'remove anonymous ownership only after its last tombstone expires');
      assert.equal(retained.has(leaseOnlyOwner), true, 'a retained lease independently protects its owner');
      assert.equal(retained.has(configuredPrefixOwner), true, 'configured owners survive even when their UUID has the anonymous prefix');
      assert.equal(retained.has(desktop), true, 'ordinary desktop owners without current rooms are never garbage-collected');
      assert.equal((await store.assertActive(leaseOnlyOwner, activeLease)).active, true);
      now = activeLease.expiresAt;
      await store.expire();
      const final = await owners();
      assert.equal(final.has(leaseOnlyOwner), false); assert.equal(final.has(configuredPrefixOwner), true); assert.equal(final.has(desktop), true);
      assert.equal(final.size, 2); assert.equal(store.isAvailable(), true);
    });

    await t.test('failed rotation with confirmed rollback preserves the prior room and remains available', async () => {
      await reset(); await initializeMySqlRelayStore(pool); let fail = false;
      const failing = { getConnection: async () => {
        const connection = await pool.getConnection();
        return new Proxy(connection, { get(target, property) {
          if (property === 'execute') return async (sql: string, values?: Parameters<PoolConnection['execute']>[1]) => {
            if (fail && sql.startsWith('INSERT INTO relay_opens')) throw new Error('synthetic private driver failure');
            return target.execute(sql, values);
          };
          const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
        } }) as PoolConnection;
      } } as unknown as Pool;
      const store = new MySqlRelayStore(failing, { now: () => 1000 }); await store.initializeRuntime();
      const owner = randomUUID(), prior = await store.open(owner, request()), fences: string[] = [];
      store.onFence(room => fences.push(room.roomId)); fail = true;
      await assert.rejects(store.open(owner, request('failed-rotation')), error => code(503)(error) && !(error as Error).message.includes('private'));
      assert.deepEqual(fences, []); assert.equal(store.isAvailable(), true);
      assert.equal((await store.assertActive(owner, prior)).active, true);
      const [rows] = await pool.execute<(RowDataPacket & { room_id: string; active: number })[]>('SELECT room_id,active FROM relay_leases WHERE owner_id=?', [owner]);
      assert.deepEqual(rows.map(row => ({ roomId: row.room_id, active: row.active })), [{ roomId: prior.roomId, active: 1 }]);
      const [opens] = await pool.execute<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM relay_opens WHERE owner_id=?', [owner]);
      assert.equal(Number(opens[0].total), 1);
      fail = false; assert.ok(await store.open(owner, request('recovered-rotation')));
    });

    await t.test('temporary connection acquisition failure neither fences nor permanently disables existing rooms', async () => {
      await reset(); await initializeMySqlRelayStore(pool); let exhaustOnce = false;
      const pressured = { getConnection: async () => {
        if (exhaustOnce) { exhaustOnce = false; throw new Error('synthetic pool capacity'); }
        return pool.getConnection();
      } } as unknown as Pool;
      const store = new MySqlRelayStore(pressured, { now: () => 1000 }); await store.initializeRuntime();
      const owner = randomUUID(), prior = await store.open(owner, request()), fenced: string[] = [];
      store.onFence(room => fenced.push(room.roomId)); exhaustOnce = true;
      await assert.rejects(store.lookup(prior.slug), code(503));
      assert.equal(store.isAvailable(), true); assert.deepEqual(fenced, []);
      assert.equal((await store.assertActive(owner, prior)).active, true);
    });

    await t.test('lost COMMIT acknowledgement latches availability and fences observers even if rollback succeeds', async () => {
      await reset(); await initializeMySqlRelayStore(pool); let loseAcknowledgement = false;
      const uncertain = { getConnection: async () => {
        const connection = await pool.getConnection();
        return new Proxy(connection, { get(target, property) {
          if (property === 'commit') return async () => {
            await target.commit();
            if (loseAcknowledgement) throw new Error('synthetic lost commit acknowledgement');
          };
          const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
        } }) as PoolConnection;
      } } as unknown as Pool;
      const store = new MySqlRelayStore(uncertain, { now: () => 1000 });
      assert.equal(store.isAvailable(), false); await store.initializeRuntime();
      const owner = randomUUID(), prior = await store.open(owner, request()), fences: string[] = [];
      store.onFence(room => fences.push(room.roomId)); loseAcknowledgement = true;
      await assert.rejects(store.open(owner, request('uncertain-rotation')), code(503));
      assert.equal(store.isAvailable(), false); assert.ok(fences.includes(prior.roomId));
      await assert.rejects(store.assertActive(owner, prior), code(503));
      const [active] = await pool.execute<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM relay_leases WHERE owner_id=? AND active=1', [owner]);
      assert.equal(Number(active[0].total), 1, 'the server committed, but the local relay must stay fenced');
    });

    await t.test('unrelated tables or unsupported schema versions are never adopted or updated', async () => {
      await reset(); await pool.query('CREATE TABLE unrelated(id INT PRIMARY KEY,value VARCHAR(32)) ENGINE=InnoDB');
      await pool.query("INSERT INTO unrelated(id,value) VALUES(1,'preserve-me')");
      await assert.rejects(initializeMySqlRelayStore(pool), code(503, 'unsupported-store'));
      await assert.rejects(new MySqlRelayStore(pool).initializeRuntime(), code(503, 'unsupported-store'));
      const [rows] = await pool.query<(RowDataPacket & { value: string })[]>('SELECT value FROM unrelated WHERE id=1'); assert.equal(rows[0].value, 'preserve-me');
      const [tables] = await pool.query<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()');
      assert.equal(Number(tables[0].total), 1); await pool.query('DROP TABLE unrelated');
      const store = await fresh(), owner = randomUUID(), opened = await store.open(owner, request());
      await pool.query('UPDATE relay_version SET version=99 WHERE id=1');
      await assert.rejects(initializeMySqlRelayStore(pool), code(503, 'unsupported-store'));
      await assert.rejects(new MySqlRelayStore(pool).initializeRuntime(), code(503, 'unsupported-store'));
      const [active] = await pool.execute<(RowDataPacket & { active: number })[]>('SELECT active FROM relay_leases WHERE room_id=?', [opened.roomId]);
      assert.equal(active[0].active, 1);
    });

    await t.test('invalid identities and unsafe persisted timestamps fail closed without guest data storage', async () => {
      const store = await fresh();
      await assert.rejects(store.open('not-uuid', request()), code(400));
      await assert.rejects(store.open(randomUUID(), request('admin')), code(400));
      const owner = randomUUID(), room = await store.open(owner, request());
      await pool.execute('UPDATE relay_leases SET expires_at=? WHERE room_id=?', ['9007199254740992', room.roomId]);
      await assert.rejects(store.lookup(room.slug), code(503, 'store-unavailable'));
      await assert.rejects(store.open(owner, request('after-corruption')), code(503));
      const [columns] = await pool.query<(RowDataPacket & { name: string })[]>('SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
      assert.equal(columns.some(column => /token|payload|session|secret|response|notes|path/i.test(column.name)), false);
    });
  } finally { await reset(); await pool.end(); }
});

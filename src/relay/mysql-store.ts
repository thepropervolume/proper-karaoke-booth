/** MySQL 8 relay metadata only. Guest credentials, payloads and replies are never persisted here. */
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { isRelaySlug, isRelayUuid, type HostOpen, type RoomIdentity } from './protocol';
import { RelayError, type HostOpenResult, type RelayStoreApi, type RoomLease } from './store';

const TABLES = ['relay_version', 'relay_owners', 'relay_leases', 'relay_opens'] as const;
type LeaseRow = RowDataPacket & { slug: string; owner_id: string; room_id: string; generation: string; expires_at: string | number; active: number };
type OpenRow = RowDataPacket & { slug: string; room_id: string; generation: string; expires_at: string | number };
type Options = { now?: () => number; publicOrigin?: string; leaseMs?: number; retainedOwnerIds?: readonly string[] };
type Column = { name: string; type: string; nullable: string; length: number | string | null; collation: string | null; extra: string; generated_sql: string };
const COLUMNS: Record<typeof TABLES[number], readonly [string, string, boolean, number?][]> = {
  relay_version: [['id', 'tinyint', false], ['version', 'int', false]],
  relay_owners: [['owner_id', 'char', false, 36]],
  relay_leases: [['slug', 'varchar', false, 48], ['owner_id', 'char', false, 36], ['room_id', 'char', false, 36],
    ['generation', 'char', false, 36], ['expires_at', 'bigint', false], ['active', 'tinyint', false], ['active_owner', 'char', true, 36]],
  relay_opens: [['owner_id', 'char', false, 36], ['open_id', 'char', false, 36], ['slug', 'varchar', false, 48],
    ['room_id', 'char', false, 36], ['generation', 'char', false, 36], ['expires_at', 'bigint', false]],
};
const UNIQUE: Record<typeof TABLES[number], readonly string[][]> = {
  relay_version: [['id']], relay_owners: [['owner_id']],
  relay_leases: [['slug'], ['room_id'], ['active_owner']], relay_opens: [['owner_id', 'open_id']],
};
const failure = () => new RelayError(503, 'store-unavailable');
function millis(value: unknown): number {
  if (!(typeof value === 'number' || typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value))) throw failure();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw failure();
  return number;
}
async function schemaObjects(connection: PoolConnection): Promise<{ name: string; kind: string; engine: string | null }[]> {
  const [tables] = await connection.query<(RowDataPacket & { name: string; kind: string; engine: string | null })[]>(
    'SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,ENGINE AS engine FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  return tables;
}
async function validateSchema(connection: PoolConnection): Promise<void> {
  const [identity] = await connection.query<(RowDataPacket & { version: string; charset: string })[]>(
    'SELECT VERSION() AS version,DEFAULT_CHARACTER_SET_NAME AS charset FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=DATABASE()');
  if (identity.length !== 1 || !/^8\./.test(identity[0].version) || identity[0].charset !== 'utf8mb4') throw new RelayError(503, 'unsupported-store');
  const tables = await schemaObjects(connection);
  if (tables.length !== TABLES.length || tables.some(table => !(TABLES as readonly string[]).includes(table.name) || table.kind !== 'BASE TABLE' || table.engine !== 'InnoDB'))
    throw new RelayError(503, 'unsupported-store');
  const [triggers] = await connection.query<(RowDataPacket & { total: string | number })[]>(
    'SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()');
  if (Number(triggers[0]?.total) !== 0) throw new RelayError(503, 'unsupported-store');
  for (const table of TABLES) {
    const [columns] = await connection.execute<(RowDataPacket & Column)[]>(`SELECT COLUMN_NAME AS name,DATA_TYPE AS type,IS_NULLABLE AS nullable,
      CHARACTER_MAXIMUM_LENGTH AS length,COLLATION_NAME AS collation,EXTRA AS extra,GENERATION_EXPRESSION AS generated_sql
      FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [table]);
    const expected = COLUMNS[table];
    if (columns.length !== expected.length || columns.some((column, index) => {
      const [name, type, nullable, length] = expected[index];
      return column.name !== name || column.type !== type || column.nullable !== (nullable ? 'YES' : 'NO') ||
        (length !== undefined && (Number(column.length) !== length || column.collation !== 'ascii_bin')) ||
        (name === 'active_owner' ? !column.extra.includes('STORED GENERATED') ||
          column.generated_sql.toLowerCase().replace(/[\s`()]/g, '') !== 'casewhenactive=1thenowner_idelsenullend' : column.generated_sql !== '');
    })) throw new RelayError(503, 'unsupported-store');
    const [indexes] = await connection.execute<(RowDataPacket & { name: string; non_unique: number; sequence: number; column_name: string })[]>(
      `SELECT INDEX_NAME AS name,NON_UNIQUE AS non_unique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS column_name
       FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX`, [table]);
    const unique = new Map<string, string[]>();
    for (const index of indexes) if (Number(index.non_unique) === 0) {
      const fields = unique.get(index.name) ?? []; fields.push(index.column_name); unique.set(index.name, fields);
    }
    const actual = [...unique.values()].map(fields => fields.join(',')).sort(), required = UNIQUE[table].map(fields => fields.join(',')).sort();
    if (JSON.stringify(actual) !== JSON.stringify(required)) throw new RelayError(503, 'unsupported-store');
  }
  const [versions] = await connection.query<(RowDataPacket & { id: number; version: number })[]>('SELECT id,version FROM relay_version');
  if (versions.length !== 1 || versions[0].id !== 1 || versions[0].version !== 1) throw new RelayError(503, 'unsupported-store');
}

/** Explicit operator-only DDL. An incomplete or unrelated schema is never adopted or modified. */
export async function initializeMySqlRelayStore(pool: Pool): Promise<void> {
  const connection = await pool.getConnection(); let lock: string | undefined, destroy = false;
  try {
    const [identity] = await connection.query<(RowDataPacket & { name: string; version: string; charset: string })[]>(
      'SELECT DATABASE() AS name,VERSION() AS version,DEFAULT_CHARACTER_SET_NAME AS charset FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=DATABASE()');
    if (identity.length !== 1 || !identity[0].name || !/^8\./.test(identity[0].version) || identity[0].charset !== 'utf8mb4') throw new RelayError(503, 'unsupported-store');
    const key = 'tpv-relay-init-' + createHash('sha256').update(identity[0].name).digest('hex').slice(0, 32);
    const [locks] = await connection.execute<(RowDataPacket & { acquired: string | number | null })[]>('SELECT GET_LOCK(?,5) AS acquired', [key]);
    if (Number(locks[0]?.acquired) !== 1) throw failure();
    lock = key;
    const existing = await schemaObjects(connection);
    if (existing.length) { await validateSchema(connection); return; }
    const [objects] = await connection.query<(RowDataPacket & { total: string | number })[]>(`SELECT
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE())+
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA=DATABASE()) AS total`);
    if (Number(objects[0]?.total) !== 0) throw new RelayError(503, 'unsupported-store');
    // DDL commits implicitly. Insert the schema marker last so a partial failure
    // remains unrecognized and requires explicit operator recovery.
    await connection.query('CREATE TABLE relay_version (id TINYINT UNSIGNED NOT NULL PRIMARY KEY,version INT NOT NULL,CHECK(id=1)) ENGINE=InnoDB');
    await connection.query('CREATE TABLE relay_owners (owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY) ENGINE=InnoDB');
    await connection.query(`CREATE TABLE relay_leases (
      slug VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      room_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      generation CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      expires_at BIGINT UNSIGNED NOT NULL,active TINYINT UNSIGNED NOT NULL,
      active_owner CHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN active=1 THEN owner_id ELSE NULL END) STORED,
      UNIQUE KEY relay_room_id(room_id),UNIQUE KEY relay_active_owner(active_owner),KEY relay_lease_owner(owner_id),
      CONSTRAINT relay_lease_owner_fk FOREIGN KEY(owner_id) REFERENCES relay_owners(owner_id),CHECK(active IN(0,1))
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE relay_opens (
      owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      open_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      slug VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      room_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      generation CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,expires_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY(owner_id,open_id),CONSTRAINT relay_open_owner_fk FOREIGN KEY(owner_id) REFERENCES relay_owners(owner_id)
    ) ENGINE=InnoDB`);
    await connection.query('INSERT INTO relay_version(id,version) VALUES(1,1)');
    await validateSchema(connection);
  } catch (error) { throw error instanceof RelayError ? error : failure(); }
  finally {
    if (lock) try {
      const [released] = await connection.execute<(RowDataPacket & { released: string | number | null })[]>('SELECT RELEASE_LOCK(?) AS released', [lock]);
      if (Number(released[0]?.released) !== 1) destroy = true;
    } catch { destroy = true; }
    if (destroy) connection.destroy(); else connection.release();
  }
}

export class MySqlRelayStore implements RelayStoreApi {
  readonly now: () => number;
  private readonly origin: string;
  private readonly leaseMs: number;
  private readonly retainedOwnerIds: readonly string[];
  private readonly listeners = new Set<(identity: RoomIdentity) => void>();
  private readonly known = new Map<string, string>();
  private ready = false;
  private failed = false;
  private initialization?: Promise<void>;
  constructor(private readonly pool: Pool, options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 12 * 60 * 60 * 1000;
    if (options.retainedOwnerIds !== undefined && (!Array.isArray(options.retainedOwnerIds) || options.retainedOwnerIds.length > 100 || !options.retainedOwnerIds.every(isRelayUuid)))
      throw new RelayError(400, 'invalid-configuration');
    this.retainedOwnerIds = [...new Set(options.retainedOwnerIds ?? [])];
    let origin: URL;
    try { origin = new URL(options.publicOrigin ?? 'https://queue.thepropervolume.com'); }
    catch { throw new RelayError(400, 'invalid-configuration'); }
    if (origin.protocol !== 'https:' || origin.origin !== (options.publicOrigin ?? origin.origin) || origin.port ||
        !Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1 || this.leaseMs > 12 * 60 * 60 * 1000) throw new RelayError(400, 'invalid-configuration');
    this.origin = origin.origin;
  }
  onFence(listener: (identity: RoomIdentity) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  isAvailable(): boolean { return this.ready && !this.failed; }
  private fence(identities: readonly RoomIdentity[]): void {
    for (const identity of identities) {
      this.known.delete(identity.roomId);
      for (const listener of this.listeners) try { listener({ roomId: identity.roomId, generation: identity.generation }); } catch { /* Continue fencing every observer. */ }
    }
  }
  private latch(): void {
    this.failed = true;
    this.fence([...this.known].map(([roomId, generation]) => ({ roomId, generation })));
  }
  private clock(): number { const now = this.now(); if (!Number.isSafeInteger(now) || now < 0) throw new RelayError(503, 'clock-unavailable'); return now; }
  private running(): void { if (!this.ready || this.failed) throw failure(); }
  private owner(ownerId: unknown): asserts ownerId is string { if (!isRelayUuid(ownerId)) throw new RelayError(400, 'invalid-owner'); }
  private identity(identity: RoomIdentity): void { if (!identity || !isRelayUuid(identity.roomId) || !isRelayUuid(identity.generation)) throw new RelayError(400, 'invalid-room'); }
  private row(row: LeaseRow): RoomLease {
    if (!isRelaySlug(row.slug) || !isRelayUuid(row.owner_id) || !isRelayUuid(row.room_id) || !isRelayUuid(row.generation) || (row.active !== 0 && row.active !== 1)) throw failure();
    return { slug: row.slug, ownerId: row.owner_id, roomId: row.room_id, generation: row.generation, expiresAt: millis(row.expires_at), active: row.active === 1 };
  }
  private async transaction<T>(work: (connection: PoolConnection, fenced: RoomIdentity[]) => Promise<T>, startup = false): Promise<T> {
    if (!startup) this.running();
    let connection: PoolConnection | undefined, active = false, destroy = false, beginAttempted = false, commitAttempted = false;
    const fenced: RoomIdentity[] = [];
    try {
      connection = await this.pool.getConnection();
      await connection.query('SET SESSION innodb_lock_wait_timeout=5');
      beginAttempted = true; await connection.beginTransaction(); active = true;
      const [version] = await connection.query<(RowDataPacket & { version: number })[]>('SELECT version FROM relay_version WHERE id=1 FOR UPDATE');
      if (version.length !== 1 || version[0].version !== 1) throw failure();
      const value = await work(connection, fenced);
      commitAttempted = true; await connection.commit(); active = false;
      this.fence(fenced);
      return value;
    } catch (error) {
      if (active && connection) try { await connection.rollback(); } catch { destroy = true; this.latch(); }
      // Acquisition/lock/SQL failures before COMMIT with a confirmed rollback
      // have no durable effect. Preserve existing rooms on transient pressure.
      // A failed COMMIT may have applied despite its missing acknowledgement.
      if (commitAttempted) { destroy = true; this.latch(); }
      if (beginAttempted && !active && !commitAttempted) destroy = true;
      if (!(error instanceof RelayError)) throw failure();
      if (error.code === 'store-unavailable' || error.code === 'unsupported-store') this.latch();
      throw error;
    } finally { if (connection) { if (destroy) connection.destroy(); else connection.release(); } }
  }
  private async expireIn(connection: PoolConnection, fenced: RoomIdentity[], now: number): Promise<void> {
    const [expired] = await connection.execute<LeaseRow[]>('SELECT slug,owner_id,room_id,generation,expires_at,active FROM relay_leases WHERE expires_at<=? FOR UPDATE', [now]);
    for (const row of expired) { const lease = this.row(row); fenced.push({ roomId: lease.roomId, generation: lease.generation }); }
    if (expired.length) await connection.execute('DELETE FROM relay_leases WHERE expires_at<=?', [now]);
    await connection.execute('DELETE FROM relay_opens WHERE expires_at<=?', [now - this.leaseMs]);
    // Anonymous owners are disposable, but an inactive lease still reserves its
    // slug and a retained open still prevents a delayed retry from resurrecting
    // a room. The existing global transaction lock serializes cleanup with open.
    // Explicit configured owners are retained even if their UUID uses the prefix.
    const retain = this.retainedOwnerIds.length ? ` AND owners.owner_id NOT IN (${this.retainedOwnerIds.map(() => '?').join(',')})` : '';
    await connection.execute(`DELETE owners FROM relay_owners AS owners
      LEFT JOIN relay_leases AS leases ON leases.owner_id=owners.owner_id
      LEFT JOIN relay_opens AS opens ON opens.owner_id=owners.owner_id
      WHERE owners.owner_id LIKE 'f17e0001-%' AND leases.owner_id IS NULL AND opens.owner_id IS NULL${retain}`, [...this.retainedOwnerIds]);
  }
  /** Validate before any update, and invalidate all prior-process rooms before serving traffic. */
  initializeRuntime(): Promise<void> {
    return this.initialization ??= (async () => {
      let connection: PoolConnection | undefined;
      try { connection = await this.pool.getConnection(); await validateSchema(connection); }
      catch (error) { this.latch(); throw error instanceof RelayError ? error : failure(); }
      finally { connection?.release(); }
      await this.transaction(async (session, fenced) => {
        const [active] = await session.query<LeaseRow[]>('SELECT slug,owner_id,room_id,generation,expires_at,active FROM relay_leases WHERE active=1 FOR UPDATE');
        for (const row of active) { const lease = this.row(row); fenced.push({ roomId: lease.roomId, generation: lease.generation }); }
        await session.query('UPDATE relay_leases SET active=0 WHERE active=1');
        await this.expireIn(session, fenced, this.clock());
      }, true);
      this.ready = true;
    })();
  }
  async expire(): Promise<void> { await this.transaction(async (connection, fenced) => this.expireIn(connection, fenced, this.clock())); }
  async lookup(slug: string): Promise<RoomLease | null> {
    if (!isRelaySlug(slug)) throw new RelayError(400, 'invalid-slug');
    return this.transaction(async (connection, fenced) => {
      await this.expireIn(connection, fenced, this.clock());
      const [rows] = await connection.execute<LeaseRow[]>('SELECT slug,owner_id,room_id,generation,expires_at,active FROM relay_leases WHERE slug=?', [slug]);
      if (rows.length > 1) throw failure();
      const lease = rows[0] ? this.row(rows[0]) : null;
      if (lease?.active) this.known.set(lease.roomId, lease.generation);
      return lease;
    });
  }
  private async active(connection: PoolConnection, ownerId: string | undefined, identity: RoomIdentity, now: number): Promise<RoomLease> {
    const [rows] = await connection.execute<LeaseRow[]>('SELECT slug,owner_id,room_id,generation,expires_at,active FROM relay_leases WHERE room_id=? AND generation=? FOR UPDATE', [identity.roomId, identity.generation]);
    if (rows.length !== 1) throw new RelayError(410, 'room-ended');
    const lease = this.row(rows[0]);
    if (ownerId !== undefined && ownerId !== lease.ownerId) throw new RelayError(403, 'owner-forbidden');
    if (!lease.active || lease.expiresAt <= now) throw new RelayError(410, 'room-ended');
    return lease;
  }
  async assertActive(ownerId: string | undefined, identity: RoomIdentity): Promise<RoomLease> {
    this.identity(identity); if (ownerId !== undefined) this.owner(ownerId);
    return this.transaction(async (connection, fenced) => {
      const now = this.clock(); await this.expireIn(connection, fenced, now);
      const lease = await this.active(connection, ownerId, identity, now);
      this.known.set(lease.roomId, lease.generation); return lease;
    });
  }
  async open(ownerId: string, input: HostOpen): Promise<HostOpenResult> {
    this.owner(ownerId);
    if (!input || !isRelaySlug(input.slug) || !isRelayUuid(input.openId)) throw new RelayError(400, 'invalid-open');
    return this.transaction(async (connection, fenced) => {
      const now = this.clock(); await this.expireIn(connection, fenced, now);
      await connection.execute('INSERT INTO relay_owners(owner_id) VALUES(?) ON DUPLICATE KEY UPDATE owner_id=owner_id', [ownerId]);
      await connection.execute('SELECT owner_id FROM relay_owners WHERE owner_id=? FOR UPDATE', [ownerId]);
      const [prior] = await connection.execute<OpenRow[]>('SELECT slug,room_id,generation,expires_at FROM relay_opens WHERE owner_id=? AND open_id=? FOR UPDATE', [ownerId, input.openId]);
      if (prior.length) {
        if (prior.length !== 1 || prior[0].slug !== input.slug) throw new RelayError(409, 'open-conflict');
        if (!isRelayUuid(prior[0].room_id) || !isRelayUuid(prior[0].generation)) throw failure();
        const lease = await this.active(connection, ownerId, { roomId: prior[0].room_id, generation: prior[0].generation }, now);
        this.known.set(lease.roomId, lease.generation); return this.result(lease);
      }
      const [occupied] = await connection.execute<LeaseRow[]>('SELECT slug,owner_id,room_id,generation,expires_at,active FROM relay_leases WHERE slug=? FOR UPDATE', [input.slug]);
      if (occupied[0] && this.row(occupied[0]).ownerId !== ownerId) throw new RelayError(409, 'slug-unavailable');
      if (!occupied.length) {
        const [ownerCount] = await connection.execute<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM relay_leases WHERE owner_id=?', [ownerId]);
        const [globalCount] = await connection.query<(RowDataPacket & { total: string | number })[]>('SELECT COUNT(*) AS total FROM relay_leases');
        const mobile = ownerId.startsWith('f17e0001-');
        if (millis(ownerCount[0]?.total) >= (mobile ? 1 : 4)) throw new RelayError(429, 'owner-reservation-limit');
        if (mobile) {
          const [mobileCount] = await connection.query<(RowDataPacket & { total: string | number })[]>("SELECT COUNT(*) AS total FROM relay_leases WHERE owner_id LIKE 'f17e0001-%'");
          if (millis(mobileCount[0]?.total) >= 50) throw new RelayError(503, 'mobile-reservation-capacity');
        }
        if (millis(globalCount[0]?.total) >= 200) throw new RelayError(503, 'reservation-capacity');
      }
      const [old] = await connection.execute<LeaseRow[]>('SELECT slug,owner_id,room_id,generation,expires_at,active FROM relay_leases WHERE owner_id=? AND active=1 FOR UPDATE', [ownerId]);
      for (const row of old) { const lease = this.row(row); fenced.push({ roomId: lease.roomId, generation: lease.generation }); }
      const expiresAt = now + this.leaseMs; if (!Number.isSafeInteger(expiresAt)) throw new RelayError(503, 'clock-unavailable');
      const roomId = randomUUID(), generation = randomUUID();
      await connection.execute('UPDATE relay_leases SET active=0 WHERE owner_id=? AND active=1', [ownerId]);
      await connection.execute(`INSERT INTO relay_leases(slug,owner_id,room_id,generation,expires_at,active) VALUES(?,?,?,?,?,1)
        ON DUPLICATE KEY UPDATE owner_id=VALUES(owner_id),room_id=VALUES(room_id),generation=VALUES(generation),expires_at=VALUES(expires_at),active=1`,
      [input.slug, ownerId, roomId, generation, expiresAt]);
      await connection.execute('INSERT INTO relay_opens(owner_id,open_id,slug,room_id,generation,expires_at) VALUES(?,?,?,?,?,?)', [ownerId, input.openId, input.slug, roomId, generation, expiresAt]);
      const lease: RoomLease = { ownerId, slug: input.slug, roomId, generation, expiresAt, active: true };
      this.known.set(roomId, generation); return this.result(lease);
    });
  }
  private result(lease: RoomLease): HostOpenResult {
    return { roomId: lease.roomId, generation: lease.generation, slug: lease.slug, publicUrl: `${this.origin}/${lease.slug}`, expiresAt: lease.expiresAt, pollAfterMs: 0 };
  }
  async close(ownerId: string, identity: RoomIdentity): Promise<void> {
    this.owner(ownerId); this.identity(identity);
    await this.transaction(async (connection, fenced) => {
      const now = this.clock(); await this.expireIn(connection, fenced, now); await this.active(connection, ownerId, identity, now);
      const [result] = await connection.execute<ResultSetHeader>('UPDATE relay_leases SET active=0 WHERE room_id=? AND generation=? AND owner_id=?', [identity.roomId, identity.generation, ownerId]);
      if (result.affectedRows !== 1) throw failure();
      fenced.push({ roomId: identity.roomId, generation: identity.generation });
    });
  }
  async deactivateAll(): Promise<void> {
    await this.transaction(async (connection, fenced) => {
      const [rows] = await connection.query<LeaseRow[]>('SELECT slug,owner_id,room_id,generation,expires_at,active FROM relay_leases WHERE active=1 FOR UPDATE');
      for (const row of rows) { const lease = this.row(row); fenced.push({ roomId: lease.roomId, generation: lease.generation }); }
      await connection.query('UPDATE relay_leases SET active=0 WHERE active=1');
    });
  }
}

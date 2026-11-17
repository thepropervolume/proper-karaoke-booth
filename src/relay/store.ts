/** Durable room leases only. Guest credentials, payloads and replies never enter SQLite. */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isRelaySlug, isRelayUuid, type HostOpen, type RoomIdentity } from './protocol';

export class RelayError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'RelayError'; }
}
export type RoomLease = RoomIdentity & { ownerId: string; slug: string; expiresAt: number; active: boolean };
export type HostOpenResult = RoomIdentity & { slug: string; publicUrl: string; expiresAt: number; pollAfterMs: 0 };
/** Production adapters may use an asynchronous shared database. */
export interface RelayStoreApi {
  readonly now: () => number;
  onFence(listener: (room: RoomIdentity) => void): () => void;
  expire(): void | Promise<void>;
  lookup(slug: string): RoomLease | null | Promise<RoomLease | null>;
  assertActive(ownerId: string | undefined, identity: RoomIdentity): RoomLease | Promise<RoomLease>;
  open(ownerId: string, input: HostOpen): HostOpenResult | Promise<HostOpenResult>;
  close(ownerId: string, identity: RoomIdentity): void | Promise<void>;
  deactivateAll(): void | Promise<void>;
}
type LeaseRow = { owner_id: string; slug: string; room_id: string; generation: string; expires_at: number; active: number };
type OpenRow = { slug: string; room_id: string; generation: string; expires_at: number };
type Options = { now?: () => number; publicOrigin?: string; leaseMs?: number; uuid?: () => string };

export class RelayStore {
  readonly now: () => number;
  private readonly origin: string;
  private readonly leaseMs: number;
  private readonly uuid: () => string;
  private readonly listeners = new Set<(room: RoomIdentity) => void>();

  constructor(private readonly db: DatabaseSync, options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 12 * 60 * 60 * 1000;
    this.uuid = options.uuid ?? randomUUID;
    const origin = new URL(options.publicOrigin ?? 'https://queue.thepropervolume.com');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
        !Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1 || this.leaseMs > 12 * 60 * 60 * 1000) throw new RelayError(400, 'invalid-configuration');
    this.origin = origin.origin;
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const objects = db.prepare("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all() as { name: string; type: string }[];
    const fresh = version === 0 && objects.length === 0;
    const expected: Record<string, readonly string[]> = {
      relay_leases: ['slug', 'owner_id', 'room_id', 'generation', 'expires_at', 'active'],
      relay_opens: ['owner_id', 'open_id', 'slug', 'room_id', 'generation', 'expires_at'],
    };
    if (!fresh) {
      const tables = objects.filter(object => object.type === 'table');
      if (version !== 1 || tables.length !== 2 || tables.some(table => !Object.hasOwn(expected, table.name)) ||
          objects.some(object => object.type !== 'table' && !(object.type === 'index' && object.name === 'relay_active_owner')))
        throw new RelayError(503, 'unsupported-store');
      for (const [table, columns] of Object.entries(expected)) {
        const actual = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
        if (actual.length !== columns.length || columns.some((name, index) => actual[index].name !== name))
          throw new RelayError(503, 'unsupported-store');
      }
    }
    db.exec('PRAGMA foreign_keys=ON');
    this.transaction(() => {
      if (fresh) db.exec(`CREATE TABLE relay_leases (
        slug TEXT NOT NULL PRIMARY KEY, owner_id TEXT NOT NULL, room_id TEXT NOT NULL UNIQUE,
        generation TEXT NOT NULL, expires_at INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1))
      );
      CREATE UNIQUE INDEX relay_active_owner ON relay_leases(owner_id) WHERE active=1;
      CREATE TABLE relay_opens (
        owner_id TEXT NOT NULL, open_id TEXT NOT NULL, slug TEXT NOT NULL, room_id TEXT NOT NULL,
        generation TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(owner_id,open_id)
      );
      PRAGMA user_version=1;`);
      db.exec('UPDATE relay_leases SET active=0 WHERE active=1');
    });
    this.expire();
  }

  onFence(listener: (room: RoomIdentity) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private fence(rooms: readonly RoomIdentity[]): void {
    for (const room of rooms) for (const listener of this.listeners) listener(room);
  }
  private clock(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new RelayError(503, 'clock-unavailable');
    return now;
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }
  expire(): void {
    const now = this.clock();
    const expired = this.db.prepare('SELECT room_id AS roomId,generation FROM relay_leases WHERE expires_at<=?').all(now) as RoomIdentity[];
    if (expired.length) {
      this.transaction(() => { this.db.prepare('DELETE FROM relay_leases WHERE expires_at<=?').run(now); });
      this.fence(expired);
    }
    // Keep closed/open retry tombstones for another lease interval. They contain
    // UUIDs only and prevent a delayed retry from resurrecting an expired room.
    this.db.prepare('DELETE FROM relay_opens WHERE expires_at<=?').run(now - this.leaseMs);
  }
  private row(row: LeaseRow): RoomLease {
    return { slug: row.slug, ownerId: row.owner_id, roomId: row.room_id, generation: row.generation,
      expiresAt: row.expires_at, active: row.active === 1 };
  }
  private owner(ownerId: string): void { if (!isRelayUuid(ownerId)) throw new RelayError(400, 'invalid-owner'); }
  private identity(identity: RoomIdentity): void {
    if (!identity || !isRelayUuid(identity.roomId) || !isRelayUuid(identity.generation)) throw new RelayError(400, 'invalid-room');
  }
  lookup(slug: string): RoomLease | null {
    if (!isRelaySlug(slug)) throw new RelayError(400, 'invalid-slug');
    this.expire();
    const row = this.db.prepare('SELECT * FROM relay_leases WHERE slug=?').get(slug) as LeaseRow | undefined;
    return row ? this.row(row) : null;
  }
  assertActive(ownerId: string | undefined, identity: RoomIdentity): RoomLease {
    this.identity(identity); if (ownerId !== undefined) this.owner(ownerId);
    this.expire();
    const row = this.db.prepare('SELECT * FROM relay_leases WHERE room_id=? AND generation=?').get(identity.roomId, identity.generation) as LeaseRow | undefined;
    if (!row) throw new RelayError(410, 'room-ended');
    if (ownerId !== undefined && row.owner_id !== ownerId) throw new RelayError(403, 'owner-forbidden');
    if (row.active !== 1) throw new RelayError(410, 'room-ended');
    return this.row(row);
  }
  open(ownerId: string, input: HostOpen): HostOpenResult {
    this.owner(ownerId);
    if (!input || !isRelaySlug(input.slug) || !isRelayUuid(input.openId)) throw new RelayError(400, 'invalid-open');
    this.expire();
    const prior = this.db.prepare('SELECT slug,room_id,generation,expires_at FROM relay_opens WHERE owner_id=? AND open_id=?').get(ownerId, input.openId) as OpenRow | undefined;
    if (prior) {
      if (prior.slug !== input.slug) throw new RelayError(409, 'open-conflict');
      const lease = this.assertActive(ownerId, { roomId: prior.room_id, generation: prior.generation });
      return this.result(lease);
    }
    const expiresAt = this.clock() + this.leaseMs;
    if (!Number.isSafeInteger(expiresAt)) throw new RelayError(503, 'clock-unavailable');
    const roomId = this.uuid(), generation = this.uuid();
    if (!isRelayUuid(roomId) || !isRelayUuid(generation)) throw new RelayError(503, 'identity-unavailable');
    let fenced: RoomIdentity[] = [];
    const lease = this.transaction(() => {
      const occupied = this.db.prepare('SELECT * FROM relay_leases WHERE slug=?').get(input.slug) as LeaseRow | undefined;
      if (occupied && occupied.owner_id !== ownerId) throw new RelayError(409, 'slug-unavailable');
      if (!occupied) {
        const count = Number((this.db.prepare('SELECT COUNT(*) AS total FROM relay_leases WHERE owner_id=?').get(ownerId) as { total: number }).total);
        const mobile = ownerId.startsWith('f17e0001-');
        if (count >= (mobile ? 1 : 4)) throw new RelayError(429, 'owner-reservation-limit');
        if (mobile && Number((this.db.prepare("SELECT COUNT(*) AS total FROM relay_leases WHERE owner_id LIKE 'f17e0001-%'").get() as { total: number }).total) >= 50)
          throw new RelayError(503, 'mobile-reservation-capacity');
        if (Number((this.db.prepare('SELECT COUNT(*) AS total FROM relay_leases').get() as { total: number }).total) >= 200)
          throw new RelayError(503, 'reservation-capacity');
      }
      fenced = this.db.prepare('SELECT room_id AS roomId,generation FROM relay_leases WHERE owner_id=? AND active=1').all(ownerId) as RoomIdentity[];
      this.db.prepare('UPDATE relay_leases SET active=0 WHERE owner_id=? AND active=1').run(ownerId);
      this.db.prepare(`INSERT INTO relay_leases(slug,owner_id,room_id,generation,expires_at,active) VALUES(?,?,?,?,?,1)
        ON CONFLICT(slug) DO UPDATE SET owner_id=excluded.owner_id,room_id=excluded.room_id,generation=excluded.generation,expires_at=excluded.expires_at,active=1`)
        .run(input.slug, ownerId, roomId, generation, expiresAt);
      this.db.prepare('INSERT INTO relay_opens(owner_id,open_id,slug,room_id,generation,expires_at) VALUES(?,?,?,?,?,?)')
        .run(ownerId, input.openId, input.slug, roomId, generation, expiresAt);
      return { ownerId, slug: input.slug, roomId, generation, expiresAt, active: true };
    });
    this.fence(fenced);
    return this.result(lease);
  }
  private result(lease: RoomLease): HostOpenResult {
    return { roomId: lease.roomId, generation: lease.generation, slug: lease.slug,
      publicUrl: `${this.origin}/${lease.slug}`, expiresAt: lease.expiresAt, pollAfterMs: 0 };
  }
  close(ownerId: string, identity: RoomIdentity): void {
    this.assertActive(ownerId, identity);
    this.db.prepare('UPDATE relay_leases SET active=0 WHERE room_id=? AND generation=?').run(identity.roomId, identity.generation);
    this.fence([identity]);
  }
  deactivateAll(): void {
    const active = this.db.prepare('SELECT room_id AS roomId,generation FROM relay_leases WHERE active=1').all() as RoomIdentity[];
    this.db.exec('UPDATE relay_leases SET active=0 WHERE active=1');
    this.fence(active);
  }
}

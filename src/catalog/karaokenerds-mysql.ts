/** Shared MySQL 8 catalog storage. Upstream credentials never belong in this database. */
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { parseCommunityCatalog, type CommunityCatalog } from './karaokenerds';
import type { CatalogMetadata } from './karaokenerds-http';
import { validateSQLiteExport, type CatalogMigrationExport } from './karaokenerds-migration-schema';

const DAY = 86_400_000;
const LOCK_NAME = 'tpv-karaoke-community-refresh-v1';
const SCHEMA_TABLES = ['tpv_kn_version', 'tpv_kn_state', 'tpv_kn_brands', 'tpv_kn_videos', 'tpv_kn_dates'];
type DbTime = string | number | null;
type StateRow = RowDataPacket & { snapshot: unknown | null; last_attempt_ms: DbTime; last_success_ms: DbTime; now_ms: DbTime;
  attempt_token: string | null; import_sha256: string | null; sqlite_retired_ms: DbTime };
export type SeededRefreshHandoff = { seedSha256: string; quiescenceVerifiedAtMs: number };
export type MySqlRefreshStatus = {
  status: 'updated' | 'not-due' | 'not-initialized' | 'in-progress' | 'recovery-required' | 'failed';
  lastAttempt: number | null; lastSuccess: number | null; nextAttempt: number | null;
};
export type SharedCatalogSnapshot = {
  catalog: CommunityCatalog;
  brandMappings: { slug: string; name: string; upstreamBrand: string; observedAt: number }[];
  videoMetadata: { youtubeId: string; brandSlug: string; producerTrackCode: string | null; codeSource: string | null }[];
  videoDates: { youtubeId: string; uploadDate: string | null; releaseDate: string | null; source: string; observedAt: number }[];
  revision: string;
  lastAttempt: number | null;
  lastSuccess: number | null;
};

function millis(value: DbTime): number | null {
  if (value === null) return null;
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) throw new Error('Invalid catalog timestamp.');
  return converted;
}
function result(status: MySqlRefreshStatus['status'], row: StateRow): MySqlRefreshStatus {
  const lastAttempt = millis(row.last_attempt_ms), lastSuccess = millis(row.last_success_ms);
  return { status, lastAttempt, lastSuccess, nextAttempt: lastAttempt === null ? null : lastAttempt + DAY };
}
function decodeSnapshot(value: unknown): CommunityCatalog {
  return parseCommunityCatalog(typeof value === 'string' ? JSON.parse(value) : value);
}
function serializeSeedSnapshot(catalog: CommunityCatalog): string {
  // MySQL JSON may reorder keys. Use the seed's field order when proving its identity.
  return JSON.stringify({ Items: catalog.Items.map(item => ({ Id: item.Id, Artist: item.Artist,
    Title: item.Title, Brand: item.Brand, Watch: item.Watch, Created: item.Created })) });
}
function validSeededHandoff(value: unknown): value is SeededRefreshHandoff {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'quiescenceVerifiedAtMs,seedSha256') return false;
  const handoff = value as Record<string, unknown>;
  return typeof handoff.seedSha256 === 'string' && /^[a-f0-9]{64}$/.test(handoff.seedSha256) &&
    typeof handoff.quiescenceVerifiedAtMs === 'number' && Number.isSafeInteger(handoff.quiescenceVerifiedAtMs) &&
    handoff.quiescenceVerifiedAtMs > 0 && handoff.quiescenceVerifiedAtMs <= Number.MAX_SAFE_INTEGER - DAY;
}
export function parseCatalogRefreshGate(value: unknown): SeededRefreshHandoff | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const gate = value as Record<string, unknown>, keys = Object.keys(gate).sort().join(',');
    if (gate.legacyUpdatersStopped === true && gate.singleUpdaterConfirmed === true) {
      if (keys === 'importAndCooldownVerified,legacyUpdatersStopped,singleUpdaterConfirmed' && gate.importAndCooldownVerified === true) return undefined;
      if (keys === 'legacyUpdatersStopped,seededHandoff,singleUpdaterConfirmed' && validSeededHandoff(gate.seededHandoff)) return gate.seededHandoff;
    }
  }
  throw new Error('Invalid catalog refresh gate.');
}
// UTC_TIMESTAMP is independent of the session time zone, including DST folds.
// TIMESTAMPDIFF compares UTC DATETIME values without interpreting local time.
const CLOCK = "CAST(TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', UTC_TIMESTAMP(3)) DIV 1000 AS UNSIGNED)";
const STATE = `SELECT snapshot, last_attempt_ms, last_success_ms, attempt_token, import_sha256, sqlite_retired_ms, ${CLOCK} AS now_ms FROM tpv_kn_state WHERE id = 1`;
async function queryState(connection: PoolConnection, lock = false): Promise<StateRow> {
  const [rows] = await connection.query<StateRow[]>(`${STATE}${lock ? ' FOR UPDATE' : ''}`);
  if (rows.length !== 1) throw new Error('Catalog state is unavailable.');
  return rows[0];
}
async function mutate<T>(pool: Pool, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection(); let transaction = false, destroy = false;
  try {
    await connection.beginTransaction(); transaction = true;
    const state = await queryState(connection, true);
    if (state.snapshot === null) throw new Error('Catalog is not initialized.');
    const value = await work(connection);
    await connection.query('UPDATE tpv_kn_state SET revision = revision + 1 WHERE id = 1');
    await connection.commit(); transaction = false;
    return value;
  } catch (error) { if (transaction) try { await connection.rollback(); } catch { destroy = true; } throw error; }
  finally { if (destroy) connection.destroy(); else connection.release(); }
}

/** Explicitly initialize an operator-provisioned, dedicated empty MySQL database. */
export async function initializeMySqlCatalog(pool: Pool): Promise<void> {
  const connection = await pool.getConnection(); let locked = false, destroy = false;
  try {
    const [locks] = await connection.query<(RowDataPacket & { acquired: number | string | null })[]>('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
    if (locks[0]?.acquired === null || locks[0]?.acquired === undefined) throw new Error('Catalog lock is unavailable.');
    if (Number(locks[0].acquired) !== 1) throw new Error('Catalog is busy.');
    locked = true;
    const [database] = await connection.query<(RowDataPacket & { charset: string })[]>(
      'SELECT DEFAULT_CHARACTER_SET_NAME AS charset FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = DATABASE()');
    if (database.length !== 1 || database[0].charset.toLowerCase() !== 'utf8mb4') throw new Error('Catalog database must use utf8mb4.');
    const [tables] = await connection.query<(RowDataPacket & { name: string })[]>(
      "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
    if (tables.some(table => !SCHEMA_TABLES.includes(table.name))) throw new Error('Catalog database is not dedicated.');
    if (tables.length) {
      if (tables.length !== SCHEMA_TABLES.length || !tables.some(table => table.name === 'tpv_kn_version')) throw new Error('Catalog initialization is incomplete or unrecognized.');
      const [versions] = await connection.query<(RowDataPacket & { version: number })[]>('SELECT version FROM tpv_kn_version WHERE id = 1');
      if (versions.length !== 1 || versions[0].version !== 1) throw new Error('Unsupported or incomplete catalog schema version.');
      // A versioned schema is left untouched; check the columns that v1 uses.
      for (const sql of [
        'SELECT id, version FROM tpv_kn_version WHERE 1 = 0',
        'SELECT id, snapshot, last_attempt_ms, last_success_ms, attempt_token, import_sha256, sqlite_retired_ms, revision FROM tpv_kn_state WHERE 1 = 0',
        'SELECT slug, display_name, upstream_brand, observed_at FROM tpv_kn_brands WHERE 1 = 0',
        'SELECT youtube_id, brand_slug, producer_track_code, code_source FROM tpv_kn_videos WHERE 1 = 0',
        'SELECT youtube_id, upload_date, release_date, source, observed_at FROM tpv_kn_dates WHERE 1 = 0',
      ]) await connection.query(sql);
      return;
    }
    // MySQL DDL commits implicitly. Keep the version marker empty until all
    // tables exist; incomplete initialization is rejected for manual review.
    await connection.query('CREATE TABLE IF NOT EXISTS tpv_kn_version (id TINYINT UNSIGNED NOT NULL PRIMARY KEY, version INT NOT NULL, CHECK (id = 1)) ENGINE=InnoDB');
    await connection.query(`CREATE TABLE IF NOT EXISTS tpv_kn_state (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY, snapshot JSON, last_attempt_ms BIGINT UNSIGNED,
      last_success_ms BIGINT UNSIGNED, attempt_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
      import_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin, sqlite_retired_ms BIGINT UNSIGNED,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 0, CHECK (id = 1)
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE IF NOT EXISTS tpv_kn_brands (
      slug VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL PRIMARY KEY,
      display_name VARCHAR(200) NOT NULL, upstream_brand VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL UNIQUE,
      observed_at BIGINT UNSIGNED NOT NULL
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE IF NOT EXISTS tpv_kn_videos (
      youtube_id CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      brand_slug VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
      producer_track_code VARCHAR(128), code_source VARCHAR(32),
      FOREIGN KEY (brand_slug) REFERENCES tpv_kn_brands(slug),
      CHECK ((producer_track_code IS NULL AND code_source IS NULL) OR (producer_track_code IS NOT NULL AND code_source IS NOT NULL))
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE IF NOT EXISTS tpv_kn_dates (
      youtube_id CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      upload_date CHAR(10) CHARACTER SET ascii, release_date CHAR(10) CHARACTER SET ascii,
      source VARCHAR(32) NOT NULL, observed_at BIGINT UNSIGNED NOT NULL,
      FOREIGN KEY (youtube_id) REFERENCES tpv_kn_videos(youtube_id)
    ) ENGINE=InnoDB`);
    await connection.query('INSERT IGNORE INTO tpv_kn_state (id) VALUES (1)');
    await connection.query('INSERT IGNORE INTO tpv_kn_version (id, version) VALUES (1, 1)');
  } finally {
    if (locked) { try { const [released] = await connection.query<(RowDataPacket & { released: number | string | null })[]>('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); if (Number(released[0]?.released) !== 1) destroy = true; } catch { destroy = true; } }
    if (destroy) connection.destroy(); else connection.release();
  }
}

export class MySqlCommunityCatalogStore {
  constructor(private readonly pool: Pool) {}

  async read(): Promise<CommunityCatalog | null> {
    const [rows] = await this.pool.query<(RowDataPacket & { snapshot: unknown | null })[]>('SELECT snapshot FROM tpv_kn_state WHERE id = 1');
    if (rows.length !== 1) throw new Error('Catalog state is unavailable.');
    return rows[0].snapshot === null ? null : decodeSnapshot(rows[0].snapshot);
  }
  async status(): Promise<{ lastAttempt: number | null; lastSuccess: number | null; nextAttempt: number | null; recoveryRequired: boolean }> {
    const connection = await this.pool.getConnection();
    try { const state = await queryState(connection); const { lastAttempt, lastSuccess, nextAttempt } = result('not-due', state); return { lastAttempt, lastSuccess, nextAttempt, recoveryRequired: state.attempt_token !== null }; }
    finally { connection.release(); }
  }

  /**
   * Publish an existing raw snapshot for reads when refresh history is missing.
   * Unknown attempt/success/retirement times remain NULL. In particular, the
   * refresh requires a separate, verified handoff before calling its fetcher.
   */
  async seedReadOnlyCatalog(input: unknown): Promise<void> {
    const parsed = parseCommunityCatalog(input);
    // Fixed field order gives the same digest for equivalent JSON input while
    // excluding unknown raw fields from the stored public metadata snapshot.
    const snapshot = serializeSeedSnapshot(parsed);
    const digest = createHash('sha256').update(snapshot, 'utf8').digest('hex');
    const connection = await this.pool.getConnection(); let transaction = false, destroy = false;
    try {
      await connection.beginTransaction(); transaction = true;
      const row = await queryState(connection, true);
      if (row.snapshot !== null || row.last_attempt_ms !== null || row.last_success_ms !== null || row.attempt_token !== null)
        throw new Error('Catalog is already initialized.');
      const [markers] = await connection.query<(RowDataPacket & { import_sha256: string | null; sqlite_retired_ms: DbTime; revision: string })[]>(
        'SELECT import_sha256, sqlite_retired_ms, CAST(revision AS CHAR) AS revision FROM tpv_kn_state WHERE id = 1');
      if (markers.length !== 1 || markers[0].import_sha256 !== null || markers[0].sqlite_retired_ms !== null || markers[0].revision !== '0')
        throw new Error('Catalog state is not empty.');
      const [tables] = await connection.query<(RowDataPacket & { name: string })[]>(
        "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
      const [versions] = await connection.query<(RowDataPacket & { version: number })[]>('SELECT version FROM tpv_kn_version WHERE id = 1');
      if (tables.length !== SCHEMA_TABLES.length || tables.some(table => !SCHEMA_TABLES.includes(table.name)) || versions.length !== 1 || versions[0].version !== 1)
        throw new Error('Catalog database is not dedicated and initialized.');
      for (const table of ['tpv_kn_brands', 'tpv_kn_videos', 'tpv_kn_dates']) {
        const [existing] = await connection.query<RowDataPacket[]>(`SELECT 1 AS present FROM ${table} LIMIT 1 FOR UPDATE`);
        if (existing.length) throw new Error('Catalog metadata tables are not empty.');
      }
      const [updated] = await connection.execute<ResultSetHeader>(
        'UPDATE tpv_kn_state SET snapshot = CAST(? AS JSON), import_sha256 = ?, revision = revision + 1 WHERE id = 1', [snapshot, digest]);
      if (updated.affectedRows !== 1) throw new Error('Catalog state is unavailable.');
      await connection.commit(); transaction = false;
    } catch (error) { if (transaction) try { await connection.rollback(); } catch { destroy = true; } throw error; }
    finally { if (destroy) connection.destroy(); else connection.release(); }
  }

  /** Import a verified, complete SQLite export into an empty dedicated database. */
  async importCatalog(input: unknown): Promise<void> {
    const data: CatalogMigrationExport = validateSQLiteExport(input);
    const connection = await this.pool.getConnection(); let transaction = false, destroy = false;
    try {
      await connection.beginTransaction(); transaction = true;
      const row = await queryState(connection, true);
      if (row.snapshot !== null || row.last_attempt_ms !== null || row.attempt_token !== null) throw new Error('Catalog is already initialized.');
      for (const table of ['tpv_kn_brands', 'tpv_kn_videos', 'tpv_kn_dates']) {
        const [existing] = await connection.query<RowDataPacket[]>(`SELECT 1 AS present FROM ${table} LIMIT 1 FOR UPDATE`);
        if (existing.length) throw new Error('Catalog metadata tables are not empty.');
      }
      const now = millis(row.now_ms);
      if (now === null) throw new Error('Catalog clock is unavailable.');
      const [updated] = await connection.execute<ResultSetHeader>(
        'UPDATE tpv_kn_state SET snapshot = CAST(? AS JSON), last_attempt_ms = ?, last_success_ms = ?, import_sha256 = ?, sqlite_retired_ms = ?, revision = revision + 1 WHERE id = 1',
        [JSON.stringify(data.snapshot), Math.max(data.lastAttempt, now), data.lastSuccess, data.integrity.sha256, data.sqliteRetirement.retiredAt]);
      if (updated.affectedRows !== 1) throw new Error('Catalog state is unavailable.');
      for (const item of data.brandMappings) await connection.execute('INSERT INTO tpv_kn_brands (slug, display_name, upstream_brand, observed_at) VALUES (?,?,?,?)', [item.slug, item.name, item.upstreamBrand, item.observedAt]);
      for (const item of data.videoMetadata) await connection.execute('INSERT INTO tpv_kn_videos (youtube_id, brand_slug, producer_track_code, code_source) VALUES (?,?,?,?)', [item.youtubeId, item.brandSlug, item.producerTrackCode, item.codeSource]);
      for (const item of data.videoDates) await connection.execute('INSERT INTO tpv_kn_dates (youtube_id, upload_date, release_date, source, observed_at) VALUES (?,?,?,?,?)', [item.youtubeId, item.uploadDate, item.releaseDate, item.source, item.observedAt]);
      await connection.commit(); transaction = false;
    } catch (error) { if (transaction) try { await connection.rollback(); } catch { destroy = true; } throw error; }
    finally { if (destroy) connection.destroy(); else connection.release(); }
  }

  async brandMappings(): Promise<{ slug: string; name: string; upstreamBrand: string; observedAt: number }[]> {
    const [rows] = await this.pool.query<(RowDataPacket & { slug: string; name: string; upstreamBrand: string; observedAt: string })[]>('SELECT slug, display_name AS name, upstream_brand AS upstreamBrand, observed_at AS observedAt FROM tpv_kn_brands ORDER BY display_name, slug');
    return rows.map(row => ({ slug: row.slug, name: row.name, upstreamBrand: row.upstreamBrand, observedAt: millis(row.observedAt)! }));
  }

  /** Save a verified mapping atomically with its matched YouTube IDs. */
  async saveBrandMapping(mapping: { slug: string; name: string; upstreamBrand: string }, observedAt = Date.now(), videoIds: readonly string[] = []): Promise<void> {
    if (!mapping.slug.trim() || mapping.slug.length > 200 || mapping.slug === '.' || mapping.slug === '..' || /[\/\\\x00-\x1f\x7f?#]/.test(mapping.slug) ||
        !mapping.name.trim() || mapping.name.length > 200 || /[\x00-\x1f\x7f]/.test(mapping.name) ||
        !mapping.upstreamBrand.trim() || mapping.upstreamBrand.length > 200 || /[\x00-\x1f\x7f]/.test(mapping.upstreamBrand) ||
        !Number.isSafeInteger(observedAt) || observedAt < 0 || videoIds.length > 100_000 || videoIds.some(id => !/^[A-Za-z0-9_-]{11}$/.test(id)))
      throw new Error('Invalid brand mapping.');
    await mutate(this.pool, async connection => {
      const [existing] = await connection.execute<(RowDataPacket & { slug: string; upstreamBrand: string })[]>(
        'SELECT slug, upstream_brand AS upstreamBrand FROM tpv_kn_brands WHERE LOWER(slug) = LOWER(?) OR LOWER(upstream_brand) = LOWER(?) FOR UPDATE', [mapping.slug, mapping.upstreamBrand]);
      if (existing.some(row => row.slug !== mapping.slug || row.upstreamBrand !== mapping.upstreamBrand)) throw new Error('Brand mapping conflicts with a saved mapping.');
      if (existing.length) await connection.execute('UPDATE tpv_kn_brands SET display_name = ?, observed_at = ? WHERE slug = ?', [mapping.name, observedAt, mapping.slug]);
      else await connection.execute('INSERT INTO tpv_kn_brands (slug, display_name, upstream_brand, observed_at) VALUES (?,?,?,?)', [mapping.slug, mapping.name, mapping.upstreamBrand, observedAt]);
      for (const id of new Set(videoIds)) {
        const [matches] = await connection.execute<(RowDataPacket & { brandSlug: string })[]>('SELECT brand_slug AS brandSlug FROM tpv_kn_videos WHERE youtube_id = ? FOR UPDATE', [id]);
        if (matches.length && matches[0].brandSlug !== mapping.slug) throw new Error('Video mapping conflicts with a saved mapping.');
        if (!matches.length) await connection.execute('INSERT INTO tpv_kn_videos (youtube_id, brand_slug) VALUES (?,?)', [id, mapping.slug]);
      }
    });
  }

  async saveProducerTrackCode(youtubeId: string, code: string, source: 'host-confirmed' | 'creator-catalog'): Promise<void> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId) || !code.trim() || code.length > 128 || /[\x00-\x1f\x7f]/.test(code) || !['host-confirmed', 'creator-catalog'].includes(source)) throw new Error('Invalid producer track code.');
    await mutate(this.pool, async connection => {
      const [rows] = await connection.execute<(RowDataPacket & { code: string | null; source: string | null })[]>('SELECT producer_track_code AS code, code_source AS source FROM tpv_kn_videos WHERE youtube_id = ? FOR UPDATE', [youtubeId]);
      if (!rows.length || rows[0].code !== null && (rows[0].code !== code || rows[0].source !== source)) throw new Error('Unknown video or conflicting producer track code.');
      await connection.execute('UPDATE tpv_kn_videos SET producer_track_code = ?, code_source = ? WHERE youtube_id = ?', [code, source, youtubeId]);
    });
  }

  async saveVideoDates(youtubeId: string, dates: { uploadDate: string | null; releaseDate: string | null; provenance: 'yt-dlp' }, observedAt = Date.now()): Promise<void> {
    const validDate = (value: string | null) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId) || !validDate(dates.uploadDate) || !validDate(dates.releaseDate) || dates.provenance !== 'yt-dlp' || !Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error('Invalid video dates.');
    await mutate(this.pool, async connection => {
      const [matches] = await connection.execute<RowDataPacket[]>('SELECT youtube_id FROM tpv_kn_videos WHERE youtube_id = ? FOR UPDATE', [youtubeId]);
      if (!matches.length) throw new Error('Unknown video.');
      const [existing] = await connection.execute<RowDataPacket[]>('SELECT youtube_id FROM tpv_kn_dates WHERE youtube_id = ? FOR UPDATE', [youtubeId]);
      if (existing.length) await connection.execute('UPDATE tpv_kn_dates SET upload_date = ?, release_date = ?, source = ?, observed_at = ? WHERE youtube_id = ?', [dates.uploadDate, dates.releaseDate, dates.provenance, observedAt, youtubeId]);
      else await connection.execute('INSERT INTO tpv_kn_dates (youtube_id, upload_date, release_date, source, observed_at) VALUES (?,?,?,?,?)', [youtubeId, dates.uploadDate, dates.releaseDate, dates.provenance, observedAt]);
    });
  }
  async videoMetadata(): Promise<{ youtubeId: string; brandSlug: string; producerTrackCode: string | null; codeSource: string | null }[]> {
    const [rows] = await this.pool.query<(RowDataPacket & { youtubeId: string; brandSlug: string; producerTrackCode: string | null; codeSource: string | null })[]>('SELECT youtube_id AS youtubeId, brand_slug AS brandSlug, producer_track_code AS producerTrackCode, code_source AS codeSource FROM tpv_kn_videos ORDER BY youtube_id');
    return rows.map(row => ({ youtubeId: row.youtubeId, brandSlug: row.brandSlug, producerTrackCode: row.producerTrackCode, codeSource: row.codeSource }));
  }
  async videoDates(youtubeId: string): Promise<{ uploadDate: string | null; releaseDate: string | null; source: string; observedAt: number } | null> {
    const [rows] = await this.pool.execute<(RowDataPacket & { uploadDate: string | null; releaseDate: string | null; source: string; observedAt: string })[]>('SELECT upload_date AS uploadDate, release_date AS releaseDate, source, observed_at AS observedAt FROM tpv_kn_dates WHERE youtube_id = ?', [youtubeId]);
    return rows[0] ? { uploadDate: rows[0].uploadDate, releaseDate: rows[0].releaseDate, source: rows[0].source, observedAt: millis(rows[0].observedAt)! } : null;
  }

  /** Revalidate a cached public projection without transferring the catalog JSON. */
  async searchMetadata(): Promise<CatalogMetadata> {
    const [rows] = await this.pool.query<(RowDataPacket & { revision: string; last_attempt_ms: DbTime; last_success_ms: DbTime })[]>(
      'SELECT CAST(revision AS CHAR) AS revision, last_attempt_ms, last_success_ms FROM tpv_kn_state WHERE id = 1 AND snapshot IS NOT NULL');
    if (rows.length !== 1 || !/^(?:0|[1-9][0-9]{0,19})$/.test(rows[0].revision)) throw new Error('Catalog is not initialized.');
    const row = rows[0];
    return { revision: row.revision, lastAttempt: millis(row.last_attempt_ms), lastSuccess: millis(row.last_success_ms) };
  }

  /** A consistent snapshot for the server-side read API; never expose this raw object to guests. */
  async searchSnapshot(): Promise<SharedCatalogSnapshot> {
    const connection = await this.pool.getConnection(); let transaction = false, destroy = false;
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'); transaction = true;
      const [state] = await connection.query<(RowDataPacket & { snapshot: unknown; revision: string; last_attempt_ms: DbTime; last_success_ms: DbTime })[]>("SELECT snapshot, CAST(revision AS CHAR) AS revision, last_attempt_ms, last_success_ms FROM tpv_kn_state WHERE id = 1");
      if (state.length !== 1 || state[0].snapshot === null || !/^\d+$/.test(state[0].revision)) throw new Error('Catalog is not initialized.');
      const [brands] = await connection.query<(RowDataPacket & { slug: string; name: string; upstreamBrand: string; observedAt: string })[]>('SELECT slug, display_name AS name, upstream_brand AS upstreamBrand, observed_at AS observedAt FROM tpv_kn_brands ORDER BY display_name, slug');
      const [videos] = await connection.query<(RowDataPacket & { youtubeId: string; brandSlug: string; producerTrackCode: string | null; codeSource: string | null })[]>('SELECT youtube_id AS youtubeId, brand_slug AS brandSlug, producer_track_code AS producerTrackCode, code_source AS codeSource FROM tpv_kn_videos ORDER BY youtube_id');
      const [dates] = await connection.query<(RowDataPacket & { youtubeId: string; uploadDate: string | null; releaseDate: string | null; source: string; observedAt: string })[]>('SELECT youtube_id AS youtubeId, upload_date AS uploadDate, release_date AS releaseDate, source, observed_at AS observedAt FROM tpv_kn_dates ORDER BY youtube_id');
      const snapshot: SharedCatalogSnapshot = { catalog: decodeSnapshot(state[0].snapshot), revision: state[0].revision,
        lastAttempt: millis(state[0].last_attempt_ms), lastSuccess: millis(state[0].last_success_ms),
        brandMappings: brands.map(row => ({ slug: row.slug, name: row.name, upstreamBrand: row.upstreamBrand, observedAt: millis(row.observedAt)! })),
        videoMetadata: videos.map(row => ({ youtubeId: row.youtubeId, brandSlug: row.brandSlug, producerTrackCode: row.producerTrackCode, codeSource: row.codeSource })),
        videoDates: dates.map(row => ({ youtubeId: row.youtubeId, uploadDate: row.uploadDate, releaseDate: row.releaseDate, source: row.source, observedAt: millis(row.observedAt)! })) };
      await connection.commit(); transaction = false;
      return snapshot;
    } catch (error) { if (transaction) try { await connection.rollback(); } catch { destroy = true; } throw error; }
    finally { if (destroy) connection.destroy(); else connection.release(); }
  }

  /** Reserve using MySQL server time, commit before I/O, and keep a named lock through finalization. */
  async refresh(fetcher: () => Promise<unknown>, seededHandoff?: SeededRefreshHandoff): Promise<MySqlRefreshStatus> {
    if (seededHandoff !== undefined && !validSeededHandoff(seededHandoff)) throw new Error('Invalid seeded catalog handoff.');
    const connection = await this.pool.getConnection(); let locked = false, transaction = false, destroy = false;
    const token = randomUUID();
    try {
      const [locks] = await connection.query<(RowDataPacket & { acquired: number | string | null })[]>('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
      if (locks[0]?.acquired === null || locks[0]?.acquired === undefined) throw new Error('Catalog lock is unavailable.');
      locked = Number(locks[0].acquired) === 1;
      if (!locked) return result('in-progress', await queryState(connection));
      await connection.beginTransaction(); transaction = true;
      const state = await queryState(connection, true), now = millis(state.now_ms), lastAttempt = millis(state.last_attempt_ms);
      if (now === null) throw new Error('Catalog clock is unavailable.');
      if (state.snapshot === null) { await connection.rollback(); transaction = false; return result('not-initialized', state); }
      // A prior process may have lost its DB session while a request was still
      // running. Never infer safety merely from a timed-out named lock.
      if (state.attempt_token !== null) { await connection.rollback(); transaction = false; return result('recovery-required', state); }
      if (lastAttempt === null) {
        if (!seededHandoff || state.last_success_ms !== null || state.sqlite_retired_ms !== null || state.import_sha256 !== seededHandoff.seedSha256) {
          await connection.rollback(); transaction = false; return result('not-initialized', state);
        }
        const nextAttempt = seededHandoff.quiescenceVerifiedAtMs + DAY;
        if (now < nextAttempt) {
          await connection.rollback(); transaction = false; return { ...result('not-due', state), nextAttempt };
        }
      } else if (now - lastAttempt < DAY) {
        await connection.rollback(); transaction = false; return result('not-due', state);
      }
      const previous = decodeSnapshot(state.snapshot);
      if (lastAttempt === null && createHash('sha256').update(serializeSeedSnapshot(previous), 'utf8').digest('hex') !== seededHandoff?.seedSha256) {
        await connection.rollback(); transaction = false; return result('not-initialized', state);
      }
      await connection.execute('UPDATE tpv_kn_state SET last_attempt_ms = ?, attempt_token = ? WHERE id = 1', [now, token]);
      await connection.commit(); transaction = false;
      try {
        const next = parseCommunityCatalog(await fetcher());
        if (next.Items.length < Math.ceil(previous.Items.length / 2)) throw new Error('Catalog shrank unexpectedly.');
        const [updated] = await connection.execute<ResultSetHeader>(`UPDATE tpv_kn_state SET snapshot = CAST(? AS JSON), revision = revision + 1,
          last_attempt_ms = GREATEST(last_attempt_ms, ${CLOCK}), last_success_ms = ${CLOCK}, attempt_token = NULL WHERE id = 1 AND attempt_token = ?`, [JSON.stringify(next), token]);
        if (updated.affectedRows !== 1) throw new Error('Catalog reservation changed.');
        return result('updated', await queryState(connection));
      } catch {
        const [updated] = await connection.execute<ResultSetHeader>(`UPDATE tpv_kn_state SET last_attempt_ms = GREATEST(last_attempt_ms, ${CLOCK}), attempt_token = NULL WHERE id = 1 AND attempt_token = ?`, [token]);
        if (updated.affectedRows !== 1) throw new Error('Catalog reservation changed.');
        return result('failed', await queryState(connection));
      }
    } catch (error) {
      if (transaction) try { await connection.rollback(); } catch { destroy = true; }
      throw error;
    } finally {
      if (locked && !destroy) try { const [released] = await connection.query<(RowDataPacket & { released: number | string | null })[]>('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); if (Number(released[0]?.released) !== 1) destroy = true; } catch { destroy = true; }
      if (destroy) connection.destroy(); else connection.release();
    }
  }

  /** Call only after an operator verifies the former updater and request stopped. */
  async recoverInterruptedRefresh(): Promise<{ lastAttempt: number; nextAttempt: number }> {
    const connection = await this.pool.getConnection(); let locked = false, transaction = false, destroy = false;
    try {
      const [locks] = await connection.query<(RowDataPacket & { acquired: number | string | null })[]>('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
      if (locks[0]?.acquired === null || locks[0]?.acquired === undefined) throw new Error('Catalog lock is unavailable.');
      if (Number(locks[0].acquired) !== 1) throw new Error('Catalog is busy.');
      locked = true;
      await connection.beginTransaction(); transaction = true;
      const state = await queryState(connection, true), now = millis(state.now_ms), prior = millis(state.last_attempt_ms);
      if (state.snapshot === null || state.attempt_token === null || now === null || prior === null) throw new Error('No interrupted refresh to recover.');
      const lastAttempt = Math.max(now, prior);
      await connection.execute('UPDATE tpv_kn_state SET attempt_token = NULL, last_attempt_ms = ? WHERE id = 1', [lastAttempt]);
      await connection.commit(); transaction = false;
      return { lastAttempt, nextAttempt: lastAttempt + DAY };
    } catch (error) { if (transaction) try { await connection.rollback(); } catch { destroy = true; } throw error; }
    finally {
      if (locked && !destroy) try { const [released] = await connection.query<(RowDataPacket & { released: number | string | null })[]>('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); if (Number(released[0]?.released) !== 1) destroy = true; } catch { destroy = true; }
      if (destroy) connection.destroy(); else connection.release();
    }
  }
}

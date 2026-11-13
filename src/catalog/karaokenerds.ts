/** Central-only catalog cache. Never embed its credential in a desktop client. */
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DAY = 24 * 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_TIMESTAMP = 253_402_300_799_999;
const validTimestamp = (value: number): boolean => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP;

export type CommunityItem = { Id: number; Artist: string; Title: string; Brand: string; Watch: string; Created: string | null };
export type CommunityCatalog = { Items: CommunityItem[] };
export type RefreshResult = { status: 'updated' | 'not-due' | 'not-initialized' | 'in-progress' | 'retired' | 'failed'; lastAttempt: number | null; lastSuccess: number | null; nextAttempt: number | null };
export type SQLiteRefreshStatus = { state: 'available' | 'retired'; retiredAt: number | null; lastAttempt: number | null; nextAttempt: number | null; attemptOutstanding: boolean };

/** Fail closed on unexpected shapes instead of replacing a good snapshot. */
export function parseCommunityCatalog(value: unknown): CommunityCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid catalog.');
  const items = (value as Record<string, unknown>).Items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 1_000_000) throw new Error('Invalid catalog.');
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !Number.isSafeInteger(item.Id) ||
        !['Artist', 'Title', 'Brand', 'Watch'].every(key => typeof item[key] === 'string' && item[key].length > 0 && item[key].length <= 16_384) ||
        !(item.Created === null || typeof item.Created === 'string' && item.Created.length <= 16_384))
      throw new Error('Invalid catalog.');
  }
  return value as CommunityCatalog;
}

/** Validate the origin and block redirects so the query credential is never forwarded elsewhere. */
export function validateCommunityUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Invalid Karaoke Nerds URL.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'karaokenerds.com' || url.port || url.username || url.password ||
      url.pathname !== '/Data/Community' || url.hash || [...url.searchParams.keys()].length !== 1 || !url.searchParams.get('key'))
    throw new Error('Invalid Karaoke Nerds URL.');
  return url;
}

/** Private URL must be supplied by the central operator, never rendered or logged. */
export async function fetchCommunity(urlValue: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const url = validateCommunityUrl(urlValue);
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { Accept: 'application/json' } });
    if (!response.ok || !response.body) throw new Error('Catalog request failed.');
    const length = response.headers.get('content-length');
    if (length && Number(length) > MAX_BYTES) throw new Error('Catalog is too large.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Catalog is too large.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as unknown;
  } catch { throw new Error('Catalog request failed.'); }
}

/** One database on one central host arbitrates attempts across all updater processes. */
export class CommunityCatalogStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout = 5000');
    const existing = this.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    if (existing.some(row => !['community_catalog', 'community_brand_mappings', 'community_video_metadata', 'community_video_dates', 'community_refresh_control'].includes(row.name)) ||
        existing.some(row => row.name !== 'community_catalog') && !existing.some(row => row.name === 'community_catalog')) {
      this.db.close(); throw new Error('Not a community catalog database.');
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS community_catalog (
      id INTEGER PRIMARY KEY CHECK (id = 1), last_attempt INTEGER, last_success INTEGER,
      attempt_id TEXT, snapshot TEXT
    ); INSERT OR IGNORE INTO community_catalog (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS community_brand_mappings (
      slug TEXT PRIMARY KEY, display_name TEXT NOT NULL, upstream_brand TEXT NOT NULL UNIQUE, observed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS community_video_metadata (
      youtube_id TEXT PRIMARY KEY, brand_slug TEXT NOT NULL, producer_track_code TEXT, code_source TEXT,
      CHECK ((producer_track_code IS NULL AND code_source IS NULL) OR (producer_track_code IS NOT NULL AND code_source IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS community_video_dates (
      youtube_id TEXT PRIMARY KEY, upload_date TEXT, release_date TEXT, source TEXT NOT NULL, observed_at INTEGER NOT NULL
    );`);
  }
  close(): void { this.db.close(); }
  read(): CommunityCatalog | null {
    const row = this.db.prepare('SELECT snapshot FROM community_catalog WHERE id = 1').get() as { snapshot: string | null };
    return row.snapshot === null ? null : parseCommunityCatalog(JSON.parse(row.snapshot));
  }
  /** Initialize the central store from an already fetched snapshot, including its cooldown. */
  seed(value: unknown, attemptedAt: number): void {
    if (!Number.isSafeInteger(attemptedAt) || attemptedAt < 0 || attemptedAt > Date.now()) throw new Error('Invalid initial attempt time.');
    const snapshot = JSON.stringify(parseCommunityCatalog(value));
    const result = this.db.prepare('UPDATE community_catalog SET snapshot = ?, last_attempt = ?, last_success = ? WHERE id = 1 AND last_attempt IS NULL AND snapshot IS NULL').run(snapshot, attemptedAt, attemptedAt);
    if (Number(result.changes) !== 1) throw new Error('Catalog is already initialized.');
  }
  private result(status: RefreshResult['status']): RefreshResult {
    const row = this.db.prepare('SELECT last_attempt, last_success FROM community_catalog WHERE id = 1').get() as { last_attempt: number | null; last_success: number | null };
    return { status, lastAttempt: row.last_attempt, lastSuccess: row.last_success, nextAttempt: row.last_attempt === null ? null : row.last_attempt + DAY };
  }
  status(): { lastAttempt: number | null; lastSuccess: number | null; nextAttempt: number | null } {
    const { lastAttempt, lastSuccess, nextAttempt } = this.result('not-due');
    return { lastAttempt, lastSuccess, nextAttempt };
  }
  /** A missing marker is the legacy state; a malformed marker always fails closed. */
  private retirement(): number | null {
    const table = this.db.prepare("SELECT type FROM sqlite_schema WHERE name = 'community_refresh_control'").get() as { type: string } | undefined;
    if (!table) return null;
    if (table.type !== 'table') throw new Error('Invalid SQLite refresh retirement marker.');
    const columns = this.db.prepare('PRAGMA table_info(community_refresh_control)').all() as { name: string; type: string; pk: number }[];
    if (columns.length !== 3 || columns[0].name !== 'id' || columns[0].type.toUpperCase() !== 'INTEGER' || columns[0].pk !== 1 ||
        columns[1].name !== 'state' || columns[1].type.toUpperCase() !== 'TEXT' || columns[2].name !== 'retired_at' || columns[2].type.toUpperCase() !== 'INTEGER')
      throw new Error('Invalid SQLite refresh retirement marker.');
    const rows = this.db.prepare('SELECT id, state, retired_at FROM community_refresh_control').all() as { id: number; state: string; retired_at: number }[];
    if (rows.length !== 1 || rows[0].id !== 1 || rows[0].state !== 'retired' || !validTimestamp(rows[0].retired_at))
      throw new Error('Invalid SQLite refresh retirement marker.');
    return rows[0].retired_at;
  }
  sqliteRefreshStatus(): SQLiteRefreshStatus {
    const retiredAt = this.retirement();
    const row = this.db.prepare('SELECT last_attempt, attempt_id FROM community_catalog WHERE id = 1').get() as { last_attempt: number | null; attempt_id: string | null };
    if (!row || !(row.last_attempt === null || validTimestamp(row.last_attempt)) || !(row.attempt_id === null || typeof row.attempt_id === 'string' && row.attempt_id.length > 0)) throw new Error('Invalid SQLite refresh state.');
    return { state: retiredAt === null ? 'available' : 'retired', retiredAt, lastAttempt: row.last_attempt,
      nextAttempt: row.last_attempt === null ? null : row.last_attempt + DAY, attemptOutstanding: row.attempt_id !== null };
  }
  /** Call only after independently stopping every old SQLite updater. */
  retireSQLiteRefresh(confirmedStopped: boolean, now = Date.now()): SQLiteRefreshStatus {
    if (confirmedStopped !== true || !validTimestamp(now)) throw new Error('Stop all old updaters and confirm the cutover.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.sqliteRefreshStatus();
      if (state.state === 'retired') { this.db.exec('COMMIT'); return state; }
      if (state.lastAttempt === null) throw new Error('SQLite catalog is not initialized.');
      if (state.attemptOutstanding) throw new Error('An earlier SQLite attempt needs explicit recovery.');
      // Quiescence is verified by the operator outside the database. Resetting
      // the gate conservatively gives every new authority a full-day embargo.
      this.db.prepare('UPDATE community_catalog SET last_attempt = ?, attempt_id = NULL WHERE id = 1').run(Math.max(now, state.lastAttempt));
      this.db.exec("CREATE TABLE community_refresh_control (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, retired_at INTEGER NOT NULL)");
      this.db.prepare("INSERT INTO community_refresh_control (id, state, retired_at) VALUES (1, 'retired', ?)").run(now);
      const retired = this.sqliteRefreshStatus();
      this.db.exec('COMMIT');
      return retired;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** A stale token requires confirmed shutdown and a fresh 24-hour embargo. */
  recoverStaleSQLiteAttempt(confirmedStopped: boolean, now = Date.now()): SQLiteRefreshStatus {
    if (confirmedStopped !== true || !validTimestamp(now)) throw new Error('Stop all old updaters and confirm recovery.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.sqliteRefreshStatus();
      if (state.state !== 'available' || state.lastAttempt === null || !state.attemptOutstanding) throw new Error('No recoverable SQLite attempt exists.');
      this.db.prepare('UPDATE community_catalog SET last_attempt = ?, attempt_id = NULL WHERE id = 1').run(Math.max(now, state.lastAttempt));
      const recovered = this.sqliteRefreshStatus();
      this.db.exec('COMMIT');
      return recovered;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Rollback requires an independently stopped central updater and its last attempt. */
  resumeSQLiteRefresh(confirmedStopped: boolean, centralLastAttempt: number, now = Date.now()): SQLiteRefreshStatus {
    if (confirmedStopped !== true || !validTimestamp(now) || !validTimestamp(centralLastAttempt)) throw new Error('Stop the central updater and provide its last attempt time.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.sqliteRefreshStatus();
      if (state.state !== 'retired' || state.lastAttempt === null || state.attemptOutstanding) throw new Error('SQLite refresh is not in a recoverable retired state.');
      const safeAttempt = Math.max(now, centralLastAttempt, state.lastAttempt);
      this.db.prepare('UPDATE community_catalog SET last_attempt = ?, attempt_id = NULL WHERE id = 1').run(safeAttempt);
      this.db.exec('DROP TABLE community_refresh_control');
      const resumed = this.sqliteRefreshStatus();
      this.db.exec('COMMIT');
      return resumed;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Store a verified site-to-feed join; do not overwrite another brand's mapping. */
  saveBrandMapping(mapping: { slug: string; name: string; upstreamBrand: string }, observedAt = Date.now(), videoIds: readonly string[] = []): void {
    if (!mapping.slug.trim() || mapping.slug.length > 200 || mapping.slug === '.' || mapping.slug === '..' || /[\/\\\x00-\x1f\x7f?#]/.test(mapping.slug) || !mapping.name.trim() || mapping.name.length > 200 || /[\x00-\x1f\x7f]/.test(mapping.name) ||
        !mapping.upstreamBrand.trim() || mapping.upstreamBrand.length > 200 || /[\x00-\x1f\x7f]/.test(mapping.upstreamBrand) || !Number.isSafeInteger(observedAt) || observedAt < 0 ||
        videoIds.length > 100_000 || videoIds.some(id => !/^[A-Za-z0-9_-]{11}$/.test(id)))
      throw new Error('Invalid brand mapping.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT slug, upstream_brand FROM community_brand_mappings WHERE slug = ? COLLATE NOCASE').get(mapping.slug) as { slug: string; upstream_brand: string } | undefined;
      const owner = this.db.prepare('SELECT slug FROM community_brand_mappings WHERE upstream_brand = ? COLLATE NOCASE').get(mapping.upstreamBrand) as { slug: string } | undefined;
      if (previous && (previous.upstream_brand !== mapping.upstreamBrand || previous.slug !== mapping.slug) || owner && owner.slug !== mapping.slug) throw new Error('Brand mapping conflicts with a saved mapping.');
      this.db.prepare('INSERT INTO community_brand_mappings (slug, display_name, upstream_brand, observed_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET display_name = excluded.display_name, observed_at = excluded.observed_at').run(mapping.slug, mapping.name, mapping.upstreamBrand, observedAt);
      const lookup = this.db.prepare('SELECT brand_slug FROM community_video_metadata WHERE youtube_id = ?');
      const insert = this.db.prepare('INSERT OR IGNORE INTO community_video_metadata (youtube_id, brand_slug) VALUES (?, ?)');
      for (const id of new Set(videoIds)) {
        const prior = lookup.get(id) as { brand_slug: string } | undefined;
        if (prior && prior.brand_slug !== mapping.slug) throw new Error('Video mapping conflicts with a saved mapping.');
        insert.run(id, mapping.slug);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  brandMappings(): { slug: string; name: string; upstreamBrand: string; observedAt: number }[] {
    const rows = this.db.prepare('SELECT slug, display_name AS name, upstream_brand AS upstreamBrand, observed_at AS observedAt FROM community_brand_mappings ORDER BY display_name COLLATE NOCASE').all() as { slug: string; name: string; upstreamBrand: string; observedAt: number }[];
    return rows.map(row => ({ ...row }));
  }
  videoMetadata(): { youtubeId: string; brandSlug: string; producerTrackCode: string | null; codeSource: string | null }[] {
    const rows = this.db.prepare('SELECT youtube_id AS youtubeId, brand_slug AS brandSlug, producer_track_code AS producerTrackCode, code_source AS codeSource FROM community_video_metadata ORDER BY youtube_id').all() as { youtubeId: string; brandSlug: string; producerTrackCode: string | null; codeSource: string | null }[];
    return rows.map(row => ({ ...row }));
  }
  /** Only attach a producer code supported by an operator-verified source. */
  saveProducerTrackCode(youtubeId: string, code: string, source: 'host-confirmed' | 'creator-catalog'): void {
    if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId) || !code.trim() || code.length > 128 || /[\x00-\x1f\x7f]/.test(code) || !['host-confirmed', 'creator-catalog'].includes(source)) throw new Error('Invalid producer track code.');
    const result = this.db.prepare('UPDATE community_video_metadata SET producer_track_code = ?, code_source = ? WHERE youtube_id = ? AND (producer_track_code IS NULL OR (producer_track_code = ? AND code_source = ?))').run(code, source, youtubeId, code, source);
    if (Number(result.changes) !== 1) throw new Error('Unknown video or conflicting producer track code.');
  }
  /** Store yt-dlp date fields separately from the catalog's Created timestamp. */
  saveVideoDates(youtubeId: string, dates: { uploadDate: string | null; releaseDate: string | null; provenance: 'yt-dlp' }, observedAt = Date.now()): void {
    const validDate = (value: string | null) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId) || !validDate(dates.uploadDate) || !validDate(dates.releaseDate) || dates.provenance !== 'yt-dlp' || !Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error('Invalid video dates.');
    const result = this.db.prepare(`INSERT INTO community_video_dates (youtube_id, upload_date, release_date, source, observed_at)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM community_video_metadata WHERE youtube_id = ?)
      ON CONFLICT(youtube_id) DO UPDATE SET upload_date = excluded.upload_date, release_date = excluded.release_date, source = excluded.source, observed_at = excluded.observed_at`).run(youtubeId, dates.uploadDate, dates.releaseDate, dates.provenance, observedAt, youtubeId);
    if (Number(result.changes) !== 1) throw new Error('Unknown video.');
  }
  videoDates(youtubeId: string): { uploadDate: string | null; releaseDate: string | null; source: string; observedAt: number } | null {
    const row = this.db.prepare('SELECT upload_date AS uploadDate, release_date AS releaseDate, source, observed_at AS observedAt FROM community_video_dates WHERE youtube_id = ?').get(youtubeId) as { uploadDate: string | null; releaseDate: string | null; source: string; observedAt: number } | undefined;
    return row ? { ...row } : null;
  }
  async refresh(fetcher: () => Promise<unknown>, now?: number, completionClock?: () => number): Promise<RefreshResult> {
    const startedAt = now ?? Date.now();
    if (!validTimestamp(startedAt)) throw new Error('Invalid clock.');
    const completedAt = () => {
      // Explicit start times keep existing synthetic callers deterministic;
      // production uses the actual clock again after the network operation.
      const value = completionClock ? completionClock() : now === undefined ? Date.now() : startedAt;
      if (!validTimestamp(value)) throw new Error('Invalid clock.');
      return Math.max(startedAt, value);
    };
    const id = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.retirement() !== null) { const result = this.result('retired'); this.db.exec('ROLLBACK'); return result; }
      const row = this.db.prepare('SELECT last_attempt, snapshot, attempt_id FROM community_catalog WHERE id = 1').get() as { last_attempt: number | null; snapshot: string | null; attempt_id: string | null };
      if (row.last_attempt === null || row.snapshot === null) { const result = this.result('not-initialized'); this.db.exec('ROLLBACK'); return result; }
      if (!validTimestamp(row.last_attempt) || !(row.attempt_id === null || typeof row.attempt_id === 'string' && row.attempt_id.length > 0)) throw new Error('Invalid SQLite refresh state.');
      if (startedAt - row.last_attempt < DAY) { const result = this.result('not-due'); this.db.exec('ROLLBACK'); return result; }
      if (row.attempt_id !== null) { const result = this.result('in-progress'); this.db.exec('ROLLBACK'); return result; }
      this.db.prepare('UPDATE community_catalog SET last_attempt = ?, attempt_id = ? WHERE id = 1').run(startedAt, id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    try {
      const next = parseCommunityCatalog(await fetcher());
      const previous = this.read();
      // A structurally valid but unexpectedly small dump may be truncated.
      if (previous && next.Items.length < Math.ceil(previous.Items.length / 2)) throw new Error('Catalog shrank unexpectedly.');
      const snapshot = JSON.stringify(next);
      const finished = completedAt();
      const result = this.db.prepare('UPDATE community_catalog SET snapshot = ?, last_success = ?, last_attempt = MAX(last_attempt, ?), attempt_id = NULL WHERE id = 1 AND attempt_id = ?').run(snapshot, finished, finished, id);
      return this.result(Number(result.changes) === 1 ? 'updated' : 'failed');
    } catch {
      // Preserve the last good snapshot and consume the daily attempt even on failure.
      this.db.prepare('UPDATE community_catalog SET last_attempt = MAX(last_attempt, ?), attempt_id = NULL WHERE id = 1 AND attempt_id = ?').run(completedAt(), id);
      return this.result('failed');
    }
  }
}

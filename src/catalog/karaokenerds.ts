/** Central-only catalog cache. Never embed its credential in a desktop client. */
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DAY = 24 * 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;

export type CommunityItem = { Id: number; Artist: string; Title: string; Brand: string; Watch: string; Created: string | null };
export type CommunityCatalog = { Items: CommunityItem[] };
export type RefreshResult = { status: 'updated' | 'not-due' | 'not-initialized' | 'failed'; lastAttempt: number | null; lastSuccess: number | null; nextAttempt: number | null };

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
    if (existing.some(row => row.name !== 'community_catalog')) { this.db.close(); throw new Error('Not a community catalog database.'); }
    this.db.exec(`CREATE TABLE IF NOT EXISTS community_catalog (
      id INTEGER PRIMARY KEY CHECK (id = 1), last_attempt INTEGER, last_success INTEGER,
      attempt_id TEXT, snapshot TEXT
    ); INSERT OR IGNORE INTO community_catalog (id) VALUES (1);`);
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
  async refresh(fetcher: () => Promise<unknown>, now = Date.now()): Promise<RefreshResult> {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid clock.');
    const id = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT last_attempt, snapshot FROM community_catalog WHERE id = 1').get() as { last_attempt: number | null; snapshot: string | null };
      if (row.last_attempt === null || row.snapshot === null) { this.db.exec('ROLLBACK'); return this.result('not-initialized'); }
      if (row.last_attempt !== null && now - row.last_attempt < DAY) { this.db.exec('ROLLBACK'); return this.result('not-due'); }
      this.db.prepare('UPDATE community_catalog SET last_attempt = ?, attempt_id = ? WHERE id = 1').run(now, id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    try {
      const snapshot = JSON.stringify(parseCommunityCatalog(await fetcher()));
      const result = this.db.prepare('UPDATE community_catalog SET snapshot = ?, last_success = ? WHERE id = 1 AND attempt_id = ?').run(snapshot, now, id);
      return this.result(Number(result.changes) === 1 ? 'updated' : 'failed');
    } catch {
      // Preserve the last good snapshot and consume the daily attempt even on failure.
      return this.result('failed');
    }
  }
}

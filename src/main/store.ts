import { DatabaseSync } from 'node:sqlite';
import { isMissingSongStatus, type MissingSongRequest, type MissingSongReview, type MissingSongStatus } from '../domain/missing-request';
import type { HistoryEntry } from '../domain/collections';
import type { ShowState } from '../domain';
import type { Settings } from '../domain/settings';
import { Collections } from './collections';
import { RemoteQueue } from './remote-queue';
import { migrateShowSchema } from './schema-migrations';
import { createShowSnapshot } from './show-snapshots';

/** The private path never leaves the main process. */
export interface StoredMedia {
  id: string;
  path: string;
  fingerprint: string;
}

/** One synchronous SQLite transaction commits state and any imported media together. */
export class Store<T> {
  private db: DatabaseSync;
  private authorityFault = false;
  private remoteQueueOpened = false;
  private remoteQueueDisabled = false;
  readonly collections: Collections;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    try {
      migrateShowSchema(this.db);
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.collections = new Collections(this.db, () => this.assertAuthority());
    } catch (error) { this.db.close(); throw error; }
  }

  load(): T | undefined {
    const row = this.db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }

  /** Caller must keep this Store open until the returned promise settles. */
  backup(destination: string): Promise<void> {
    this.assertAuthority();
    return createShowSnapshot(this.db, destination);
  }

  save(state: T, media: StoredMedia[] = [], history?: HistoryEntry): void {
    this.assertAuthority();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const putMedia = this.db.prepare('INSERT OR REPLACE INTO media (id, path, fingerprint) VALUES (?, ?, ?)');
      for (const item of media) putMedia.run(item.id, item.path, item.fingerprint);
      this.db.prepare('INSERT INTO show_state (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(state));
      if (history) this.collections.record(history);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private assertAuthority(): void {
    if (this.authorityFault) throw new Error('Show authority needs recovery. Restart the application before making further changes.');
  }

  /** Irreversibly block new or existing guest authority in this process; local host writes are unaffected. */
  disableRemoteQueue(): void { this.remoteQueueDisabled = true; }
  private assertRemoteAuthority(): void {
    this.assertAuthority();
    if (this.remoteQueueDisabled) throw new Error('Remote queueing is shutting down.');
  }
  /** Host-only gate used before acquiring a cached remote authority. */
  assertRemoteQueueAvailable(): void { this.assertRemoteAuthority(); }

  /** Same SQLite connection as host writes; creates no network listener. */
  openRemoteQueue(this: Store<ShowState>, settings: () => Pick<Settings, 'autoApprove' | 'rotationMode' | 'pauseIntervalSeconds'>,
    installCommitted: (state: ShowState) => void, now: () => number = Date.now, onAuthorityFailure: () => void = () => {}): RemoteQueue {
    this.assertRemoteAuthority();
    if (this.remoteQueueOpened) throw new Error('Remote queue authority is already open.');
    const queue = new RemoteQueue(this.db, settings, state => {
      try {
        const result: unknown = installCommitted(state);
        if (result !== undefined) {
          // An accidentally async callback cannot be awaited after the commit.
          // Consume a later rejection while the authority remains locked down.
          if (result && typeof result === 'object' && 'then' in result) void Promise.resolve(result).catch(() => {});
          throw new Error('Installation must be synchronous.');
        }
      }
      catch {
        // The database has already committed. Never let an older in-memory host
        // state overwrite it; a fresh Store must reload the committed state.
        this.authorityFault = true;
        // Notify only after the write gate is latched; observers can reenter.
        try {
          const result: unknown = onAuthorityFailure();
          if (result && typeof result === 'object' && 'then' in result) void Promise.resolve(result).catch(() => {});
        } catch {}
        throw new Error('Show authority needs recovery. Restart the application before making further changes.');
      }
    }, now, (cleanup?: boolean) => { if (cleanup) this.assertAuthority(); else this.assertRemoteAuthority(); });
    this.remoteQueueOpened = true;
    return queue;
  }

  /** Host library search receives filenames only, never private directories. */
  mediaFilenames(): Record<string, string> {
    const rows = this.db.prepare('SELECT id, path FROM media').all() as { id: string; path: string }[];
    return Object.fromEntries(rows.map(row => [row.id, row.path.split(/[\\/]/).pop() ?? '']));
  }

  media(id: string): StoredMedia | undefined {
    return this.db.prepare('SELECT id, path, fingerprint FROM media WHERE id = ?').get(id) as StoredMedia | undefined;
  }

  byFingerprint(fingerprint: string): StoredMedia | undefined {
    return this.db.prepare('SELECT id, path, fingerprint FROM media WHERE fingerprint = ? LIMIT 1').get(fingerprint) as StoredMedia | undefined;
  }

  /** Replace only the path of the exact media row the host verified. Never writes the source file. */
  relinkMedia(expected: StoredMedia, replacementPath: string): boolean {
    this.assertAuthority();
    const result = this.db.prepare('UPDATE media SET path = ? WHERE id = ? AND path = ? AND fingerprint = ?')
      .run(replacementPath, expected.id, expected.path, expected.fingerprint);
    return result.changes === 1;
  }

  checkpoint(generation: string, position: number): void {
    this.assertAuthority();
    this.db.prepare('INSERT INTO checkpoint (id, generation, position) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation, position=excluded.position').run(generation, position);
  }

  position(generation: string): number {
    const row = this.db.prepare('SELECT position FROM checkpoint WHERE id = 1 AND generation = ?').get(generation) as { position: number } | undefined;
    return row?.position ?? 0;
  }

  addMissingSongRequest(request: MissingSongRequest): void {
    this.assertAuthority();
    this.db.prepare('INSERT INTO missing_song_requests (id, singer, title, artist, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(request.id, request.singer, request.title, request.artist, request.createdAt);
  }

  missingSongRequests(): MissingSongRequest[] {
    const rows = this.db.prepare('SELECT id, singer, title, artist, created_at AS createdAt FROM missing_song_requests ORDER BY created_at DESC, rowid DESC').all() as unknown as MissingSongRequest[];
    return rows.map(row => ({ ...row }));
  }

  /** Host-only review data; existing local and guest requests start pending without rewriting them. */
  missingSongReviews(): MissingSongReview[] {
    return this.db.prepare(`SELECT request.id, request.singer, request.title, request.artist, request.created_at AS createdAt,
      COALESCE(review.status, 'pending') AS status, review.updated_at AS updatedAt
      FROM missing_song_requests request LEFT JOIN missing_song_request_reviews review ON review.request_id = request.id
      ORDER BY request.created_at DESC, request.rowid DESC`).all() as unknown as MissingSongReview[];
  }

  /** Reject stale reviews and unknown requests without modifying request/guest identity rows. */
  setMissingSongStatus(id: string, expected: MissingSongStatus, next: MissingSongStatus): boolean {
    this.assertAuthority();
    if (typeof id !== 'string' || !id || id.length > 200 || !isMissingSongStatus(expected) || !isMissingSongStatus(next)) throw new Error('Invalid missing-song review.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT COALESCE(review.status, 'pending') AS status FROM missing_song_requests request
        LEFT JOIN missing_song_request_reviews review ON review.request_id = request.id WHERE request.id = ?`).get(id) as { status: string } | undefined;
      if (!row || row.status !== expected) { this.db.exec('COMMIT'); return false; }
      if (expected !== next) this.db.prepare(`INSERT INTO missing_song_request_reviews (request_id, status, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`).run(id, next, new Date().toISOString());
      this.db.exec('COMMIT'); return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  close(): void { this.db.close(); }
}

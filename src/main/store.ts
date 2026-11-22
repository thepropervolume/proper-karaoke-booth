import { DatabaseSync } from 'node:sqlite';
import { isMissingSongStatus, type MissingSongRequest, type MissingSongReview, type MissingSongStatus } from '../domain/missing-request';
import type { HistoryEntry } from '../domain/collections';
import type { PlaylistDestination } from '../domain/playlist-transfer';
import type { ShowState } from '../domain';
import { Collections } from './collections';
import { RemoteQueue, type RemoteApplause, type RemotePhoto, type RemoteQueueSettings } from './remote-queue';
import type { RemoteCatalog } from './remote-catalog';
import { migrateShowSchema } from './schema-migrations';
import { openHostShowDatabase } from './show-upgrade';
import { createShowSnapshot } from './show-snapshots';
import { recordQueuedSongs, songSeenBefore } from './song-history';
import { isLocalRecordingKey, validHeartVote, parseRecordingKeys, type LocalRecordingKey, type SongRating } from '../domain/song-rating';

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
  private restoreFrozen = false;
  private remoteQueueOpened = false;
  private remoteQueueDisabled = false;
  readonly collections: Collections;

  static async openForHost(filename: string): Promise<Store<ShowState>> {
    return new Store<ShowState>(await openHostShowDatabase(filename));
  }

  constructor(filename: string | DatabaseSync) {
    this.db = typeof filename === 'string' ? new DatabaseSync(filename) : filename;
    try {
      if (typeof filename === 'string') migrateShowSchema(this.db);
      // WAL keeps reads responsive; FULL asks SQLite to durably commit before
      // we acknowledge a show edit. Media bytes remain separate from this DB.
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

  /** Freeze this retiring Store before taking the rollback snapshot. */
  backupBeforeRestore(destination: string): Promise<void> {
    this.assertAuthority();
    this.restoreFrozen = true;
    return createShowSnapshot(this.db, destination);
  }

  // An imported version without its media row (or a completed turn without
  // its history) is an invalid partial outcome, so these share one transaction.
  save(state: T, media: StoredMedia[] = [], history?: HistoryEntry): void {
    this.writeTransaction(() => {
      const before = this.load();
      const putMedia = this.db.prepare('INSERT OR REPLACE INTO media (id, path, fingerprint) VALUES (?, ?, ?)');
      for (const item of media) putMedia.run(item.id, item.path, item.fingerprint);
      recordQueuedSongs(this.db, before, state);
      this.db.prepare('INSERT INTO show_state (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(state));
      if (history) this.collections.record(history);
    });
  }

  importPlaylist(destination: PlaylistDestination, versions: readonly string[], singers: readonly { id: string }[],
    allowed: readonly { id: string }[]): { playlistId: string; added: number } {
    return this.writeTransaction(() => this.collections.importMatches(destination, versions, singers, allowed));
  }

  private writeTransaction<R>(write: () => R): R {
    this.assertAuthority();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); }
      catch {
        // A failed rollback leaves the transaction outcome unknown. In
        // particular, COMMIT may have succeeded before an I/O error surfaced.
        // Never allow the older in-memory state to overwrite that result.
        this.authorityFault = true;
        throw new Error('Show authority needs recovery. Restart the application before making further changes.');
      }
      throw error;
    }
  }

  /** Unknown metadata is treated conservatively as previously seen. */
  songSeenBefore(song: { artist: string; title: string }): boolean {
    this.assertAuthority();
    return songSeenBefore(this.db, song);
  }

  private assertAuthority(): void {
    if (this.authorityFault) throw new Error('Show authority needs recovery. Restart the application before making further changes.');
    if (this.restoreFrozen) throw new Error('The show is restarting to restore a backup.');
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
  openRemoteQueue(this: Store<ShowState>, settings: () => RemoteQueueSettings,
    installCommitted: (state: ShowState) => void, now: () => number = Date.now, onAuthorityFailure: () => void = () => {},
    onApplause?: RemoteApplause, onPhoto?: RemotePhoto, remoteCatalog?: RemoteCatalog): RemoteQueue {
    this.assertRemoteAuthority();
    if (this.remoteQueueOpened) throw new Error('Remote queue authority is already open.');
    const failAuthority = () => {
      this.authorityFault = true;
      // Notify only after the write gate is latched; observers can reenter.
      try {
        const result: unknown = onAuthorityFailure();
        if (result && typeof result === 'object' && 'then' in result) void Promise.resolve(result).catch(() => {});
      } catch {}
    };
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
        failAuthority();
        throw new Error('Show authority needs recovery. Restart the application before making further changes.');
      }
    }, now, (cleanup?: boolean) => { if (cleanup) this.assertAuthority(); else this.assertRemoteAuthority(); }, failAuthority, onApplause, onPhoto, remoteCatalog);
    this.remoteQueueOpened = true;
    return queue;
  }

  /** Host library search receives filenames only, never private directories. */
  mediaFilenames(): Record<string, string> {
    return Object.fromEntries(this.mediaLocations().map(row => [row.id, row.path.split(/[\\/]/).pop() ?? '']));
  }

  /** Saved locations for main-process storage checks. */
  mediaLocations(): Pick<StoredMedia, 'id' | 'path'>[] {
    return this.db.prepare('SELECT id, path FROM media').all() as Pick<StoredMedia, 'id' | 'path'>[];
  }

  /** Build a private lookup for portable recording matches without reading stored paths. */
  mediaFingerprints(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, fingerprint FROM media').all() as Pick<StoredMedia, 'id' | 'fingerprint'>[];
    return new Map(rows.map(row => [row.id, row.fingerprint]));
  }

  media(id: string): StoredMedia | undefined {
    return this.db.prepare('SELECT id, path, fingerprint FROM media WHERE id = ?').get(id) as StoredMedia | undefined;
  }

  byFingerprint(fingerprint: string): StoredMedia | undefined {
    return this.db.prepare('SELECT id, path, fingerprint FROM media WHERE fingerprint = ? LIMIT 1').get(fingerprint) as StoredMedia | undefined;
  }

  /** Content-identical local files share one host-only vote, independent of filenames or metadata. */
  localSongRatings(keys: LocalRecordingKey[]): SongRating[] {
    parseRecordingKeys(keys);
    if (keys.some(key => !isLocalRecordingKey(key))) throw new Error('Choose local library recordings for local ratings.');
    const read = this.db.prepare(`SELECT rating.value AS value FROM media
      LEFT JOIN local_song_ratings rating ON rating.fingerprint = media.fingerprint WHERE media.fingerprint = ? LIMIT 1`);
    return keys.map(recordingKey => {
      const row = read.get(recordingKey.slice(7)) as { value: number | null } | undefined;
      if (!row) throw new Error('Local rating recording is unavailable.');
      return { recordingKey, average: row.value, count: row.value === null ? 0 : 1, ownVote: row.value };
    });
  }

  /** Uses the sole show connection, so normal show backups retain local-only votes. */
  rateLocalSong(recordingKey: LocalRecordingKey, value: number | null): SongRating {
    this.assertAuthority();
    if (!isLocalRecordingKey(recordingKey) || !validHeartVote(value)) throw new Error('Choose a local recording and 1–10 stars, or clear its rating.');
    // Refuse unknown hashes rather than creating arbitrary host-side records.
    this.localSongRatings([recordingKey]);
    const fingerprint = recordingKey.slice(7);
    if (value === null) this.db.prepare('DELETE FROM local_song_ratings WHERE fingerprint = ?').run(fingerprint);
    else this.db.prepare(`INSERT INTO local_song_ratings (fingerprint, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(fingerprint, value, new Date().toISOString());
    return this.localSongRatings([recordingKey])[0];
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

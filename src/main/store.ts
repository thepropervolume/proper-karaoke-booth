import { DatabaseSync } from 'node:sqlite';
import type { MissingSongRequest } from '../domain/missing-request';
import type { HistoryEntry } from '../domain/collections';
import { Collections } from './collections';

/** The private path never leaves the main process. */
export interface StoredMedia {
  id: string;
  path: string;
  fingerprint: string;
}

/** One synchronous SQLite transaction commits state and any imported media together. */
export class Store<T> {
  private db: DatabaseSync;
  readonly collections: Collections;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS show_state (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, path TEXT NOT NULL, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), generation TEXT NOT NULL, position REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS missing_song_requests (id TEXT PRIMARY KEY, singer TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, created_at TEXT NOT NULL);`);
    this.collections = new Collections(this.db);
  }

  load(): T | undefined {
    const row = this.db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }

  save(state: T, media: StoredMedia[] = [], history?: HistoryEntry): void {
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

  media(id: string): StoredMedia | undefined {
    return this.db.prepare('SELECT id, path, fingerprint FROM media WHERE id = ?').get(id) as StoredMedia | undefined;
  }

  byFingerprint(fingerprint: string): StoredMedia | undefined {
    return this.db.prepare('SELECT id, path, fingerprint FROM media WHERE fingerprint = ? LIMIT 1').get(fingerprint) as StoredMedia | undefined;
  }

  checkpoint(generation: string, position: number): void {
    this.db.prepare('INSERT INTO checkpoint (id, generation, position) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation, position=excluded.position').run(generation, position);
  }

  position(generation: string): number {
    const row = this.db.prepare('SELECT position FROM checkpoint WHERE id = 1 AND generation = ?').get(generation) as { position: number } | undefined;
    return row?.position ?? 0;
  }

  addMissingSongRequest(request: MissingSongRequest): void {
    this.db.prepare('INSERT INTO missing_song_requests (id, singer, title, artist, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(request.id, request.singer, request.title, request.artist, request.createdAt);
  }

  missingSongRequests(): MissingSongRequest[] {
    const rows = this.db.prepare('SELECT id, singer, title, artist, created_at AS createdAt FROM missing_song_requests ORDER BY created_at DESC, rowid DESC').all() as unknown as MissingSongRequest[];
    return rows.map(row => ({ ...row }));
  }

  close(): void { this.db.close(); }
}

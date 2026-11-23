import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { KJ_PICKS_ID, type CollectionsAction, type CollectionsSnapshot, type HistoryEntry, type Playlist, type PlaylistItem } from '../domain/collections';
import { MAX_PLAYLIST_ENTRIES, type PlaylistDestination } from '../domain/playlist-transfer';

export { KJ_PICKS_ID };
function validString(value: unknown, maximum = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

/** Uses the same SQLite connection as the authoritative show store. */
export class Collections {
  constructor(private readonly db: DatabaseSync, private readonly assertWritable: () => void = () => {}) {
    db.exec(`CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, singer_id TEXT);
      CREATE TABLE IF NOT EXISTS playlist_items (playlist_id TEXT NOT NULL, version_id TEXT NOT NULL, PRIMARY KEY (playlist_id, version_id));
      CREATE TABLE IF NOT EXISTS performance_history (generation_id TEXT PRIMARY KEY, singer_id TEXT, singer TEXT NOT NULL, version_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, outcome TEXT NOT NULL, performed_at TEXT NOT NULL);`);
    db.prepare('INSERT OR IGNORE INTO playlists (id, name, singer_id) VALUES (?, ?, NULL)').run(KJ_PICKS_ID, 'KJ Picks');
  }

  /** Call only within the same transaction that persists successful show completion. */
  record(entry: HistoryEntry): void {
    this.assertWritable();
    if (!validString(entry.generationId) || entry.singerId !== null && !validString(entry.singerId) ||
        typeof entry.singer !== 'string' || (entry.singerId === null ? entry.singer !== '' : !validString(entry.singer)) ||
        !validString(entry.versionId) || !validString(entry.title) || typeof entry.artist !== 'string' || !validString(entry.at) || !['completed', 'skipped'].includes(entry.outcome)) throw new Error('Invalid performance history.');
    this.db.prepare('INSERT OR IGNORE INTO performance_history (generation_id, singer_id, singer, version_id, title, artist, outcome, performed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.generationId, entry.singerId, entry.singer, entry.versionId, entry.title, entry.artist, entry.outcome, entry.at);
  }

  snapshot(): CollectionsSnapshot {
    const playlists = this.db.prepare('SELECT id, name, singer_id AS singerId FROM playlists ORDER BY rowid').all() as unknown as Playlist[];
    const items = this.db.prepare('SELECT playlist_id AS playlistId, version_id AS versionId FROM playlist_items ORDER BY rowid').all() as unknown as PlaylistItem[];
    const history = this.db.prepare('SELECT generation_id AS generationId, singer_id AS singerId, singer, version_id AS versionId, title, artist, outcome, performed_at AS at FROM performance_history ORDER BY rowid DESC').all() as unknown as HistoryEntry[];
    return { playlists: playlists.map(p => ({ ...p })), items: items.map(i => ({ ...i })), history: history.map(h => ({ ...h })) };
  }

  playlistForTransfer(id: string): { name: string; versionIds: string[] } | null {
    const playlist = this.db.prepare('SELECT name FROM playlists WHERE id = ?').get(id) as { name: string } | undefined;
    if (!playlist) return null;
    const items = this.db.prepare('SELECT version_id AS versionId FROM playlist_items WHERE playlist_id = ? ORDER BY rowid').all(id) as { versionId: string }[];
    return { name: playlist.name, versionIds: items.map(item => item.versionId) };
  }

  /** Call within Store's write transaction so a whole imported list can roll back. */
  importMatches(destination: PlaylistDestination, versionIds: readonly string[], singers: readonly { id: string }[],
    versions: readonly { id: string }[]): { playlistId: string; added: number } {
    this.assertWritable();
    const allowed = new Set(versions.map(version => version.id));
    if (versionIds.length > MAX_PLAYLIST_ENTRIES || new Set(versionIds).size !== versionIds.length ||
        versionIds.some(id => !validString(id) || !allowed.has(id))) throw new Error('The available songs changed. Preview the playlist again.');
    const playlistId = destination.kind === 'kj' ? KJ_PICKS_ID : randomUUID();
    if (destination.kind === 'singer') this.mutate({ type: 'create', id: playlistId, name: destination.name, singerId: destination.singerId }, singers, versions);
    const add = this.db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, version_id) VALUES (?, ?)');
    let added = 0;
    for (const versionId of versionIds) added += Number(add.run(playlistId, versionId).changes);
    return { playlistId, added };
  }

  /** IDs must resolve in the current show; no arbitrary paths or personal data cross this boundary. */
  mutate(input: unknown, singers: readonly { id: string }[], versions: readonly { id: string }[]): void {
    this.assertWritable();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid playlist action.');
    const value = input as Record<string, unknown>;
    if (value.type === 'create') {
      if (!validString(value.id) || value.id === KJ_PICKS_ID || !validString(value.name, 100) || !validString(value.singerId) || !singers.some(s => s.id === value.singerId)) throw new Error('Choose a singer and a playlist name.');
      this.db.prepare('INSERT INTO playlists (id, name, singer_id) VALUES (?, ?, ?)').run(value.id, value.name.trim(), value.singerId);
      return;
    }
    if (value.type === 'add' || value.type === 'remove') {
      if (!validString(value.playlistId) || !validString(value.versionId) || !this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(value.playlistId)) throw new Error('Playlist not found.');
      if (value.type === 'add') {
        if (!versions.some(v => v.id === value.versionId)) throw new Error('Song not found.');
        this.db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, version_id) VALUES (?, ?)').run(value.playlistId, value.versionId);
      } else this.db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND version_id = ?').run(value.playlistId, value.versionId);
      return;
    }
    const _: CollectionsAction['type'] | unknown = value.type;
    throw new Error(`Unknown playlist action: ${String(_)}`);
  }
}

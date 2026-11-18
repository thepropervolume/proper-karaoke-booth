import type { DatabaseSync } from 'node:sqlite';
import { songIdentity } from '../domain/song-identity';
import { normalizeBlacklistIdentity } from '../domain/song-blacklist';

type Song = { id: string; artist: string; title: string };
type Request = { id: string; versionId: string };
type State = { versions: Song[]; requests: Request[] };

function state(value: unknown): State | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<State>;
  return Array.isArray(record.versions) && Array.isArray(record.requests) ? record as State : null;
}

/** Called inside the same transaction as the show-state write. */
export function recordQueuedSongs(db: DatabaseSync, before: unknown, after: unknown): void {
  const next = state(after);
  if (!next) return;
  const oldState = state(before);
  const previous = new Map((oldState?.requests ?? []).filter(request => request && typeof request.id === 'string')
    .map(request => [request.id, request.versionId]));
  const oldVersions = new Map((oldState?.versions ?? []).filter(version => version && typeof version.id === 'string').map(version => [version.id, version]));
  const versions = new Map(next.versions.filter(version => version && typeof version.id === 'string').map(version => [version.id, version]));
  const insert = db.prepare('INSERT OR IGNORE INTO song_queue_history (identity) VALUES (?)');
  for (const request of next.requests) {
    if (!request || typeof request.id !== 'string' || typeof request.versionId !== 'string') continue;
    const version = versions.get(request.versionId);
    if (version && typeof version.artist === 'string' && typeof version.title === 'string' && version.title.trim()) {
      const identity = songIdentity(version) ?? unknownArtistKey(version.title);
      const oldVersion = oldVersions.get(request.versionId);
      if (previous.get(request.id) === request.versionId && oldVersion &&
          typeof oldVersion.artist === 'string' && typeof oldVersion.title === 'string' && oldVersion.title.trim() &&
          (songIdentity(oldVersion) ?? unknownArtistKey(oldVersion.title)) === identity) continue;
      if (identity) insert.run(identity);
    }
  }
}

/** Caller reads through the sole show connection before applying a queue command. */
export function songSeenBefore(db: DatabaseSync, song: { artist: string; title: string }): boolean {
  const identity = songIdentity(song);
  if (!identity) return true;
  const query = db.prepare('SELECT 1 FROM song_queue_history WHERE identity = ?');
  return !!query.get(identity) || !!query.get(unknownArtistKey(song.title));
}

function unknownArtistKey(title: string): string {
  return JSON.stringify(['', normalizeBlacklistIdentity(title)]);
}

/** Preserve prior completed and skipped history plus requests present at upgrade. */
export function seedSongHistory(db: DatabaseSync): void {
  const insert = db.prepare('INSERT OR IGNORE INTO song_queue_history (identity) VALUES (?)');
  const played = db.prepare('SELECT artist, title FROM performance_history').all() as { artist: string; title: string }[];
  for (const song of played) {
    if (typeof song.artist === 'string' && typeof song.title === 'string') {
      const identity = songIdentity(song) ?? (song.title.trim() ? unknownArtistKey(song.title) : null);
      if (identity) insert.run(identity);
    }
  }
  const saved = db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string } | undefined;
  if (saved) recordQueuedSongs(db, undefined, JSON.parse(saved.value));
}

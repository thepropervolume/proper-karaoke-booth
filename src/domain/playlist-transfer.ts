import { isRecordingKey, type RecordingKey } from './song-rating';

export const MAX_PLAYLIST_FILE_BYTES = 1024 * 1024;
export const MAX_PLAYLIST_ENTRIES = 1000;
export type PlaylistTransferSong = { title: string; artist: string; recording: RecordingKey | null };
export type PlaylistFile = { format: 'tpv-playlist'; version: 1; name: string; songs: PlaylistTransferSong[] };
export type PlaylistMatchStatus = 'matched' | 'unavailable' | 'ambiguous' | 'unidentified' | 'duplicate';
export type PlaylistPreviewSong = Pick<PlaylistTransferSong, 'title' | 'artist'> & { status: PlaylistMatchStatus };
export type PlaylistDestination = { kind: 'singer'; singerId: string; name: string } | { kind: 'kj' };

export type PlaylistExportResult =
  | { status: 'saved'; count: number; omitted: number }
  | { status: 'cleanup-needed'; published: boolean }
  | { status: 'cancelled' | 'busy' | 'invalid' | 'too-large' | 'already-exists' | 'failed' };
export type PlaylistPreviewResult =
  | { status: 'ready'; token: string; name: string; songs: PlaylistPreviewSong[] }
  | { status: 'cancelled' | 'busy' | 'invalid' | 'failed' };
export type PlaylistApplyResult =
  | { status: 'imported'; playlistId: string; added: number; skipped: number }
  | { status: 'busy' | 'invalid' | 'stale' | 'no-matches' | 'failed' };

function exactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown, limit: number, canBeEmpty = false): value is string {
  return typeof value === 'string' && value.length <= limit && !value.includes('\0') && (canBeEmpty || !!value.trim());
}

export function parsePlaylistFile(value: unknown): PlaylistFile | null {
  if (!exactRecord(value, ['format', 'version', 'name', 'songs']) || value.format !== 'tpv-playlist' || value.version !== 1 ||
      !text(value.name, 100) || !Array.isArray(value.songs) || value.songs.length > MAX_PLAYLIST_ENTRIES) return null;
  const songs: PlaylistTransferSong[] = [];
  for (const song of value.songs) {
    if (!exactRecord(song, ['title', 'artist', 'recording']) || !text(song.title, 500) || !text(song.artist, 500, true) ||
        !(song.recording === null || isRecordingKey(song.recording))) return null;
    songs.push({ title: song.title, artist: song.artist, recording: song.recording });
  }
  return { format: 'tpv-playlist', version: 1, name: value.name.trim(), songs };
}

export function parsePlaylistDestination(value: unknown): PlaylistDestination | null {
  if (exactRecord(value, ['kind']) && value.kind === 'kj') return { kind: 'kj' };
  if (exactRecord(value, ['kind', 'singerId', 'name']) && value.kind === 'singer' && text(value.singerId, 500) && text(value.name, 100))
    return { kind: 'singer', singerId: value.singerId, name: value.name.trim() };
  return null;
}

export type PlaylistCandidate = { versionId: string; recording: RecordingKey; allowed: boolean };
export type PlaylistMatch = { status: PlaylistMatchStatus; versionId: string | null };

/** A similar name cannot establish recording identity. Refuse even an allowed match if the stored key is ambiguous. */
export function matchPlaylist(songs: readonly PlaylistTransferSong[], candidates: readonly PlaylistCandidate[]): PlaylistMatch[] {
  const byKey = new Map<RecordingKey, PlaylistCandidate[]>();
  for (const candidate of candidates) {
    const existing = byKey.get(candidate.recording);
    if (existing) existing.push(candidate);
    else byKey.set(candidate.recording, [candidate]);
  }
  const seen = new Set<string>();
  return songs.map(song => {
    if (!song.recording) return { status: 'unidentified', versionId: null };
    const matches = byKey.get(song.recording);
    if (!matches) return { status: 'unavailable', versionId: null };
    if (matches.length > 1) return { status: 'ambiguous', versionId: null };
    const [match] = matches;
    if (!match.allowed) return { status: 'unavailable', versionId: null };
    if (seen.has(match.versionId)) return { status: 'duplicate', versionId: null };
    seen.add(match.versionId);
    return { status: 'matched', versionId: match.versionId };
  });
}

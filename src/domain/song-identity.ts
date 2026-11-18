import { normalizeBlacklistIdentity } from './song-blacklist';

/** Song identity is independent of its provider and recording version. */
export function songIdentity(song: { artist: string; title: string }): string | null {
  if (!normalizeBlacklistIdentity(song.artist) || !normalizeBlacklistIdentity(song.title)) return null;
  return JSON.stringify([normalizeBlacklistIdentity(song.artist), normalizeBlacklistIdentity(song.title)]);
}

export function sameSong(left: { id: string; artist: string; title: string }, right: { id: string; artist: string; title: string }): boolean {
  if (left.id === right.id) return true;
  const identity = songIdentity(left);
  return identity !== null && identity === songIdentity(right);
}

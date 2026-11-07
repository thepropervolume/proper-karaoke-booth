export type MissingSongRequest = {
  id: string;
  singer: string;
  title: string;
  artist: string;
  createdAt: string;
};

/** Normalize untrusted form input at the main-process boundary. */
export function normalizeMissingRequest(value: unknown): { singer: string; title: string; artist: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.singer !== 'string' || typeof input.title !== 'string' || typeof input.artist !== 'string') return null;
  const singer = input.singer.trim(), title = input.title.trim(), artist = input.artist.trim();
  if (!singer || singer.length > 100 || !title || title.length > 200 || artist.length > 200) return null;
  return { singer, title, artist };
}

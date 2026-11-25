import type { GuestSnapshot, Song } from '../remote/client';

const historyKey = 'tpv-mobile-performance-history-v1';
const limit = 200;
export type SingerPerformance = { key: string; title: string; artist: string; observedAt: number };

export function mergePerformances(current: SingerPerformance[], snapshot: GuestSnapshot, songs: ReadonlyMap<string, Song>, now: number): SingerPerformance[] {
  const existing = new Set(current.map(performance => performance.key));
  const additions = snapshot.requests.flatMap(request => {
    const key = snapshot.showId + ':' + request.id;
    if (request.status !== 'completed' || existing.has(key)) return [];
    const song = songs.get(request.versionId);
    const title = (request.title || song?.title || '').trim();
    if (!title) return [];
    existing.add(key);
    return [{ key, title: title.slice(0, 500), artist: (request.artist || song?.artist || '').trim().slice(0, 500), observedAt: now }];
  });
  return additions.length ? [...additions.reverse(), ...current].slice(0, limit) : current;
}

function storageKey(email: string) { return historyKey + ':' + email.trim().toLowerCase(); }

export function getPerformances(email: string): SingerPerformance[] {
  if (!email) return [];
  try {
    const values: unknown = JSON.parse(localStorage.getItem(storageKey(email)) ?? '[]');
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is SingerPerformance => value && typeof value === 'object' &&
      typeof value.key === 'string' && value.key.length <= 300 &&
      typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 500 &&
      typeof value.artist === 'string' && value.artist.length <= 500 &&
      typeof value.observedAt === 'number' && Number.isFinite(value.observedAt)).slice(0, limit);
  } catch { return []; }
}

export function putPerformances(email: string, entries: SingerPerformance[]) {
  if (!email) return;
  try { localStorage.setItem(storageKey(email), JSON.stringify(entries)); }
  catch { /* The current session can still display in-memory history. */ }
}

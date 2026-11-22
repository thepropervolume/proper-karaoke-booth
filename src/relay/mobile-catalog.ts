import type { MobileSong } from '../mobile/show';
import type { BrowseSource } from '../mobile/browse-catalog';

export type MobileCatalogFilter = { source: BrowseSource; cursor: string | null };
type MobileCatalogRow = Pick<MobileSong, 'id' | 'title' | 'artist'>;
type MobileCatalogResult = { items: (MobileSong | MobileCatalogRow)[]; nextCursor?: string | null };

/** Reads our existing database snapshot, never the once-a-day upstream provider feed. */
export async function searchMobileCatalog(query: string, signal?: AbortSignal, fetcher: typeof fetch = fetch,
  { source, cursor }: MobileCatalogFilter = { source: 'karaokenerds', cursor: null }): Promise<MobileCatalogResult> {
  const timeout = AbortSignal.timeout(16_000);
  // Each catalog runs behind its own loopback service. The relay never receives
  // provider account credentials and keeps its loopback-only network sandbox.
  const address = source === 'karaokenerds' ?
    'http://127.0.0.1:8765/v1/catalog/public/tracks?' + new URLSearchParams({ q: query, limit: '50', ...(cursor && { cursor }) }) :
    'http://127.0.0.1:8768/search?' + new URLSearchParams({ source, q: query });
  const response = await fetcher(address,
    { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok || !response.body || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Catalog unavailable.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 1024 * 1024) throw new Error('Catalog unavailable.'); chunks.push(next.value); } }
  finally { void reader.cancel().catch(() => {}); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || !Array.isArray(value.items) || value.items.length > 50) throw new Error('Catalog unavailable.');
  if (source !== 'karaokenerds') {
    const code = source === 'karafun' ? /^\d{1,12}$/ : /^PH\d{3,9}$/;
    return { items: value.items.map((item: MobileCatalogRow) => {
      if (!item || typeof item.id !== 'string' || !code.test(item.id) || typeof item.title !== 'string' ||
        !item.title.trim() || item.title.length > 512 || typeof item.artist !== 'string' || item.artist.length > 512 ||
        /[\x00-\x1f\x7f]/.test(item.title + item.artist)) throw new Error('Catalog unavailable.');
      return { id: item.id, title: item.title, artist: item.artist };
    }), nextCursor: null };
  }
  const nextCursor = value.nextCursor ?? null;
  if (nextCursor !== null && (typeof nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(nextCursor))) throw new Error('Catalog unavailable.');
  const items: MobileSong[] = [], seen = new Set<string>();
  for (const item of value.items) {
    if (!item || typeof item.youtubeId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(item.youtubeId) || typeof item.artist !== 'string' || item.artist.length > 500 ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500 || typeof item.brandSlug !== 'string' || item.brandSlug.length > 200 ||
      /[\x00-\x1f\x7f]/.test(item.artist + item.title + item.brandSlug)) throw new Error('Catalog unavailable.');
    if (seen.has(item.youtubeId)) continue; seen.add(item.youtubeId);
    items.push({ id: `youtube_${item.youtubeId}`, provider: 'karaokenerds', videoId: item.youtubeId, title: item.title, artist: item.artist, ...(item.brandSlug ? { brand: item.brandSlug } : {}) });
  }
  return { items, nextCursor };
}

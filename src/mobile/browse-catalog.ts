import type { Song } from '../remote/client';
import { isRecordingKey } from '../domain/song-rating';
import { mobileJson } from './api';

export const BROWSE_SOURCES = ['karaokenerds', 'karafun', 'partytyme'] as const;
export type BrowseSource = typeof BROWSE_SOURCES[number];
export const BROWSE_LABELS: Record<BrowseSource, string> = {
  karaokenerds: 'Karaoke Nerds', karafun: 'KaraFun', partytyme: 'Party Tyme Pro',
};
export const CATALOG_CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
export type BrowseSong = Song & { source: BrowseSource; brand?: string };
export type BrowsePage = { items: BrowseSong[]; nextCursor: string | null };

export function chooseBrowseSources(values: readonly unknown[]): BrowseSource[] {
  return BROWSE_SOURCES.filter(value => values.includes(value));
}

export function parseBrowsePage(value: unknown, source: BrowseSource): BrowsePage {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items) || value.items.length > 50) throw new Error('Invalid catalog response.');
  const nextCursor = 'nextCursor' in value ? value.nextCursor : null;
  if (nextCursor !== null && (typeof nextCursor !== 'string' || !CATALOG_CURSOR.test(nextCursor))) throw new Error('Invalid catalog response.');
  const items = value.items.map((item: unknown): BrowseSong => {
    if (!item || typeof item !== 'object' || !('id' in item) || !('title' in item) || !('artist' in item) ||
      typeof item.id !== 'string' || !item.id || item.id.length > 200 || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 512 ||
      typeof item.artist !== 'string' || item.artist.length > 512 || /[\x00-\x1f\x7f]/.test(item.id + item.title + item.artist)) throw new Error('Invalid catalog song.');
    if (source === 'karaokenerds') {
      if (!/^youtube_[A-Za-z0-9_-]{11}$/.test(item.id)) throw new Error('Invalid catalog song.');
      const brand = 'brand' in item && typeof item.brand === 'string' && item.brand.length <= 200 ? item.brand : undefined;
      return { id: item.id, title: item.title, artist: item.artist, source, recordingId: `youtube:${item.id.slice(8)}`, ...(brand && { brand }) };
    }
    if ((source === 'karafun' && !/^\d{1,12}$/.test(item.id)) || (source === 'partytyme' && !/^PH\d{3,9}$/.test(item.id))) throw new Error('Invalid catalog song.');
    // The public Party Tyme Pro SKU is not a consumer recording ID.
    const recordingId = 'karafun:catalog:' + item.id;
    return { id: item.id, title: item.title, artist: item.artist, source, ...(source === 'karafun' && isRecordingKey(recordingId) && { recordingId }) };
  });
  return { items, nextCursor };
}

export async function browseCatalog(source: BrowseSource, query: string, cursor: string | null, signal: AbortSignal): Promise<BrowsePage> {
  // Keep compatibility with the original public Karaoke Nerds first page.
  const request = source === 'karaokenerds' && cursor === null ? { query } : { query, source, ...(cursor && { cursor }) };
  return parseBrowsePage(await mobileJson('/v1/mobile/catalog', request, { signal }), source);
}

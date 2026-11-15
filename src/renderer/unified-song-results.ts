import type { LibrarySearchVersion } from '../domain/unified-library';
import type { KaraFunSearchReply } from '../domain/karafun';
import type { YouTubeSearchResult } from '../domain/youtube-search';
import type { ProviderCatalogId, ProviderCatalogSearchResult, ProviderCatalogSong } from '../domain/provider-catalog';
import type { LibrarySort } from '../domain/library-view';

export type SongResultProvider = 'local' | 'youtube' | 'karaokenerds' | ProviderCatalogId;
export type SongResult = LibrarySearchVersion & {
  resultProvider: SongResultProvider; persisted: boolean; catalogOnly?: ProviderCatalogSong;
  durationSeconds?: number | null;
  karaFunReceipt?: { searchId: string; songId: string; catalog: 'catalog' | 'community' };
  youtubeSearchReceipt?: { searchId: string; videoId: string };
};
export const RESULT_PROVIDER_LABELS: Record<SongResultProvider, string> = {
  local: 'Imported', youtube: 'YouTube', karaokenerds: 'Karaoke Nerds', karafun: 'KaraFun', partytyme: 'Party Tyme', sunfly: 'Sunfly', stingray: 'Stingray',
};
export const RESULT_PROVIDER_COLORS: Record<SongResultProvider, string> = {
  local: '#601CE9', youtube: '#ff0033', karaokenerds: '#007bff', karafun: '#d5167a', partytyme: '#bb7b16', sunfly: '#d18300', stingray: '#278b91',
};
function identity(row: LibrarySearchVersion): string {
  return row.source?.provider === 'karafun' ? `karafun:${row.source.catalog}:${row.source.songId}` : row.source?.provider === 'youtube' ? `youtube:${row.source.videoId}` : `local:${row.id}`;
}
/** One exact-recording list; stored host metadata wins, and provider IDs never cross namespaces. */
export function unifiedSongResults(library: readonly LibrarySearchVersion[], savedIds: ReadonlySet<string>, input: {
  karaFun?: KaraFunSearchReply | null; youtube?: YouTubeSearchResult | null;
  catalogs?: readonly ProviderCatalogSearchResult[] | null; karaFunConnected: boolean; sort: LibrarySort;
}): SongResult[] {
  const rows: SongResult[] = [], seen = new Set<string>();
  const append = (row: SongResult) => { const key = row.catalogOnly ? row.catalogOnly.provider === 'karafun' ? `karafun:catalog:${row.catalogOnly.id}` : `catalog:${row.catalogOnly.provider}:${row.catalogOnly.id}` : identity(row); if (!seen.has(key)) { seen.add(key); rows.push(row); } };
  for (const row of library) append({ ...row, persisted: savedIds.has(row.id), resultProvider: row.source?.provider === 'karafun' ? 'karafun' : row.catalogTrack || row.source?.provider === 'youtube' && row.source.brandSlug ? 'karaokenerds' : row.source?.provider === 'youtube' ? 'youtube' : 'local' });
  if (input.karaFun?.status === 'ok' && input.karaFun.searchId) for (const song of input.karaFun.songs) append({
    id: `karafun-search:${song.catalog}:${song.songId}`, title: song.title, artist: song.artist,
    source: { provider: 'karafun', catalog: song.catalog, songId: song.songId }, rating: song.explicit === true ? 'explicit' : song.explicit === false ? 'clean' : 'unrated',
    resultProvider: 'karafun', persisted: false, durationSeconds: song.durationSeconds,
    karaFunReceipt: { searchId: input.karaFun.searchId, songId: song.songId, catalog: song.catalog },
  });
  if (input.youtube?.status === 'ok' && input.youtube.searchId) for (const song of input.youtube.songs) append({
    id: `youtube-search:${song.videoId}`, title: song.title, artist: song.artist || '', rating: 'unrated', source: { provider: 'youtube', videoId: song.videoId },
    resultProvider: 'youtube', persisted: false, durationSeconds: song.durationSeconds, youtubeSearchReceipt: { searchId: input.youtube.searchId, videoId: song.videoId },
  });
  for (const result of input.catalogs ?? []) if (result.status === 'ok' && !(result.provider === 'karafun' && input.karaFunConnected)) for (const song of result.songs) append({
    id: `catalog:${song.provider}:${song.id}`, title: song.title, artist: song.artist || '', rating: song.explicit === true ? 'explicit' : song.explicit === false ? 'clean' : 'unrated',
    resultProvider: song.provider, persisted: false, catalogOnly: song, durationSeconds: song.durationSeconds,
  });
  const compare = (a: string, b: string) => a.localeCompare(b, 'en-US', { sensitivity: 'base', numeric: true });
  if (input.sort.startsWith('title-')) rows.sort((a, b) => (input.sort === 'title-desc' ? -1 : 1) * (compare(a.title, b.title) || compare(a.artist, b.artist)));
  else if (input.sort.startsWith('artist-')) rows.sort((a, b) => (input.sort === 'artist-desc' ? -1 : 1) * (compare(a.artist, b.artist) || compare(a.title, b.title)));
  return rows;
}

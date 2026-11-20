import type { LibrarySearchVersion } from '../domain/unified-library';
import type { KaraFunSearchReply } from '../domain/karafun';
import type { PartyTymeSearchReply } from '../domain/partytyme';
import type { YouTubeSearchResult } from '../domain/youtube-search';
import type { ProviderCatalogId, ProviderCatalogSearchResult, ProviderCatalogSong } from '../domain/provider-catalog';
import type { LibrarySort } from '../domain/library-view';
import { normalizeBlacklistIdentity } from '../domain/song-blacklist';
import { sourceForVersion } from '../domain/source-visibility';

export type SongResultProvider = 'local' | 'youtube' | 'karaokenerds' | ProviderCatalogId;
export type SongResult = LibrarySearchVersion & {
  resultProvider: SongResultProvider; persisted: boolean; catalogOnly?: ProviderCatalogSong;
  durationSeconds?: number | null;
  karaFunReceipt?: { searchId: string; songId: string; catalog: 'catalog' | 'community' };
  partyTymeReceipt?: { searchId: string; videoId: string };
  youtubeSearchReceipt?: { searchId: string; videoId: string };
};
export const RESULT_PROVIDER_LABELS: Record<SongResultProvider, string> = {
  local: 'Imported', youtube: 'YouTube', karaokenerds: 'Karaoke Nerds', karafun: 'KaraFun', partytyme: 'Party Tyme', sunfly: 'Sunfly', stingray: 'Stingray',
};
export const RESULT_PROVIDER_COLORS: Record<SongResultProvider, string> = {
  local: '#601CE9', youtube: '#ff0033', karaokenerds: '#007bff', karafun: '#d5167a', partytyme: '#FACC15', sunfly: '#d18300', stingray: '#278b91',
};
// Artist/title are editable and different recordings can share them. Deduplicate
// only exact provider identities so a host edit wins without merging versions.
function identity(row: LibrarySearchVersion): string {
  return row.source?.provider === 'karafun' ? `karafun:${row.source.catalog}:${row.source.songId}` : row.source?.provider === 'partytyme' ? `partytyme:consumer:${row.source.videoId}` : row.source?.provider === 'youtube' ? `youtube:${row.source.videoId}` : `local:${row.id}`;
}
/** A display-only song match, never a recording ID or a replacement for host metadata. */
function songKey(artist: string | null | undefined, title: string): string | null {
  const normalize = (value: string) => normalizeBlacklistIdentity(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = normalize(artist ?? ''), t = normalize(title);
  return a && t ? JSON.stringify([a, t]) : null;
}
/** One exact-recording list; stored host metadata wins, and provider IDs never cross namespaces. */
export function unifiedSongResults(library: readonly LibrarySearchVersion[], savedIds: ReadonlySet<string>, input: {
  karaFun?: KaraFunSearchReply | null; youtube?: YouTubeSearchResult | null;
  partyTyme?: PartyTymeSearchReply | null; partyTymeConnected?: boolean;
  sourceVisibility?: Partial<Record<SongResultProvider, boolean>>;
  catalogs?: readonly ProviderCatalogSearchResult[] | null; karaFunConnected: boolean; sort: LibrarySort;
}): SongResult[] {
  const rows: SongResult[] = [], seen = new Set<string>();
  // Apply visibility before YouTube duplicate suppression: a hidden source
  // must not hide an otherwise eligible YouTube recording of the same song.
  const append = (row: SongResult) => { if (input.sourceVisibility?.[row.resultProvider] === false) return; const key = row.catalogOnly ? row.catalogOnly.provider === 'karafun' ? `karafun:catalog:${row.catalogOnly.id}` : `catalog:${row.catalogOnly.provider}:${row.catalogOnly.id}` : identity(row); if (!seen.has(key)) { seen.add(key); rows.push(row); } };
  for (const row of library) if ((row.source?.provider !== 'karafun' || input.karaFunConnected) && (row.source?.provider !== 'partytyme' || input.partyTymeConnected)) append({ ...row, persisted: savedIds.has(row.id), resultProvider: sourceForVersion(row) });
  if (input.partyTymeConnected && input.partyTyme?.status === 'ok' && input.partyTyme.searchId) for (const song of input.partyTyme.songs) append({
    id: `partytyme-search:consumer:${song.videoId}`, title: song.title, artist: song.artist, rating: 'unrated',
    source: { provider: 'partytyme', catalog: 'consumer', videoId: song.videoId }, resultProvider: 'partytyme', persisted: false,
    durationSeconds: song.durationSeconds, partyTymeReceipt: { searchId: input.partyTyme.searchId, videoId: song.videoId },
  });
  // Account state also fences replies received immediately before sign-out.
  if (input.karaFunConnected && input.karaFun?.status === 'ok' && input.karaFun.searchId) for (const song of input.karaFun.songs) append({
    id: `karafun-search:${song.catalog}:${song.songId}`, title: song.title, artist: song.artist,
    source: { provider: 'karafun', catalog: song.catalog, songId: song.songId }, rating: song.explicit === true ? 'explicit' : song.explicit === false ? 'clean' : 'unrated',
    resultProvider: 'karafun', persisted: false, durationSeconds: song.durationSeconds,
    karaFunReceipt: { searchId: input.karaFun.searchId, songId: song.songId, catalog: song.catalog },
  });
  if (input.youtube?.status === 'ok' && input.youtube.searchId) for (const song of input.youtube.songs) append({
    id: `youtube-search:${song.videoId}`, title: song.title, artist: song.artist || '', rating: 'unrated', source: { provider: 'youtube', videoId: song.videoId },
    resultProvider: 'youtube', persisted: false, durationSeconds: song.durationSeconds, youtubeSearchReceipt: { searchId: input.youtube.searchId, videoId: song.videoId },
  });
  // KaraFun has one authenticated search path; public metadata must not reappear
  // as an unplayable substitute when that account is disconnected.
  for (const result of input.catalogs ?? []) if (result.status === 'ok' && result.provider !== 'karafun' && !(result.provider === 'partytyme' && input.partyTymeConnected)) for (const song of result.songs) append({
    id: `catalog:${song.provider}:${song.id}`, title: song.title, artist: song.artist || '', rating: song.explicit === true ? 'explicit' : song.explicit === false ? 'clean' : 'unrated',
    resultProvider: song.provider, persisted: false, catalogOnly: song, durationSeconds: song.durationSeconds,
  });
  const discovery = (row: SongResult) => !!row.youtubeSearchReceipt;
  const availableSongs = new Set(rows.filter(row => row.resultProvider !== 'youtube').map(row => songKey(row.artist, row.title)).filter((key): key is string => key !== null));
  const savedYouTubeSongs = new Set(rows.filter(row => row.resultProvider === 'youtube' && !discovery(row)).map(row => songKey(row.artist, row.title)).filter((key): key is string => key !== null));
  const youtubeMetadata = new Map(input.youtube?.songs.map(song => [song.videoId, song]) ?? []);
  const visible = rows.filter(row => {
    if (row.resultProvider !== 'youtube') return true;
    const song = row.youtubeSearchReceipt ? youtubeMetadata.get(row.youtubeSearchReceipt.videoId) : undefined;
    const key = songKey(row.artist, row.title);
    // Video-title parsing is a guess: creators use both "Artist - Title" and
    // "Title - Artist". Check both only for that heuristic, never verified tags.
    const reverse = song?.metadataSource === 'video-title' ? songKey(row.title, row.artist) : null;
    return !(key && (availableSongs.has(key) || discovery(row) && savedYouTubeSongs.has(key)) || reverse && (availableSongs.has(reverse) || discovery(row) && savedYouTubeSongs.has(reverse)));
  });
  const priority = (row: SongResult) => row.resultProvider !== 'youtube' ? 0 : discovery(row) ? 2 : 1;
  const compare = (a: string, b: string) => a.localeCompare(b, 'en-US', { sensitivity: 'base', numeric: true });
  return visible.sort((a, b) => priority(a) - priority(b) ||
    (input.sort.startsWith('title-') ? (input.sort === 'title-desc' ? -1 : 1) * (compare(a.title, b.title) || compare(a.artist, b.artist)) :
      input.sort.startsWith('artist-') ? (input.sort === 'artist-desc' ? -1 : 1) * (compare(a.artist, b.artist) || compare(a.title, b.title)) : 0));
}

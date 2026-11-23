import type { CatalogRequestTrack } from './catalog-request';

export type Playlist = { id: string; name: string; singerId: string | null };
export type PlaylistItem = { playlistId: string; versionId: string };
export type HistoryEntry = { generationId: string; singerId: string | null; singer: string; versionId: string; title: string; artist: string; outcome: 'completed' | 'skipped'; at: string };
export type CollectionsSnapshot = { playlists: Playlist[]; items: PlaylistItem[]; history: HistoryEntry[] };
export type CollectionsAction =
  | { type: 'create'; id: string; name: string; singerId: string }
  | { type: 'add'; playlistId: string; versionId: string }
  | { type: 'remove'; playlistId: string; versionId: string };
export const KJ_PICKS_ID = 'kj-picks';
export type KjDiscoverySelection =
  | { kind: 'karafun'; searchId: string; catalog: 'catalog' | 'community'; songId: string }
  | { kind: 'partytyme' | 'youtube'; searchId: string; videoId: string }
  | { kind: 'karaokenerds'; track: CatalogRequestTrack };

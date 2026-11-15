/** Public account/search DTOs never contain account identity, sessions or media URLs. */
export type KaraFunAccountStatus = {
  state: 'disconnected' | 'connecting' | 'connected' | 'expired';
  revision: number;
  message?: string;
  persistence: 'memory-only' | 'os-protected';
};
export type KaraFunSong = {
  songId: string; catalog: 'catalog' | 'community'; title: string; artist: string;
  durationSeconds: number | null; explicit: boolean | null;
};
export type KaraFunSearchReply = { status: 'ok' | 'disconnected' | 'unavailable'; searchId?: string; songs: KaraFunSong[]; message?: string };
export type KaraFunPreparation = { versionId: string; phase: 'authorizing' | 'downloading' | 'checking' | 'ready' | 'failed'; received: number; total: number | null; message?: string };
export type KaraFunBridge = {
  status(): Promise<KaraFunAccountStatus>;
  signIn(): Promise<KaraFunAccountStatus>;
  signOut(): Promise<KaraFunAccountStatus>;
  search(query: string): Promise<KaraFunSearchReply>;
  request(input: { searchId: string; songId: string; catalog: 'catalog' | 'community'; singerId: string | null; requestId: string }): Promise<{ ok: boolean; versionId?: string; error?: string; notice?: string }>;
  preparations(): Promise<KaraFunPreparation[]>;
  retry(versionId: string): Promise<void>;
  subscribe(callback: (value: KaraFunAccountStatus) => void): () => void;
};

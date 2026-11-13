/** Metadata discovery only. These records never grant playback or become show versions. */
export const PROVIDER_CATALOG_IDS = ['karafun', 'partytyme', 'sunfly', 'stingray'] as const;
export type ProviderCatalogId = typeof PROVIDER_CATALOG_IDS[number];
export const PROVIDER_CATALOG_LABELS: Record<ProviderCatalogId, string> = {
  karafun: 'KaraFun', partytyme: 'Party Tyme', sunfly: 'Sunfly', stingray: 'Stingray',
};
export type ProviderCatalogSong = {
  provider: ProviderCatalogId; id: string; title: string; artist: string | null;
  providerSku?: string | null; explicit?: boolean | null; durationSeconds: number | null; language: string | null; webUrl: string | null; playbackAvailable: false;
};
export type ProviderCatalogStatus = {
  provider: ProviderCatalogId; label: string; configured: boolean; searchAvailable: boolean;
  playbackAvailable: false; message: string; catalogMode?: 'public' | 'developer';
};
export type ProviderCatalogSearchStatus = 'ok' | 'not-configured' | 'unauthorized' | 'rate-limited' |
  'unavailable' | 'invalid-response' | 'timed-out' | 'invalid-input';
export type ProviderCatalogSearchResult = {
  provider: ProviderCatalogId; label: string; status: ProviderCatalogSearchStatus;
  songs: ProviderCatalogSong[]; message: string;
};
export function isProviderCatalogId(value: unknown): value is ProviderCatalogId {
  return typeof value === 'string' && (PROVIDER_CATALOG_IDS as readonly string[]).includes(value);
}
export function validProviderQuery(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
}

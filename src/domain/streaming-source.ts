export type YouTubeSource = { provider: 'youtube'; videoId: string; brandSlug?: string };
export type KaraFunSource = { provider: 'karafun'; catalog: 'catalog' | 'community'; songId: string };
export type PartyTymeSource = { provider: 'partytyme'; catalog: 'consumer'; videoId: string };
export type StreamingSource = YouTubeSource | KaraFunSource | PartyTymeSource;

export function validStreamingSource(value: unknown): value is StreamingSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.provider === 'partytyme') return Object.keys(source).every(key => ['provider', 'catalog', 'videoId'].includes(key)) &&
    source.catalog === 'consumer' && typeof source.videoId === 'string' && /^[1-9]\d{0,11}$/.test(source.videoId);
  if (source.provider === 'karafun') return Object.keys(source).every(key => ['provider', 'catalog', 'songId'].includes(key)) &&
    (source.catalog === 'catalog' || source.catalog === 'community') && typeof source.songId === 'string' && /^[1-9]\d{0,11}$/.test(source.songId);
  return Object.keys(source).every(key => ['provider', 'videoId', 'brandSlug'].includes(key)) && source.provider === 'youtube' &&
    typeof source.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(source.videoId) &&
    (source.brandSlug === undefined || (typeof source.brandSlug === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(source.brandSlug)));
}

export function streamingSourceLabel(source?: StreamingSource): string {
  return source?.provider === 'karafun' ? 'KaraFun' : source?.provider === 'partytyme' ? 'Party Tyme' : source?.provider === 'youtube' ? 'YouTube' : 'Local';
}

/** Accept only an exact video identity or normal HTTPS YouTube watch/short links. */
export function youtubeIdentity(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let id: string | null = null;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v') : null;
      else if (/^\/(shorts|embed)\//.test(url.pathname)) id = url.pathname.split('/')[2] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export type StreamingSource = { provider: 'youtube'; videoId: string };

export function validStreamingSource(value: unknown): value is StreamingSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return Object.keys(source).length === 2 && source.provider === 'youtube' &&
    typeof source.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(source.videoId);
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

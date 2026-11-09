import type { CommunityCatalog } from './karaokenerds';

export type BrandMapping =
  | { status: 'resolved'; slug: string; name: string; upstreamBrand: string; matchedVideos: number; unmatchedVideos: number }
  | { status: 'unresolved'; slug: string; name: string; reason: 'no-matching-videos' | 'ambiguous-brand'; matchedVideos: number; unmatchedVideos: number };

/** Extract only a YouTube video identity. This does not authorize opening or downloading it. */
export function youtubeVideoId(value: string): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  let id: string | null = null;
  if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
    const match = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
    id = match?.[1] ?? null;
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) && url.pathname === '/watch') {
    const values = url.searchParams.getAll('v');
    id = values.length === 1 ? values[0] : null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/**
 * Match IDs parsed from one verified public brand page to the cached catalog.
 * A single upstream Brand value must explain all matches; uncertain or absent
 * evidence is returned for review instead of guessing from the name or slug.
 * Callers must ensure IDs were extracted from that page's track rows.
 */
export function mapBrandToCatalog(
  brand: { slug: string; name: string }, videoIds: readonly string[], catalog: CommunityCatalog,
): BrandMapping {
  if (typeof brand.slug !== 'string' || typeof brand.name !== 'string' || !brand.slug.trim() || !brand.name.trim() ||
      brand.slug.length > 300 || brand.name.length > 300 || /[\/\\\u0000-\u001f\u007f?#%]/u.test(brand.slug) ||
      /[\u0000-\u001f\u007f]/u.test(brand.name) || brand.slug.trim() !== brand.slug || brand.slug === '.' || brand.slug === '..')
    throw new Error('Invalid brand identity.');
  if (!Array.isArray(videoIds) || videoIds.length > 100_000 || videoIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id)))
    throw new Error('Invalid video identities.');
  const ids = new Set(videoIds);
  const byVideo = new Map<string, Set<string>>();
  for (const item of catalog.Items) {
    const id = youtubeVideoId(item.Watch);
    if (!id || !ids.has(id)) continue;
    const code = item.Brand;
    if (!code.trim()) continue;
    const values = byVideo.get(id) ?? new Set<string>();
    values.add(code);
    byVideo.set(id, values);
  }
  const matches = byVideo.size;
  const evidence = { slug: brand.slug, name: brand.name, matchedVideos: matches, unmatchedVideos: ids.size - matches };
  if (!matches) return { status: 'unresolved', ...evidence, reason: 'no-matching-videos' };
  const codes = new Set([...byVideo.values()].flatMap(values => [...values]));
  if (codes.size !== 1) return { status: 'unresolved', ...evidence, reason: 'ambiguous-brand' };
  return { status: 'resolved', ...evidence, upstreamBrand: [...codes][0] };
}

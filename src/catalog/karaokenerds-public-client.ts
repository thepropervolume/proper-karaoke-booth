/** Selected-brand enrichment from public pages; never contacts the private API. */
import { mapBrandToCatalog, youtubeVideoId, type BrandMapping } from './karaokenerds-brand-map';
import type { CommunityCatalog } from './karaokenerds';
import { extractBrandDirectory, extractBrandVideoIds } from './karaokenerds-web';

const PUBLIC_ORIGIN = 'https://www.karaokenerds.com';
const MAX_BYTES = 8 * 1024 * 1024;

async function readPublicPage(url: string, fetcher: typeof fetch): Promise<string> {
  try {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Accept: 'text/html' } });
    if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('Invalid page.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Page too large.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch { throw new Error('Could not load the public Karaoke Nerds page.'); }
}

/** Exactly two public pages for one selected brand; ambiguous joins remain unresolved. */
export async function resolveSelectedBrand(slug: string, catalog: CommunityCatalog, fetcher: typeof fetch = fetch): Promise<{ mapping: BrandMapping; matchedVideoIds: string[] }> {
  if (!slug || slug.length > 200 || /[\/\\\x00-\x1f\x7f?#%]/.test(slug) || slug === '.' || slug === '..') throw new Error('Invalid brand slug.');
  const directory = extractBrandDirectory(await readPublicPage(`${PUBLIC_ORIGIN}/Community`, fetcher));
  const brand = directory.find(entry => entry.slug === slug);
  if (!brand) throw new Error('Brand is not in the public directory.');
  const html = await readPublicPage(`${PUBLIC_ORIGIN}/Brand/${encodeURIComponent(brand.slug)}/`, fetcher);
  const pageIds = extractBrandVideoIds(html), mapping = mapBrandToCatalog(brand, pageIds, catalog);
  if (mapping.status !== 'resolved') return { mapping, matchedVideoIds: [] };
  const candidates = new Set(pageIds);
  const matchedVideoIds = [...new Set(catalog.Items.filter(item => item.Brand === mapping.upstreamBrand)
    .map(item => youtubeVideoId(item.Watch)).filter((id): id is string => id !== null && candidates.has(id)))];
  return { mapping, matchedVideoIds };
}

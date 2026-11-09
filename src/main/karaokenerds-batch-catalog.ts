/** Build a read-only batch preview from the central operator's saved snapshot. */
import { youtubeVideoId } from '../catalog/karaokenerds-brand-map';
import type { CommunityCatalogStore } from '../catalog/karaokenerds';
import { planKaraokeNerdsBatch, type BatchCandidate, type BatchPlan } from './karaokenerds-batch';

const key = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();

export type CatalogBatchPreview = {
  plan: BatchPlan;
  incompleteBrands: string[];
  incompleteArtists: string[];
};

/**
 * Only assert artist coverage after checking every matching raw feed row. A
 * video without a verified mapping, a unique ID, or matching saved identity
 * makes its selected artist and brand incomplete. This function never fetches
 * data or downloads videos; it consumes only the saved snapshot and metadata.
 */
export function previewCatalogBatch(store: CommunityCatalogStore, baseDirectory: string, selection: {
  brandSlugs: readonly string[]; artists: readonly string[];
}): CatalogBatchPreview {
  const catalog = store.read();
  if (!catalog) throw new Error('Catalog is not initialized.');
  if (!Array.isArray(selection.brandSlugs) || !Array.isArray(selection.artists) ||
      selection.brandSlugs.length > 500 || selection.artists.length > 500 ||
      [...selection.brandSlugs, ...selection.artists].some(value => typeof value !== 'string' || !key(value)))
    throw new Error('Invalid batch selection.');
  const brandKeys = new Set(selection.brandSlugs.map(key)), artistKeys = new Set(selection.artists.map(key));
  const brands = store.brandMappings(), brandByCode = new Map(brands.map(brand => [brand.upstreamBrand, brand]));
  const metadata = new Map(store.videoMetadata().map(video => [video.youtubeId, video]));
  const idCounts = new Map<string, number>();
  for (const item of catalog.Items) {
    const id = youtubeVideoId(item.Watch);
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  const invalidArtists = new Set<string>(), invalidBrands = new Set<string>(), foundArtists = new Set<string>();
  const candidates: BatchCandidate[] = [];
  for (const item of catalog.Items) {
    const artist = key(item.Artist), selectedArtist = artistKeys.has(artist);
    const brand = brandByCode.get(item.Brand), selectedBrand = brand !== undefined && brandKeys.has(key(brand.slug));
    if (!selectedArtist && !selectedBrand) continue;
    if (selectedArtist) foundArtists.add(artist);
    const id = youtubeVideoId(item.Watch), record = id ? metadata.get(id) : undefined;
    if (!id || idCounts.get(id) !== 1 || !brand || !record || record.brandSlug !== brand.slug) {
      if (selectedArtist) invalidArtists.add(artist);
      if (selectedBrand && brand) invalidBrands.add(key(brand.slug));
      continue;
    }
    const savedDates = store.videoDates(id);
    candidates.push({ video: { id, provider: 'karaokenerds', brandSlug: brand.slug, artist: item.Artist, title: item.Title, extension: 'mp4' },
      watchUrl: item.Watch,
      ytDlpMetadata: savedDates?.source === 'yt-dlp' ? { youtubeId: id, uploadDate: savedDates.uploadDate, provenance: 'yt-dlp' } : null });
  }
  const incompleteArtists = selection.artists.filter(name => invalidArtists.has(key(name)));
  const incompleteBrands = selection.brandSlugs.filter(slug => invalidBrands.has(key(slug)));
  const eligibleBrands = selection.brandSlugs.filter(slug => !invalidBrands.has(key(slug)));
  const completeArtists = selection.artists.filter(name => foundArtists.has(key(name)) && !invalidArtists.has(key(name)));
  return { plan: planKaraokeNerdsBatch(baseDirectory, candidates, { brandSlugs: eligibleBrands, artists: selection.artists, completeArtists }),
    incompleteBrands, incompleteArtists };
}

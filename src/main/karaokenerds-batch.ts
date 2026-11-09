/** Explicit, previewable batch planning; importing this module never starts work. */
import { youtubeVideoId } from '../catalog/karaokenerds-brand-map';
import { cachedVideoPath, planCachePaths, selectLatestByArtistTrack, type CacheVideo } from './karaokenerds-cache-plan';
import type { VideoDownloadResult } from './karaokenerds-ytdlp';

export type BatchCandidate = {
  video: CacheVideo;
  watchUrl: string;
  /** Only an independently verified video publication date belongs here. */
  verifiedPublicationDate?: string | null;
  /** A video-matched yt-dlp result; the upload date is an approximation. */
  ytDlpMetadata?: { youtubeId: string; uploadDate: string | null; provenance: 'yt-dlp' } | null;
};
export type ArtistDecision = { dateSource: 'verified-publication' | 'yt-dlp-upload' | 'sole-candidate'; approximate: boolean };
export type BatchPlan = {
  ready: { candidate: BatchCandidate; path: string; artistDecision?: ArtistDecision }[];
  collisions: { path: string; videoIds: string[] }[];
  unresolvedArtists: { artist: string; title: string; videoIds: string[]; reason: 'missing-publication-date' | 'incomplete-catalog' }[];
  invalidVideoIds: string[];
  missingBrands: string[];
  missingArtists: string[];
};

function key(value: string): string { return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase(); }
function validCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function dateEvidence(candidate: BatchCandidate): { date: string; source: 'verified-publication' | 'yt-dlp-upload' } | null {
  const publication = candidate.verifiedPublicationDate;
  if (typeof publication === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(publication) &&
      validCalendarDay(publication.slice(0, 10)) && Number.isFinite(Date.parse(publication)))
    return { date: publication, source: 'verified-publication' };
  const metadata = candidate.ytDlpMetadata;
  if (!metadata || metadata.provenance !== 'yt-dlp' || metadata.youtubeId !== candidate.video.id ||
      typeof metadata.uploadDate !== 'string' || !validCalendarDay(metadata.uploadDate)) return null;
  return { date: metadata.uploadDate, source: 'yt-dlp-upload' };
}
function selections(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 500 || values.some(value => typeof value !== 'string' || !key(value))) throw new Error('Invalid batch selection.');
  const unique = new Map<string, string>();
  for (const value of values) { const normalized = key(value); if (unique.has(normalized)) throw new Error('Duplicate batch selection.'); unique.set(normalized, value.trim()); }
  return [...unique.values()];
}

/**
 * Brand selections take all eligible videos; artist selections add only the
 * latest publication for each artist/title, using yt-dlp upload dates as a
 * labeled fallback. The two selections are a
 * union. An unknown date in a multi-version artist group requires review, but
 * does not suppress an explicitly selected brand's videos.
 *
 * The caller must supply only independently resolved brand mappings and must
 * explicitly identify artists whose eligible catalog coverage is complete;
 * no subset may be presented as the catalog-wide newest version. The caller
 * must not pass the feed's Created or yt-dlp release_date as publication
 * dates. No network or filesystem writes occur here.
 */
export function planKaraokeNerdsBatch(baseDirectory: string, candidates: readonly BatchCandidate[], input: {
  brandSlugs: readonly string[]; artists: readonly string[]; completeArtists?: readonly string[];
}): BatchPlan {
  if (!Array.isArray(candidates) || candidates.length > 1_000_000) throw new Error('Invalid catalog candidates.');
  const brands = selections(input.brandSlugs), artists = selections(input.artists);
  const brandKeys = new Set(brands.map(key)), artistKeys = new Set(artists.map(key));
  const completeKeys = new Set(selections(input.completeArtists ?? []).map(key));
  if ([...completeKeys].some(value => !artistKeys.has(value))) throw new Error('Completeness may only be asserted for a selected artist.');
  const foundBrands = new Set<string>(), foundArtists = new Set<string>();
  const byId = new Map<string, BatchCandidate>();
  for (const candidate of candidates) {
    if (!candidate || !candidate.video || typeof candidate.video.id !== 'string' || !youtubeVideoId(candidate.watchUrl) ||
        youtubeVideoId(candidate.watchUrl) !== candidate.video.id || candidate.video.provider !== 'karaokenerds' ||
        typeof candidate.video.brandSlug !== 'string' || !key(candidate.video.brandSlug) ||
        typeof candidate.video.artist !== 'string' || !key(candidate.video.artist) ||
        typeof candidate.video.title !== 'string' || !key(candidate.video.title) || byId.has(candidate.video.id))
      throw new Error('Invalid or duplicate catalog candidate.');
    byId.set(candidate.video.id, candidate);
    if (brandKeys.has(key(candidate.video.brandSlug))) foundBrands.add(key(candidate.video.brandSlug));
    if (artistKeys.has(key(candidate.video.artist))) foundArtists.add(key(candidate.video.artist));
  }
  const selected = new Map<string, BatchCandidate>();
  for (const candidate of candidates) if (brandKeys.has(key(candidate.video.brandSlug))) selected.set(candidate.video.id, candidate);
  const incompleteGroups = new Map<string, BatchCandidate[]>();
  for (const candidate of candidates) {
    const artist = key(candidate.video.artist);
    if (!artistKeys.has(artist) || completeKeys.has(artist)) continue;
    const groupKey = JSON.stringify([artist, key(candidate.video.title)]);
    const group = incompleteGroups.get(groupKey) ?? [];
    group.push(candidate); incompleteGroups.set(groupKey, group);
  }
  const artistCandidates = candidates.filter(candidate => artistKeys.has(key(candidate.video.artist)) && completeKeys.has(key(candidate.video.artist)));
  const groups = new Map<string, BatchCandidate[]>();
  for (const candidate of artistCandidates) {
    const groupKey = JSON.stringify([key(candidate.video.artist), key(candidate.video.title)]);
    const group = groups.get(groupKey) ?? []; group.push(candidate); groups.set(groupKey, group);
  }
  const latest = selectLatestByArtistTrack(artistCandidates.map(candidate => ({ ...candidate.video, publishedAt: dateEvidence(candidate)?.date ?? null })));
  const artistDecisions = new Map<string, ArtistDecision>();
  for (const video of latest.selected) {
    const candidate = byId.get(video.id)!;
    const group = groups.get(JSON.stringify([key(video.artist), key(video.title)]))!;
    const evidence = dateEvidence(candidate);
    artistDecisions.set(video.id, { dateSource: evidence?.source ?? 'sole-candidate',
      approximate: group.some(item => dateEvidence(item)?.source === 'yt-dlp-upload') });
  }
  for (const video of latest.selected) selected.set(video.id, byId.get(video.id)!);
  const invalidVideoIds: string[] = [], valid: BatchCandidate[] = [];
  for (const candidate of selected.values()) {
    try { cachedVideoPath(baseDirectory, candidate.video); valid.push(candidate); }
    catch { invalidVideoIds.push(candidate.video.id); }
  }
  const paths = planCachePaths(baseDirectory, valid.map(candidate => candidate.video));
  return {
    ready: paths.ready.map(item => ({ candidate: byId.get(item.video.id)!, path: item.path,
      ...(artistDecisions.has(item.video.id) ? { artistDecision: artistDecisions.get(item.video.id)! } : {}) })), collisions: paths.collisions,
    unresolvedArtists: [...latest.unresolved, ...[...incompleteGroups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => {
      const ordered = [...group].sort((a, b) => a.video.id < b.video.id ? -1 : a.video.id > b.video.id ? 1 : 0);
      return { artist: ordered[0].video.artist, title: ordered[0].video.title, videoIds: ordered.map(item => item.video.id), reason: 'incomplete-catalog' as const };
    })], invalidVideoIds: invalidVideoIds.sort(),
    missingBrands: brands.filter(value => !foundBrands.has(key(value))), missingArtists: artists.filter(value => !foundArtists.has(key(value))),
  };
}

export type BatchRunResult = { results: { videoId: string; status: 'downloaded' | 'exists' | 'cancelled' | 'failed'; cleanupNeeded?: boolean }[]; remainingVideoIds: string[] };

/** Execute only a reviewed plan, serially, with no retries or implicit requests. */
export async function executeKaraokeNerdsBatch(plan: BatchPlan,
  download: (candidate: BatchCandidate, signal?: AbortSignal) => Promise<VideoDownloadResult>, signal?: AbortSignal): Promise<BatchRunResult> {
  const results: BatchRunResult['results'] = [];
  for (let index = 0; index < plan.ready.length; index++) {
    if (signal?.aborted) return { results, remainingVideoIds: plan.ready.slice(index).map(item => item.candidate.video.id) };
    const { candidate } = plan.ready[index];
    try {
      const outcome = await download(candidate, signal);
      results.push({ videoId: candidate.video.id, status: outcome.status, cleanupNeeded: outcome.cleanupNeeded });
      if (outcome.status === 'cancelled' || outcome.cleanupNeeded) return { results, remainingVideoIds: plan.ready.slice(index + 1).map(item => item.candidate.video.id) };
    } catch {
      results.push({ videoId: candidate.video.id, status: signal?.aborted ? 'cancelled' : 'failed' });
      // A sanitized failure may hide an incomplete staging cleanup or a child
      // process still stopping; never start the next download until reviewed.
      return { results, remainingVideoIds: plan.ready.slice(index + 1).map(item => item.candidate.video.id) };
    }
    if (signal?.aborted) return { results, remainingVideoIds: plan.ready.slice(index + 1).map(item => item.candidate.video.id) };
  }
  return { results, remainingVideoIds: [] };
}

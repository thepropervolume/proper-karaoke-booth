/** Read-only, snapshot-consistent catalog search adapter for the MySQL service. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { CommunityCatalog } from './karaokenerds';
import type { CatalogMetadata, CatalogReader, CatalogSearch, CatalogStatus, CatalogTrack } from './karaokenerds-http';
import { youtubeVideoId } from './karaokenerds-brand-map';

export type CatalogReadSnapshot = {
  catalog: CommunityCatalog;
  brandMappings: readonly { slug: string; upstreamBrand: string }[];
  videoMetadata: readonly { youtubeId: string; brandSlug: string }[];
  videoDates: readonly { youtubeId: string; uploadDate: string | null; source: string }[];
  /** Monotonic database revision updated atomically with public catalog changes. */
  revision: string;
  lastAttempt: number | null;
  lastSuccess: number | null;
};
export type CatalogSnapshotStore = {
  searchSnapshot: () => Promise<CatalogReadSnapshot>;
  searchMetadata?: () => Promise<CatalogMetadata>;
};

const TOKEN = /^[A-Za-z0-9_-]{1,512}$/;
const REVISION = /^(?:0|[1-9][0-9]{0,19})$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const UNSAFE_TEXT = /[<>\x00-\x1f\x7f\ufffd]/u;
const norm = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function cleanText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim().length > 0 && !UNSAFE_TEXT.test(value);
}
function cleanSlug(value: unknown): value is string {
  return cleanText(value, 200) && value !== '.' && value !== '..' && !/[\/\\?#%]/u.test(value);
}
function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function validate(request: CatalogSearch): void {
  if (!request || typeof request.query !== 'string' || typeof request.artist !== 'string' || typeof request.brandSlug !== 'string' ||
      request.query.length > 200 || request.artist.length > 200 || UNSAFE_TEXT.test(request.query) || UNSAFE_TEXT.test(request.artist) ||
      (request.brandSlug !== '' && !cleanSlug(request.brandSlug)) ||
      !(request.cursor === null || typeof request.cursor === 'string' && TOKEN.test(request.cursor)) ||
      !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new Error('Invalid catalog search.');
}
function criteria(request: CatalogSearch): string {
  return createHash('sha256').update(JSON.stringify([norm(request.query), norm(request.artist), norm(request.brandSlug)])).digest('hex');
}
function readCursor(cursor: string, revision: string, fingerprint: string): number {
  try {
    const raw = Buffer.from(cursor, 'base64url');
    if (raw.length > 384 || raw.toString('base64url') !== cursor) throw new Error();
    const value: unknown = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || record.revision !== revision || record.criteria !== fingerprint ||
        !Number.isSafeInteger(record.offset) || (record.offset as number) < 1) throw new Error();
    return record.offset as number;
  } catch { throw new Error('Catalog cursor is invalid or stale.'); }
}
function cursor(revision: string, fingerprint: string, offset: number): string {
  return Buffer.from(JSON.stringify({ version: 1, revision, criteria: fingerprint, offset })).toString('base64url');
}

function validatedMetadata({ revision, lastAttempt, lastSuccess }: CatalogMetadata): Readonly<CatalogMetadata> {
  const timestamp = (value: unknown) => value === null || Number.isSafeInteger(value) && (value as number) >= 0;
  if (typeof revision !== 'string' || !REVISION.test(revision)) throw new Error('Invalid catalog revision.');
  if (!timestamp(lastAttempt) || !timestamp(lastSuccess)) throw new Error('Invalid catalog timestamp.');
  return Object.freeze({ revision, lastAttempt, lastSuccess });
}

/**
 * Revalidates a sorted public projection at most every 30 seconds by default.
 * Concurrent reads share the revalidation. A failed validation serves no stale
 * results, and cursors remain tied to the public data revision.
 */
export function createMySqlCatalogReader(store: CatalogSnapshotStore, options: { cacheTtlMs?: number; now?: () => number } = {}): CatalogReader & { status: () => Promise<CatalogStatus> } {
  const ttl = options.cacheTtlMs ?? 30_000, now = options.now ?? (() => Math.floor(performance.now()));
  if (!store || typeof store.searchSnapshot !== 'function' || !Number.isSafeInteger(ttl) || ttl < 0 || ttl > 60_000 || typeof now !== 'function')
    throw new Error('Invalid catalog reader configuration.');
  type IndexedTrack = Readonly<{ track: Readonly<CatalogTrack>; artist: string; title: string; brand: string; combined: string }>;
  type TrackIndex = ReadonlyMap<string, readonly IndexedTrack[]>;
  type Projection = Readonly<{ tracks: readonly IndexedTrack[]; artists: TrackIndex; brands: TrackIndex;
    metadata: Readonly<CatalogMetadata>; recordCount: number; expiresAt: number }>;
  let cached: Projection | undefined, inFlight: Promise<Projection> | undefined;
  function clock(): number {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value + ttl)) throw new Error('Invalid catalog clock.');
    return value;
  }
  function project(snapshot: CatalogReadSnapshot): Projection {
    if (!snapshot || !snapshot.catalog || !Array.isArray(snapshot.catalog.Items) || !Array.isArray(snapshot.brandMappings) ||
        !Array.isArray(snapshot.videoMetadata) || !Array.isArray(snapshot.videoDates)) throw new Error('Invalid catalog snapshot.');
    const metadata = validatedMetadata(snapshot);
    const brands = new Map<string, string>(), slugs = new Set<string>();
    for (const brand of snapshot.brandMappings) {
      if (!brand || !cleanText(brand.upstreamBrand, 200) || !cleanSlug(brand.slug) || brands.has(brand.upstreamBrand) || slugs.has(brand.slug)) throw new Error('Ambiguous brand mapping.');
      brands.set(brand.upstreamBrand, brand.slug); slugs.add(brand.slug);
    }
    const videos = new Map<string, string>();
    for (const video of snapshot.videoMetadata) {
      if (!video || typeof video.youtubeId !== 'string' || !VIDEO.test(video.youtubeId) || !cleanSlug(video.brandSlug) || videos.has(video.youtubeId)) throw new Error('Ambiguous video mapping.');
      videos.set(video.youtubeId, video.brandSlug);
    }
    const dates = new Map<string, string | null>();
    for (const date of snapshot.videoDates) {
      if (!date || typeof date.youtubeId !== 'string' || !VIDEO.test(date.youtubeId) || dates.has(date.youtubeId)) throw new Error('Ambiguous video dates.');
      dates.set(date.youtubeId, date.source === 'yt-dlp' ? dateOrNull(date.uploadDate) : null);
    }
    const counts = new Map<string, number>();
    for (const item of snapshot.catalog.Items) {
      const id = item && typeof item.Watch === 'string' ? youtubeVideoId(item.Watch) : null;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const tracks: CatalogTrack[] = [];
    for (const item of snapshot.catalog.Items) {
      if (!item || !cleanText(item.Artist, 500) || !cleanText(item.Title, 500) || !cleanText(item.Brand, 200) || typeof item.Watch !== 'string') continue;
      const id = youtubeVideoId(item.Watch), mappedBrand = brands.get(item.Brand);
      if (!id || counts.get(id) !== 1) continue;
      const mappedVideo = videos.get(id);
      if (mappedVideo !== undefined && mappedVideo !== mappedBrand) continue;
      // A brand code alone does not prove a video's verified directory slug.
      const slug = mappedVideo === undefined ? '' : mappedVideo;
      tracks.push({ artist: item.Artist, title: item.Title, brandSlug: slug, brandCode: item.Brand,
        youtubeId: id, uploadDate: dates.get(id) ?? null });
    }
    const indexed = tracks.map(track => {
      const artist = norm(track.artist), title = norm(track.title);
      return Object.freeze({ track: Object.freeze(track), artist, title, brand: norm(track.brandSlug), combined: `${artist} ${title}` });
    });
    indexed.sort((a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title) || cmp(a.track.brandSlug, b.track.brandSlug) || cmp(a.track.youtubeId, b.track.youtubeId));
    function indexBy(field: 'artist' | 'brand'): TrackIndex {
      const groups = new Map<string, IndexedTrack[]>();
      for (const item of indexed) {
        if (!item[field]) continue;
        const group = groups.get(item[field]);
        if (group) group.push(item);
        else groups.set(item[field], [item]);
      }
      return groups;
    }
    return Object.freeze({ tracks: Object.freeze(indexed), artists: indexBy('artist'), brands: indexBy('brand'),
      metadata, recordCount: snapshot.catalog.Items.length, expiresAt: clock() + ttl });
  }
  async function projection(): Promise<Projection> {
    if (cached && clock() < cached.expiresAt) return cached;
    if (inFlight) return inFlight;
    const previous = cached;
    cached = undefined;
    const task = (async () => {
      if (previous && store.searchMetadata) {
        const metadata = validatedMetadata(await store.searchMetadata());
        // A failed upstream attempt can update freshness without changing any recordings.
        if (metadata.revision === previous.metadata.revision) return Object.freeze({ ...previous, metadata, expiresAt: clock() + ttl });
      }
      return project(await store.searchSnapshot());
    })();
    inFlight = task;
    try { const value = await task; cached = value; return value; }
    finally { if (inFlight === task) inFlight = undefined; }
  }
  return { async status() {
    const data = await projection();
    return { ...data.metadata, recordCount: data.recordCount, searchableCount: data.tracks.length };
  }, async search(request) {
    validate(request);
    const data = await projection(), metadata = data.metadata;
    const fingerprint = criteria(request), offset = request.cursor === null ? 0 : readCursor(request.cursor, metadata.revision, fingerprint);
    const q = norm(request.query), artist = norm(request.artist), brand = norm(request.brandSlug), terms = q ? q.split(' ') : [];
    const artistTracks = artist ? data.artists.get(artist) ?? [] : data.tracks;
    const brandTracks = brand ? data.brands.get(brand) ?? [] : data.tracks;
    const candidates = artistTracks.length <= brandTracks.length ? artistTracks : brandTracks;
    const items: CatalogTrack[] = []; let matched = 0, more = false;
    for (const item of candidates) {
      if (!terms.every(term => item.combined.includes(term)) || artist && item.artist !== artist || brand && item.brand !== brand) continue;
      if (matched++ < offset) continue;
      if (items.length < request.limit) items.push(item.track);
      else { more = true; break; }
    }
    if (offset > matched) throw new Error('Catalog cursor is invalid or stale.');
    const next = offset + items.length;
    return { items, nextCursor: more ? cursor(metadata.revision, fingerprint, next) : null, metadata };
  } };
}

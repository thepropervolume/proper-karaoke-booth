/** Read-only, snapshot-consistent catalog search adapter for the MySQL service. */
import { createHash } from 'node:crypto';
import type { CommunityCatalog } from './karaokenerds';
import type { CatalogReader, CatalogSearch, CatalogTrack } from './karaokenerds-http';
import { youtubeVideoId } from './karaokenerds-brand-map';

export type CatalogReadSnapshot = {
  catalog: CommunityCatalog;
  brandMappings: readonly { slug: string; upstreamBrand: string }[];
  videoMetadata: readonly { youtubeId: string; brandSlug: string }[];
  videoDates: readonly { youtubeId: string; uploadDate: string | null; source: string }[];
  /** Monotonic database revision updated atomically with public catalog changes. */
  revision: string;
};
export type CatalogSnapshotStore = { searchSnapshot: () => Promise<CatalogReadSnapshot> };

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

/**
 * Searches one database-consistent snapshot per request. Only mapped and
 * unambiguous videos are returned. A snapshot revision change invalidates a
 * cursor rather than silently skipping or repeating results. The snapshot
 * store must use a read-only repeatable-read transaction; no SQL is built
 * from search input. One in-flight search bounds memory on small hosts.
 */
export function createMySqlCatalogReader(store: CatalogSnapshotStore): CatalogReader {
  if (!store || typeof store.searchSnapshot !== 'function') throw new Error('Invalid catalog reader configuration.');
  let busy = false;
  return { async search(request) {
    validate(request);
    if (busy) throw new Error('Catalog search is busy.');
    busy = true;
    try {
      const snapshot = await store.searchSnapshot();
      if (!snapshot || !snapshot.catalog || !Array.isArray(snapshot.catalog.Items) || !Array.isArray(snapshot.brandMappings) ||
          !Array.isArray(snapshot.videoMetadata) || !Array.isArray(snapshot.videoDates) || typeof snapshot.revision !== 'string' ||
          !REVISION.test(snapshot.revision)) throw new Error('Invalid catalog snapshot.');
      const fingerprint = criteria(request), offset = request.cursor === null ? 0 : readCursor(request.cursor, snapshot.revision, fingerprint);
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
      const q = norm(request.query), artist = norm(request.artist), brand = norm(request.brandSlug);
      const tracks: CatalogTrack[] = [];
      for (const item of snapshot.catalog.Items) {
        if (!item || !cleanText(item.Artist, 512) || !cleanText(item.Title, 512) || !cleanText(item.Brand, 200) || typeof item.Watch !== 'string') continue;
        const id = youtubeVideoId(item.Watch), slug = brands.get(item.Brand);
        if (!id || counts.get(id) !== 1 || !slug || videos.get(id) !== slug) continue;
        const itemArtist = norm(item.Artist), itemTitle = norm(item.Title);
        if (q && !itemArtist.includes(q) && !itemTitle.includes(q) || artist && itemArtist !== artist || brand && norm(slug) !== brand) continue;
        tracks.push({ artist: item.Artist, title: item.Title, brandSlug: slug, youtubeId: id, uploadDate: dates.get(id) ?? null });
      }
      tracks.sort((a, b) => cmp(norm(a.artist), norm(b.artist)) || cmp(norm(a.title), norm(b.title)) || cmp(a.brandSlug, b.brandSlug) || cmp(a.youtubeId, b.youtubeId));
      if (offset > tracks.length) throw new Error('Catalog cursor is invalid or stale.');
      const items = tracks.slice(offset, offset + request.limit), next = offset + items.length;
      return { items, nextCursor: next < tracks.length ? cursor(snapshot.revision, fingerprint, next) : null };
    } finally { busy = false; }
  } };
}

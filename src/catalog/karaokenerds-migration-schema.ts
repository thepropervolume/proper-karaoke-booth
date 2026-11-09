/** Validation of a private catalog export; independent of either database driver. */
import { createHash } from 'node:crypto';
import type { CommunityCatalog } from './karaokenerds';

export type CatalogMigrationPayload = {
  snapshot: CommunityCatalog;
  lastAttempt: number;
  lastSuccess: number | null;
  sqliteRetirement: { state: 'retired'; retiredAt: number; attemptOutstanding: false };
  brandMappings: { slug: string; name: string; upstreamBrand: string; observedAt: number }[];
  videoMetadata: { youtubeId: string; brandSlug: string; producerTrackCode: string | null; codeSource: string | null }[];
  videoDates: { youtubeId: string; uploadDate: string | null; releaseDate: string | null; source: 'yt-dlp'; observedAt: number }[];
};
export type CatalogMigrationExport = CatalogMigrationPayload & {
  integrity: { sha256: string; snapshotItems: number; brands: number; videos: number; videoDates: number };
};

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 253402300799999;
const validText = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const validSlug = (v: unknown): v is string => validText(v, 200) && v !== '.' && v !== '..' && !/[\/\\?#]/.test(v);
function validDate(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number(v.slice(0, 4)) < 1000) return false;
  const date = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === v;
}
function hash(payload: CatalogMigrationPayload): string {
  const ordered = { snapshot: payload.snapshot, lastAttempt: payload.lastAttempt, lastSuccess: payload.lastSuccess, sqliteRetirement: payload.sqliteRetirement,
    brandMappings: payload.brandMappings, videoMetadata: payload.videoMetadata, videoDates: payload.videoDates };
  return createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex');
}
function invalid(): never { throw new Error('Invalid catalog migration export.'); }

/** The digest covers JSON.stringify of the payload fields in declared order. */
export function validateSQLiteExport(value: unknown): CatalogMigrationExport {
  if (!object(value) || !object(value.snapshot) || !Array.isArray(value.snapshot.Items) || value.snapshot.Items.length === 0 || value.snapshot.Items.length > 1_000_000 ||
      !validTime(value.lastAttempt) || !(value.lastSuccess === null || validTime(value.lastSuccess) && value.lastSuccess <= value.lastAttempt) ||
      !object(value.sqliteRetirement) || Object.keys(value.sqliteRetirement).sort().join(',') !== 'attemptOutstanding,retiredAt,state' ||
      value.sqliteRetirement.state !== 'retired' || !validTime(value.sqliteRetirement.retiredAt) ||
      value.sqliteRetirement.retiredAt > value.lastAttempt || value.sqliteRetirement.attemptOutstanding !== false ||
      !Array.isArray(value.brandMappings) || value.brandMappings.length > 100_000 || !Array.isArray(value.videoMetadata) || value.videoMetadata.length > 1_000_000 ||
      !Array.isArray(value.videoDates) || value.videoDates.length > 1_000_000 || !object(value.integrity)) return invalid();
  for (const item of value.snapshot.Items) {
    if (!object(item) || !Number.isSafeInteger(item.Id) || !['Artist', 'Title', 'Brand', 'Watch'].every(k => typeof item[k] === 'string' && (item[k] as string).length > 0 && (item[k] as string).length <= 16_384) ||
        !(item.Created === null || typeof item.Created === 'string' && item.Created.length <= 16_384)) return invalid();
  }
  const slugs = new Set<string>(), slugKeys = new Set<string>(), codes = new Set<string>();
  for (const item of value.brandMappings) {
    if (!object(item) || !validSlug(item.slug) || !validText(item.name, 200) || !validText(item.upstreamBrand, 200) || !validTime(item.observedAt) ||
        slugKeys.has(item.slug.toLowerCase()) || codes.has(item.upstreamBrand.toLowerCase())) return invalid();
    slugs.add(item.slug); slugKeys.add(item.slug.toLowerCase()); codes.add(item.upstreamBrand.toLowerCase());
  }
  const ids = new Set<string>();
  for (const item of value.videoMetadata) {
    if (!object(item) || typeof item.youtubeId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(item.youtubeId) || !validSlug(item.brandSlug) ||
        !slugs.has(item.brandSlug) || ids.has(item.youtubeId) || !((item.producerTrackCode === null && item.codeSource === null) ||
        (validText(item.producerTrackCode, 128) && (item.codeSource === 'host-confirmed' || item.codeSource === 'creator-catalog')))) return invalid();
    ids.add(item.youtubeId);
  }
  const dated = new Set<string>();
  for (const item of value.videoDates) {
    if (!object(item) || typeof item.youtubeId !== 'string' || !ids.has(item.youtubeId) || dated.has(item.youtubeId) ||
        !validDate(item.uploadDate) || !validDate(item.releaseDate) || item.source !== 'yt-dlp' || !validTime(item.observedAt)) return invalid();
    dated.add(item.youtubeId);
  }
  const payload = { snapshot: value.snapshot, lastAttempt: value.lastAttempt, lastSuccess: value.lastSuccess, sqliteRetirement: value.sqliteRetirement,
    brandMappings: value.brandMappings, videoMetadata: value.videoMetadata, videoDates: value.videoDates } as CatalogMigrationPayload;
  const check = value.integrity;
  if (typeof check.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(check.sha256) || check.sha256 !== hash(payload) ||
      check.snapshotItems !== payload.snapshot.Items.length || check.brands !== payload.brandMappings.length ||
      check.videos !== payload.videoMetadata.length || check.videoDates !== payload.videoDates.length) return invalid();
  return { ...payload, integrity: { sha256: check.sha256, snapshotItems: payload.snapshot.Items.length, brands: payload.brandMappings.length,
    videos: payload.videoMetadata.length, videoDates: payload.videoDates.length } };
}

export function catalogMigrationIntegrity(payload: CatalogMigrationPayload): CatalogMigrationExport['integrity'] {
  return { sha256: hash(payload), snapshotItems: payload.snapshot.Items.length, brands: payload.brandMappings.length,
    videos: payload.videoMetadata.length, videoDates: payload.videoDates.length };
}

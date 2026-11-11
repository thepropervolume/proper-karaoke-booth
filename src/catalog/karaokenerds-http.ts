/** Read-only catalog HTTP boundary. Importing this module opens no listener. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type CatalogSearch = { query: string; artist: string; brandSlug: string; cursor: string | null; limit: number };
export type CatalogTrack = { artist: string; title: string; brandSlug: string; youtubeId: string; uploadDate: string | null; brandCode?: string };
export type CatalogMetadata = { revision: string; lastAttempt: number | null; lastSuccess: number | null };
export type CatalogStatus = CatalogMetadata & { recordCount: number; searchableCount: number };
export type CatalogSearchResult = { items: readonly CatalogTrack[]; nextCursor: string | null; metadata?: CatalogMetadata };

/** Store implementations must parameterize all user-controlled query values. */
export type CatalogReader = { search: (request: CatalogSearch) => Promise<CatalogSearchResult>; status?: () => Promise<CatalogStatus> };
export type CatalogHttpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

const TOKEN = /^[A-Za-z0-9._~-]{32,256}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const FORBIDDEN = /[\x00-\x1f\x7f\ufffd]/u;

function plain(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !FORBIDDEN.test(value);
}
function slug(value: unknown): value is string {
  return plain(value, 200) && value !== '.' && value !== '..' && !/[\/\\?#%]/u.test(value);
}
function validDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function reply(response: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) });
  response.end(data);
}
function searchFromUrl(raw: string | undefined): CatalogSearch | null {
  if (!raw || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//')) return null;
  let url: URL;
  try { url = new URL(raw, 'http://localhost'); } catch { return null; }
  if (url.pathname !== '/v1/catalog/tracks' || url.hash) return null;
  const accepted = new Set(['q', 'artist', 'brand', 'cursor', 'limit']);
  for (const key of url.searchParams.keys()) if (!accepted.has(key) || url.searchParams.getAll(key).length !== 1) return null;
  const query = url.searchParams.get('q') ?? '', artist = url.searchParams.get('artist') ?? '', brandSlug = url.searchParams.get('brand') ?? '';
  const cursor = url.searchParams.get('cursor'), rawLimit = url.searchParams.get('limit');
  if ((query && !plain(query, 200)) || (artist && !plain(artist, 200)) || (brandSlug && !slug(brandSlug)) ||
      (cursor !== null && !CURSOR.test(cursor)) || (rawLimit !== null && !/^(?:[1-9]|[1-9]\d|100)$/.test(rawLimit))) return null;
  return { query, artist, brandSlug, cursor, limit: rawLimit === null ? 25 : Number(rawLimit) };
}
function projectTrack(input: CatalogTrack): CatalogTrack {
  if (!input || !plain(input.artist, 500) || !plain(input.title, 500) || !(input.brandSlug === '' || slug(input.brandSlug)) ||
      typeof input.youtubeId !== 'string' || !VIDEO.test(input.youtubeId) || !validDate(input.uploadDate) ||
      (input.brandCode !== undefined && !plain(input.brandCode, 200))) throw new Error('Invalid catalog result.');
  // Return only explicitly approved fields, even if the database row contains secrets or paths.
  return { artist: input.artist, title: input.title, brandSlug: input.brandSlug, youtubeId: input.youtubeId, uploadDate: input.uploadDate,
    ...(input.brandCode === undefined ? {} : { brandCode: input.brandCode }) };
}
function projectMetadata(input: CatalogMetadata): CatalogMetadata {
  const timestamp = (value: unknown) => value === null || Number.isSafeInteger(value) && (value as number) >= 0;
  if (!input || typeof input.revision !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(input.revision) ||
      !timestamp(input.lastAttempt) || !timestamp(input.lastSuccess)) throw new Error('Invalid catalog metadata.');
  return { revision: input.revision, lastAttempt: input.lastAttempt, lastSuccess: input.lastSuccess };
}
function projectStatus(input: CatalogStatus): CatalogStatus {
  const metadata = projectMetadata(input);
  if (!Number.isSafeInteger(input.recordCount) || input.recordCount < 0 || !Number.isSafeInteger(input.searchableCount) ||
      input.searchableCount < 0 || input.searchableCount > input.recordCount) throw new Error('Invalid catalog status.');
  return { ...metadata, recordCount: input.recordCount, searchableCount: input.searchableCount };
}

/**
 * Creates an authenticated handler. Deploy only behind a TLS terminator with
 * transport protections and rate limiting; bearer tokens must not be logged.
 * The caller owns listener binding, token provisioning and lifecycle.
 */
export function createCatalogHttpHandler(options: { token: string; reader: CatalogReader }): CatalogHttpHandler {
  if (!TOKEN.test(options.token) || !options.reader || typeof options.reader.search !== 'function') throw new Error('Invalid catalog service configuration.');
  const tokenHash = createHash('sha256').update(options.token, 'utf8').digest();
  return async (request, response) => {
    try {
      const authCount = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'authorization').length;
      const rawAuth = request.headers.authorization;
      const match = typeof rawAuth === 'string' && rawAuth.match(/^Bearer ([A-Za-z0-9._~-]{32,256})$/);
      const candidate = createHash('sha256').update(match ? match[1] : '', 'utf8').digest();
      if (authCount !== 1 || !match || !timingSafeEqual(tokenHash, candidate)) { reply(response, 401, { error: 'Unauthorized' }); return; }
      if (request.method !== 'GET') { reply(response, 405, { error: 'Method not allowed' }); return; }
      if (request.url === '/v1/catalog/status') {
        if (typeof options.reader.status !== 'function') throw new Error('Catalog status is unavailable.');
        reply(response, 200, projectStatus(await options.reader.status())); return;
      }
      const search = searchFromUrl(request.url);
      if (!search) { reply(response, 400, { error: 'Invalid request' }); return; }
      const result = await options.reader.search(search);
      if (!result || !Array.isArray(result.items) || result.items.length > search.limit ||
          !(result.nextCursor === null || typeof result.nextCursor === 'string' && CURSOR.test(result.nextCursor))) throw new Error('Invalid catalog result.');
      reply(response, 200, { items: result.items.map(projectTrack), nextCursor: result.nextCursor,
        ...(result.metadata === undefined ? {} : { metadata: projectMetadata(result.metadata) }) });
    } catch { if (!response.headersSent) reply(response, 503, { error: 'Catalog unavailable' }); else response.destroy(); }
  };
}

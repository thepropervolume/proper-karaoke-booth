/** Validate public guest DTOs before a response can change client identity or receipts. */
import type { Outcome, RequestStatus } from '../domain';
import type { GuestSnapshot, Song } from './client';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const text = (value: unknown, max: number, minimum = 0): value is string => typeof value === 'string' && value.length >= minimum && value.length <= max && (minimum === 0 || value.trim().length > 0) && !/[\u0000-\u001f\u007f\ufffd]/u.test(value);
const invalid = (): never => { throw new Error('The show response could not be validated.'); };
const statuses = new Set<RequestStatus>(['pending', 'accepted', 'staged', 'playing', 'completed', 'skipped', 'removed', 'rejected', 'withdrawn']);

function songs(value: unknown, limit: number): Song[] {
  if (!Array.isArray(value) || value.length > limit) return invalid();
  const seen = new Set<string>(), result: Song[] = [];
  for (const item of value) {
    if (!record(item) || !fields(item, ['id', 'title', 'artist']) || !id(item.id) || seen.has(item.id) || !text(item.title, 500, 1) || !text(item.artist, 500)) return invalid();
    seen.add(item.id); result.push({ id: item.id, title: item.title, artist: item.artist });
  }
  return result;
}

export function parseGuestAdmission(value: unknown): { showId: string; hostEpoch: string; revision: number } {
  if (!record(value) || !fields(value, ['showId', 'hostEpoch', 'revision']) || !id(value.showId) || !id(value.hostEpoch) || !integer(value.revision)) return invalid();
  return { showId: value.showId, hostEpoch: value.hostEpoch, revision: value.revision };
}

export function parseGuestJoin(value: unknown): { session: string; singerId: string } {
  if (!record(value) || !fields(value, ['session', 'singerId']) || typeof value.session !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.session) || !id(value.singerId)) return invalid();
  return { session: value.session, singerId: value.singerId };
}

export function parseGuestCatalog(value: unknown, offset: number, limit: number): { revision: number; items: Song[]; nextOffset: number | null } {
  if (!record(value) || !fields(value, ['revision', 'items', 'nextOffset']) || !integer(value.revision) || !integer(offset) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !(value.nextOffset === null || integer(value.nextOffset) && value.nextOffset === offset + limit)) return invalid();
  const items = songs(value.items, limit);
  if (value.nextOffset !== null && items.length !== limit) return invalid();
  return { revision: value.revision, items, nextOffset: value.nextOffset };
}

export function parseGuestSnapshot(value: unknown): GuestSnapshot {
  if (!record(value) || !fields(value, ['showId', 'hostEpoch', 'revision', 'singerId', 'singerName', 'catalog', 'catalogNextOffset', 'requests'], ['unavailableUntilMs', 'serverNowMs', 'requestsTruncated']) ||
      !id(value.showId) || !id(value.hostEpoch) || !integer(value.revision) || !id(value.singerId) || !text(value.singerName, 100) ||
      value.unavailableUntilMs !== undefined && !integer(value.unavailableUntilMs) || value.serverNowMs !== undefined && !integer(value.serverNowMs) ||
      value.requestsTruncated !== undefined && typeof value.requestsTruncated !== 'boolean' || !Array.isArray(value.requests) || value.requests.length > 50) return invalid();
  const catalog = parseGuestCatalog({ revision: value.revision, items: value.catalog, nextOffset: value.catalogNextOffset }, 0, 50);
  const requests: GuestSnapshot['requests'] = [], seen = new Set<string>();
  for (const request of value.requests) {
    if (!record(request) || !fields(request, ['id', 'versionId', 'status']) || !text(request.id, 500, 1) || seen.has(request.id) || !id(request.versionId) || typeof request.status !== 'string' || !statuses.has(request.status as RequestStatus)) return invalid();
    seen.add(request.id); requests.push({ id: request.id, versionId: request.versionId, status: request.status as RequestStatus });
  }
  return { showId: value.showId, hostEpoch: value.hostEpoch, revision: value.revision, singerId: value.singerId, singerName: value.singerName,
    catalog: catalog.items, catalogNextOffset: catalog.nextOffset, requests,
    ...(value.unavailableUntilMs !== undefined ? { unavailableUntilMs: value.unavailableUntilMs as number } : {}),
    ...(value.serverNowMs !== undefined ? { serverNowMs: value.serverNowMs as number } : {}),
    ...(value.requestsTruncated !== undefined ? { requestsTruncated: value.requestsTruncated as boolean } : {}) };
}

export function parseGuestOutcome(value: unknown): Outcome {
  if (!record(value) || !integer(value.revision)) return invalid();
  if (value.ok === true && fields(value, ['ok', 'revision'])) return { ok: true, revision: value.revision };
  if (value.ok === false && fields(value, ['ok', 'code', 'message', 'revision']) && typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code) && text(value.message, 500, 1))
    return { ok: false, code: value.code, message: value.message, revision: value.revision };
  return invalid();
}
export function parseGuestOutcomeLookup(value: unknown): Outcome | null { return value === null ? null : parseGuestOutcome(value); }

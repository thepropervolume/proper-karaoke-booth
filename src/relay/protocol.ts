/** Bounded relay DTOs. No host control, file path, or provider credential belongs on this wire. */
import { isGuestRecordingId, isGuestSource, isGuestSourceList } from '../domain/guest-sources';
import { MAX_PHOTO_BODY_BYTES, MAX_PHOTO_DATA_URL, validPhotoDataUrl } from '../domain/photo';
import { projectGuestStage } from '../domain/guest-stage';
import type { Song } from '../remote/client';
export const RELAY_OPERATIONS = ['admission', 'join', 'resume', 'snapshot', 'catalog', 'outcome', 'request', 'withdraw', 'availability', 'missing-request', 'applause', 'photo'] as const;
export type RelayOperation = typeof RELAY_OPERATIONS[number];
export const RESERVED_SLUGS = ['api', 'v1', 'assets', 'singer', 'healthz', 'admin', 'host', 'login', 'logout', 'account', 'settings', 'status', 'help', 'support', 'robots', 'favicon', 'app', 'mobile'] as const;
export const MAX_GUEST_BODY_BYTES = 8192;
export const MAX_GUEST_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_HOST_REPLY_BYTES = 2 * 1024 * 1024;
export const MAX_REPLY_BATCH = 8;
export const REQUEST_STATUSES = ['pending', 'accepted', 'staged', 'playing', 'completed', 'skipped', 'removed', 'rejected', 'withdrawn'] as const;
export type HostOpen = { slug: string; openId: string };
export type RoomIdentity = { roomId: string; generation: string };
export type GuestRequest = { operation: RelayOperation; payload: Record<string, unknown>; session?: string };
export type GuestResponse = { status: 200 | 400 | 409; body: Record<string, unknown> | null };
export type HostReply = RoomIdentity & { responses: { requestId: string; status: 200 | 400 | 409; body: unknown }[] };

const BAD_TEXT = /[\x00-\x1f\x7f\ufffd]/u;
const record = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exact = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).length === fields.length &&
  fields.every(field => Object.prototype.hasOwnProperty.call(value, field));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max &&
  (empty || value.trim().length > 0) && !BAD_TEXT.test(value);
const domainId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const requestId = (value: unknown): value is string => text(value, 500);
export const isRelaySecret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isRelayUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isRelaySlug = (value: unknown): value is string => typeof value === 'string' &&
  /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(value) && !(RESERVED_SLUGS as readonly string[]).includes(value);
const operation = (value: unknown): value is RelayOperation => typeof value === 'string' && (RELAY_OPERATIONS as readonly string[]).includes(value);

/** Validate structure before serializing, including direct callers outside HTTP JSON parsing. */
function boundedJson(value: unknown, maxBytes: number, maxString = 65_536): boolean {
  const seen = new Set<object>(); let nodes = 0;
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 20_000 || depth > 8) return false;
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item === 'string') return item.length <= maxString;
    if (typeof item !== 'object' || seen.has(item)) return false;
    seen.add(item);
    if (Array.isArray(item)) return item.length <= 1024 && item.every(part => visit(part, depth + 1));
    if (!record(item)) return false;
    const keys = Object.keys(item);
    return keys.length <= 128 && keys.every(key => key.length <= 128 && !BAD_TEXT.test(key) && visit(item[key], depth + 1));
  }
  try { return visit(value, 0) && Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes; }
  catch { return false; }
}

export function parseHostOpen(input: unknown): HostOpen | null {
  try {
    return record(input) && exact(input, ['slug', 'openId']) && isRelaySlug(input.slug) && isRelayUuid(input.openId)
      ? { slug: input.slug, openId: input.openId } : null;
  } catch { return null; }
}
export function parseRoomIdentity(input: unknown): RoomIdentity | null {
  try {
    return record(input) && exact(input, ['roomId', 'generation']) && isRelayUuid(input.roomId) && isRelayUuid(input.generation)
      ? { roomId: input.roomId, generation: input.generation } : null;
  } catch { return null; }
}

/** Mirrors the desktop guest API, with admission scoped by the public relay room. */
export function parseGuestRequest(op: unknown, input: unknown, session?: unknown): GuestRequest | null {
  try {
    if (!operation(op) || !record(input) || !boundedJson(input, op === 'photo' ? MAX_PHOTO_BODY_BYTES : MAX_GUEST_BODY_BYTES,
      op === 'photo' ? MAX_PHOTO_DATA_URL : 65_536)) return null;
    const anonymous = op === 'admission' || op === 'join' || op === 'resume';
    if (anonymous ? session !== undefined && session !== null : !isRelaySecret(session)) return null;
    let payload: Record<string, unknown>;
    switch (op) {
      case 'admission':
      case 'snapshot':
        if (!exact(input, [])) return null;
        payload = {}; break;
      case 'join':
        if (!exact(input, ['joinId', 'resumeSecret', 'name', 'expectedRevision']) || !domainId(input.joinId) ||
            !isRelaySecret(input.resumeSecret) || !text(input.name, 100) || !integer(input.expectedRevision)) return null;
        payload = { joinId: input.joinId, resumeSecret: input.resumeSecret, name: input.name, expectedRevision: input.expectedRevision }; break;
      case 'resume':
        if (!exact(input, ['resumeSecret']) || !isRelaySecret(input.resumeSecret)) return null;
        payload = { resumeSecret: input.resumeSecret }; break;
      case 'catalog':
        if (!(exact(input, ['offset', 'limit']) || exact(input, ['offset', 'limit', 'query'])) || (input.query !== undefined && !text(input.query, 200, true)) || !integer(input.offset) || !integer(input.limit) || input.limit < 1 || input.limit > 100) return null;
        payload = { offset: input.offset, limit: input.limit, ...(input.query === undefined ? {} : { query: input.query }) }; break;
      case 'outcome':
        if (!exact(input, ['commandId']) || !domainId(input.commandId)) return null;
        payload = { commandId: input.commandId }; break;
      default: {
        if (!exact(input, ['command']) || !record(input.command)) return null;
        const command = input.command;
        if (op === 'missing-request') {
          if (!exact(command, ['commandId', 'title', 'artist']) || !domainId(command.commandId) || !text(command.title, 200) || !text(command.artist, 200, true)) return null;
          payload = { command: { commandId: command.commandId, title: command.title, artist: command.artist } }; break;
        }
        if (op === 'applause') {
          if (!exact(command, ['commandId', 'showId', 'hostEpoch', 'expectedRevision']) || !domainId(command.commandId) ||
              !domainId(command.showId) || !domainId(command.hostEpoch) || !integer(command.expectedRevision)) return null;
          payload = { command: { commandId: command.commandId, showId: command.showId, hostEpoch: command.hostEpoch,
            expectedRevision: command.expectedRevision } }; break;
        }
        if (op === 'photo') {
          if (!exact(command, ['commandId', 'showId', 'hostEpoch', 'expectedRevision', 'dataUrl']) || !domainId(command.commandId) ||
              !domainId(command.showId) || !domainId(command.hostEpoch) || !integer(command.expectedRevision) || !validPhotoDataUrl(command.dataUrl)) return null;
          payload = { command: { commandId: command.commandId, showId: command.showId, hostEpoch: command.hostEpoch,
            expectedRevision: command.expectedRevision, dataUrl: command.dataUrl } }; break;
        }
        const field = op === 'request' ? 'versionId' : op === 'withdraw' ? 'requestId' : 'minutes';
        if (!exact(command, ['commandId', 'showId', 'hostEpoch', 'expectedRevision', field]) || !domainId(command.commandId) ||
            !domainId(command.showId) || !domainId(command.hostEpoch) || !integer(command.expectedRevision)) return null;
        if (op === 'request' ? !domainId(command.versionId) : op === 'withdraw' ? !requestId(command.requestId) :
            !integer(command.minutes) || command.minutes > 60) return null;
        payload = { command: { commandId: command.commandId, showId: command.showId, hostEpoch: command.hostEpoch,
          expectedRevision: command.expectedRevision, [field]: command[field] } };
      }
    }
    return { operation: op, payload, ...(anonymous ? {} : { session: session as string }) };
  } catch { return null; }
}

function songs(input: unknown, includeSources: boolean): Song[] | null {
  if (!Array.isArray(input) || input.length > 100) return null;
  const output: Song[] = [], ids = new Set<string>();
  for (const song of input) {
    if (!record(song) || !domainId(song.id) || ids.has(song.id) || !text(song.title, 500) || !text(song.artist, 500, true)) return null;
    const source = song.source, recordingId = song.recordingId;
    if (source !== undefined && !isGuestSource(source) || recordingId !== undefined && !isGuestRecordingId(recordingId, source)) return null;
    ids.add(song.id);
    output.push({ id: song.id, title: song.title, artist: song.artist,
      ...(includeSources && source !== undefined ? { source } : {}),
      ...(includeSources && recordingId !== undefined ? { recordingId } : {}) });
  }
  return output;
}
function outcome(input: unknown): Record<string, unknown> | null {
  if (!record(input) || !integer(input.revision)) return null;
  if (input.ok === true) return { ok: true, revision: input.revision };
  if (input.ok !== false || typeof input.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.code) || !text(input.message, 500)) return null;
  return { ok: false, code: input.code, message: input.message, revision: input.revision };
}

/** Strip all unapproved fields. Exceptions are generic and never forward raw Error messages. */
export function projectGuestResponse(op: unknown, status: unknown, input: unknown, includeSources = true, includeRotation = true): GuestResponse | null {
  try {
    if (!operation(op) || !boundedJson(input, MAX_GUEST_RESPONSE_BYTES)) return null;
    if (status === 400) return { status: 400, body: { error: 'Request could not be completed.' } };
    if (status === 409) return op === 'join' && record(input) && input.error === 'REVISION_CONFLICT'
      ? { status: 409, body: { error: 'REVISION_CONFLICT' } } : null;
    if (status !== 200) return null;
    if (op === 'outcome' && input === null) return { status: 200, body: null };
    if (!record(input)) return null;
    let body: Record<string, unknown> | null;
    switch (op) {
      case 'admission':
        if (!domainId(input.showId) || !domainId(input.hostEpoch) || !integer(input.revision)) return null;
        body = { showId: input.showId, hostEpoch: input.hostEpoch, revision: input.revision }; break;
      case 'join':
      case 'resume':
        if (!isRelaySecret(input.session) || !domainId(input.singerId)) return null;
        body = { session: input.session, singerId: input.singerId }; break;
      case 'catalog': {
        const items = songs(input.items, includeSources);
        if (!items || !integer(input.revision) || !(input.nextOffset === null || integer(input.nextOffset))) return null;
        body = { revision: input.revision, items, nextOffset: input.nextOffset }; break;
      }
      case 'snapshot': {
        const catalog = songs(input.catalog, includeSources);
        if (!catalog || !domainId(input.showId) || !domainId(input.hostEpoch) || !integer(input.revision) || !domainId(input.singerId) ||
            !text(input.singerName, 100, true) || !(input.catalogNextOffset === null || integer(input.catalogNextOffset)) ||
            !Array.isArray(input.requests) || input.requests.length > 50 ||
            (input.unavailableUntilMs !== undefined && !integer(input.unavailableUntilMs)) || (input.serverNowMs !== undefined && !integer(input.serverNowMs)) ||
            (input.requestsTruncated !== undefined && typeof input.requestsTruncated !== 'boolean') ||
            (input.applauseEnabled !== undefined && typeof input.applauseEnabled !== 'boolean') ||
            (input.photoEnabled !== undefined && typeof input.photoEnabled !== 'boolean') ||
            (input.sources !== undefined && !isGuestSourceList(input.sources)) ||
            (input.applauseCredits !== undefined && (!integer(input.applauseCredits) || input.applauseCredits > 5)) ||
            (input.points !== undefined && !integer(input.points))) return null;
        const requests: Record<string, unknown>[] = [], ids = new Set<string>();
        for (const request of input.requests) {
          if (!record(request) || !requestId(request.id) || ids.has(request.id) || !domainId(request.versionId) ||
              typeof request.status !== 'string' || !(REQUEST_STATUSES as readonly string[]).includes(request.status)) return null;
          const metadata = request.title !== undefined || request.artist !== undefined;
          if (metadata && (!text(request.title, 500) || !text(request.artist, 500, true))) return null;
          ids.add(request.id); requests.push({ id: request.id, versionId: request.versionId, status: request.status,
            ...(includeSources && metadata ? { title: request.title, artist: request.artist } : {}) });
        }
        const stage = includeRotation && input.stage !== undefined ? projectGuestStage(input.stage) : undefined;
        if (stage === null) return null;
        body = { showId: input.showId, hostEpoch: input.hostEpoch, revision: input.revision, singerId: input.singerId, singerName: input.singerName,
          catalog, catalogNextOffset: input.catalogNextOffset, requests, ...(stage ? { stage } : {}),
          ...(input.unavailableUntilMs === undefined ? {} : { unavailableUntilMs: input.unavailableUntilMs }),
          ...(input.serverNowMs === undefined ? {} : { serverNowMs: input.serverNowMs }),
          ...(input.requestsTruncated === undefined ? {} : { requestsTruncated: input.requestsTruncated }),
          ...(input.applauseEnabled === undefined ? {} : { applauseEnabled: input.applauseEnabled }),
          ...(input.photoEnabled === undefined ? {} : { photoEnabled: input.photoEnabled }),
          ...(includeSources && input.sources !== undefined ? { sources: input.sources } : {}),
          ...(input.applauseCredits === undefined ? {} : { applauseCredits: input.applauseCredits }),
          ...(input.points === undefined ? {} : { points: input.points }) }; break;
      }
      default: body = outcome(input); if (!body) return null;
    }
    return { status: 200, body };
  } catch { return null; }
}

/** Envelope validation only; the broker must project each body using its stored pending operation. */
export function parseHostReplyEnvelope(input: unknown): HostReply | null {
  try {
    if (!record(input) || !exact(input, ['roomId', 'generation', 'responses']) || !isRelayUuid(input.roomId) || !isRelayUuid(input.generation) ||
        !Array.isArray(input.responses) || input.responses.length < 1 || input.responses.length > MAX_REPLY_BATCH || !boundedJson(input, MAX_HOST_REPLY_BYTES)) return null;
    const responses: HostReply['responses'] = [], ids = new Set<string>();
    for (const reply of input.responses) {
      if (!record(reply) || !exact(reply, ['requestId', 'status', 'body']) || !isRelayUuid(reply.requestId) || ids.has(reply.requestId) ||
          (reply.status !== 200 && reply.status !== 400 && reply.status !== 409)) return null;
      ids.add(reply.requestId); responses.push({ requestId: reply.requestId, status: reply.status, body: reply.body });
    }
    return { roomId: input.roomId, generation: input.generation, responses };
  } catch { return null; }
}

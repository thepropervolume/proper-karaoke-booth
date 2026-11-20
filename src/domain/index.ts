import { validStreamingSource, type StreamingSource } from './streaming-source';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { futureRequestLimitMessage } from './future-request-limit';
import { compileSongBlacklist, type SongBlacklistMatcher } from './song-blacklist';
import { applyPointsEvent, newPointsLedger, type PointsLedger, type PointsEvent } from './points';
import { sameSong } from './song-identity';

/** Pure show rules. Callers authenticate actors and must persist the returned state,
 * including receipt-only updates, before acknowledging a command. */
export type Role = 'host' | 'staff' | 'singer' | 'engine';
export type Actor = { role: Role; id: string };
export type Rating = 'clean' | 'explicit' | 'unrated' | 'uncertain';
export type Version = { id: string; title: string; artist: string; rating: Rating;
  source?: StreamingSource; discoveryOrigin?: 'karaokenerds'; djCode?: string; trackNumber?: string; metadataAmbiguous?: boolean; metadataTemplate?: string; isDuet?: boolean };
export type Singer = { id: string; name: string; unavailableUntilMs?: number; archived?: boolean };
export type Policy = { ageRestricted: boolean; includeVersionIds: string[] | null; excludeVersionIds: string[] };
export type RequestStatus = 'pending' | 'accepted' | 'staged' | 'playing' | 'completed' | 'skipped' | 'removed' | 'rejected' | 'withdrawn';
// null means a song has no assigned person. Do not create a shared "anonymous"
// singer: that would accidentally share request limits and fair-rotation turns.
export type SongRequest = { id: string; singerId: string | null; coSingerId?: string | null; versionId: string; status: RequestStatus; round: number | null; order: number | null };
export type Playback = { requestId: string; generationId: string; status: 'playing' | 'paused' };
export type Command =
  | { type: 'addVersion'; version: Version }
  | { type: 'editVersion'; id: string; title: string; artist: string; isDuet?: boolean }
  | { type: 'addSinger'; singer: Singer }
  | { type: 'removeSinger'; singerId: string }
  | { type: 'setSingerAvailability'; singerId: string; minutes: number; releaseStaged?: boolean }
  | { type: 'request'; requestId: string; singerId: string | null; coSingerId?: string | null; versionId: string }
  | { type: 'accept'; requestId: string }
  | { type: 'removeRequest'; requestId: string }
  | { type: 'promoteRequest'; requestId: string }
  | { type: 'moveRequest'; requestId: string; beforeRequestId: string | null }
  | { type: 'resetQueueOrder' }
  | { type: 'editRequest'; requestId: string; singerId: string | null; coSingerId?: string | null; versionId: string }
  | { type: 'rejectRequest'; requestId: string }
  | { type: 'withdrawRequest'; requestId: string }
  | { type: 'stage'; requestId?: string }
  | { type: 'release' }
  | { type: 'start'; generationId: string }
  | { type: 'pause' } | { type: 'resume' } | { type: 'stop' } | { type: 'applause' } | { type: 'photo'; photoHash: string }
  | { type: 'complete'; generationId: string }
  | { type: 'skip'; generationId: string; confirmed: boolean }
  | { type: 'setPolicy'; policy: Policy };
export type Envelope = { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; actor: Actor; command: Command };
export type Outcome = { ok: true; revision: number } | { ok: false; code: string; message: string; revision: number };
type Receipt = { id: string; fingerprint: string; outcome: Outcome };
export type ShowState = {
  showId: string; hostEpoch: string; revision: number;
  singers: Singer[]; versions: Version[]; requests: SongRequest[];
  policy: Policy; currentRound: number; finalTurnBegun: boolean; nextOrder: number;
  stagedRequestId: string | null; playback: Playback | null; usedGenerationIds: string[];
  /** One explicit host override; optional for shows saved by older versions. */
  promotedRequestId?: string | null;
  /** Explicit host order. Missing/new requests follow their normal scheduling order. */
  manualQueueOrder?: string[];
  /** Absolute deadline, persisted across host restart. */
  nextStartAtMs?: number;
  /** Missing in older shows; each show starts its own scores and credits. */
  points?: PointsLedger;
  receipts: Receipt[];
};
export type CommandResult = { state: ShowState; outcome: Outcome };

export function createInitialState(showId: string, hostEpoch: string): ShowState {
  return { showId, hostEpoch, revision: 0, singers: [], versions: [], requests: [],
    policy: { ageRestricted: false, includeVersionIds: null, excludeVersionIds: [] },
    currentRound: 1, finalTurnBegun: false, nextOrder: 1, stagedRequestId: null,
    playback: null, usedGenerationIds: [], promotedRequestId: null, manualQueueOrder: [], receipts: [] };
}

export type BlacklistSettings = Partial<Pick<Settings, 'songBlacklist' | 'artistBlacklist'>>;
const blacklistMatcher = (settings: BlacklistSettings): SongBlacklistMatcher => compileSongBlacklist({
  songBlacklist: settings.songBlacklist === undefined ? [] : settings.songBlacklist,
  artistBlacklist: settings.artistBlacklist === undefined ? [] : settings.artistBlacklist,
});
function allowedVersion(state: ShowState, version: Version | undefined, blacklist: SongBlacklistMatcher): boolean {
  if (!version || state.policy.excludeVersionIds.includes(version.id)) return false;
  if (state.policy.includeVersionIds !== null && !state.policy.includeVersionIds.includes(version.id)) return false;
  return (!state.policy.ageRestricted || version.rating === 'clean') && !blacklist.isBlocked(version);
}
/** The same predicate must also guard catalog search and direct lookups. Host
 * blacklist rules remain in settings; they never become sticky show exclusions. */
export function isVersionAllowed(state: ShowState, versionId: string, settings: BlacklistSettings = {}): boolean {
  return allowedVersion(state, state.versions.find(v => v.id === versionId), blacklistMatcher(settings));
}
export function visibleVersions(state: ShowState, settings: BlacklistSettings = {}): Version[] {
  const blacklist = blacklistMatcher(settings);
  return state.versions.filter(version => allowedVersion(state, version, blacklist));
}

/** The clock comes from the caller; the gap never starts playback itself. */
export function remainingPauseSeconds(state: ShowState, nowMs: number): number {
  return Number.isFinite(state.nextStartAtMs) ? Math.ceil(Math.max(0, state.nextStartAtMs! - nowMs) / 1000) : 0;
}

export function singerAvailable(state: ShowState, singerId: string | null, nowMs: number): boolean {
  if (singerId === null) return true;
  return (state.singers.find(singer => singer.id === singerId)?.unavailableUntilMs ?? 0) <= nowMs;
}

function singerRequestLimit(state: ShowState, singerId: string | null, configured: number | undefined, nowMs: number): string | null {
  if (singerId === null) return null;
  if (!singerAvailable(state, singerId, nowMs)) {
    const message = futureRequestLimitMessage(state.requests, singerId, 1);
    if (message) return 'An unavailable singer may have at most one upcoming request. Existing requests are retained; return or remove requests before adding another.';
  }
  return futureRequestLimitMessage(state.requests, singerId, configured);
}

/** The staged request remains locked when the scheduling mode changes. */
export function orderedFuture(state: ShowState, mode: Settings['rotationMode'], nowMs = 0): SongRequest[] {
  // Precompute each singer's position once. Spreading an entire retained
  // history into Math.min can exceed the engine's argument limit, and
  // repeatedly filtering it during sorting grows quadratic with show history.
  const positions = new Map<string, number>();
  const deadlines = new Map(state.singers.map(s => [s.id, s.unavailableUntilMs ?? 0]));
  const available = (id: string | null | undefined) => id == null || (deadlines.get(id) ?? 0) <= nowMs;
  const requestAvailable = (request: SongRequest) => available(request.singerId) && available(request.coSingerId);
  const position = (request: SongRequest) => request.singerId === null ? request.order ?? Infinity : positions.get(request.singerId) ?? Infinity;
  const deadline = (id: string | null | undefined) => id == null ? 0 : deadlines.get(id) ?? 0;
  const requestDeadline = (request: SongRequest) => Math.max(deadline(request.singerId), deadline(request.coSingerId));
  const future: { request: SongRequest; index: number }[] = [];
  state.requests.forEach((request, index) => {
    if (request.singerId !== null && request.order !== null && !['removed', 'withdrawn', 'rejected'].includes(request.status)) {
      positions.set(request.singerId, Math.min(positions.get(request.singerId) ?? Infinity, request.order));
    }
    if (request.status === 'accepted' || request.status === 'staged') future.push({ request, index });
  });
  const manual = new Map((state.manualQueueOrder ?? []).map((id, index) => [id, index]));
  return future.sort((left, right) => {
    const a = left.request, b = right.request;
    return (a.status === 'staged' ? -1 : 0) - (b.status === 'staged' ? -1 : 0) ||
      (requestAvailable(a) ? 0 : 1) - (requestAvailable(b) ? 0 : 1) ||
      (!requestAvailable(a) && !requestAvailable(b) ? requestDeadline(a) - requestDeadline(b) : 0) ||
      (a.id === state.promotedRequestId ? -1 : 0) - (b.id === state.promotedRequestId ? -1 : 0) ||
      (manual.get(a.id) ?? Infinity) - (manual.get(b.id) ?? Infinity) ||
      // Request arrays are append-only, so this also preserves FIFO for older
      // shows and for requests approved in a different order than they arrived.
      (mode === 'fifo' ? left.index - right.index : a.round! - b.round! ||
        position(a) - position(b) || a.order! - b.order!);
  }).map(item => item.request);
}

function acceptRequest(state: ShowState, request: SongRequest): void {
  let round = state.currentRound + (state.finalTurnBegun ? 1 : 0);
  // An unassigned song is its own FIFO slot, never one synthetic singer with a
  // shared future-request limit or a turn reserved in every following round.
  while (request.singerId !== null && state.requests.some(r => r.singerId === request.singerId && r.round === round && !['removed', 'withdrawn', 'rejected'].includes(r.status))) round++;
  request.status = 'accepted'; request.round = round; request.order = state.nextOrder++;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function nonempty(s: unknown): s is string { return typeof s === 'string' && s.trim().length > 0; }
function permitted(actor: Actor, command: Command): boolean {
  if (actor.role === 'host') return command.type !== 'complete' && command.type !== 'withdrawRequest' && command.type !== 'photo';
  if (actor.role === 'engine') return command.type === 'complete';
  if (actor.role === 'staff') return command.type === 'addSinger' || command.type === 'request' || command.type === 'accept';
  return actor.role === 'singer' && (command.type === 'applause' || command.type === 'photo' || (command.type === 'request' && command.singerId === actor.id) || (command.type === 'setSingerAvailability' && command.singerId === actor.id && command.releaseStaged !== true) || command.type === 'withdrawRequest');
}

export type PointsHistoryContext = { songSeenBefore(version: Version): boolean };

// This is the pure decision layer: validate the actor/revision, deduplicate the
// command, and return a new state. The main process persists it before replying.
export function applyCommand(original: ShowState, envelope: Envelope, settings: Pick<Settings, 'autoApprove' | 'rotationMode'> & Partial<Pick<Settings, 'pauseIntervalSeconds' | 'maxFutureRequestsPerSinger' | 'songBlacklist' | 'artistBlacklist'>> & { pointsEnabled?: boolean; applauseEnabled?: boolean } = DEFAULT_SETTINGS, nowMs = 0, history?: PointsHistoryContext): CommandResult {
  const fail = (code: string, message: string): Outcome => ({ ok: false, code, message, revision: original.revision });
  // These checks are deliberately before receipt lookup: untrusted callers must not
  // learn stored outcomes or occupy command IDs. The service still authenticates actors.
  if (!envelope || !nonempty(envelope.commandId) || !envelope.actor || !nonempty(envelope.actor.id) || !envelope.command || !permitted(envelope.actor, envelope.command))
    return { state: original, outcome: fail('FORBIDDEN', 'Command is not permitted') };
  if (envelope.showId !== original.showId || envelope.hostEpoch !== original.hostEpoch)
    return { state: original, outcome: fail('STALE_SHOW', 'Show or host epoch does not match') };
  const fingerprint = canonical({ showId: envelope.showId, hostEpoch: envelope.hostEpoch, expectedRevision: envelope.expectedRevision, actor: envelope.actor, command: envelope.command });
  const prior = original.receipts.find(r => r.id === envelope.commandId);
  if (prior) return { state: original, outcome: prior.fingerprint === fingerprint ? prior.outcome : fail('COMMAND_ID_REUSED', 'Command ID was reused with different content') };
  // Work on a detached JSON value; failed commands can persist only their receipt.
  let state: ShowState = JSON.parse(JSON.stringify(original));
  const blacklist = blacklistMatcher(settings);
  const versionAllowed = (versionId: string) => allowedVersion(state, state.versions.find(version => version.id === versionId), blacklist);
  const error: { value: { code: string; message: string } | null } = { value: null };
  const reject = (code: string, message: string) => { error.value = { code, message }; };
  const cmd = envelope.command;
  // Applause and photos are independent guest actions, so another singer's
  // concurrent action should not invalidate them. Show/epoch, actor and receipt
  // checks still apply, and the output layer rechecks eligibility at delivery.
  if (envelope.expectedRevision !== original.revision && cmd.type !== 'applause' && cmd.type !== 'photo') reject('REVISION_CONFLICT', 'Show state has changed');
  else switch (cmd.type) {
    case 'addVersion': {
      const v = cmd.version;
      if (!v || !nonempty(v.id) || !nonempty(v.title) || typeof v.artist !== 'string' || !['clean', 'explicit', 'unrated', 'uncertain'].includes(v.rating) ||
          (v.source !== undefined && !validStreamingSource(v.source)) || (v.djCode !== undefined && typeof v.djCode !== 'string') || (v.trackNumber !== undefined && typeof v.trackNumber !== 'string') ||
          (v.metadataAmbiguous !== undefined && typeof v.metadataAmbiguous !== 'boolean') || (v.metadataTemplate !== undefined && typeof v.metadataTemplate !== 'string') ||
          (v.isDuet !== undefined && typeof v.isDuet !== 'boolean') || (v.discoveryOrigin !== undefined && (v.discoveryOrigin !== 'karaokenerds' || v.source?.provider !== 'youtube'))) reject('INVALID', 'Invalid version');
      else if (state.versions.some(x => x.id === v.id)) reject('DUPLICATE', 'Version already exists');
      else state.versions.push({ ...v });
      break;
    }
    case 'editVersion': {
      const version = state.versions.find(v => v.id === cmd.id);
      if (!version || !nonempty(cmd.title) || cmd.title.length > 500 || typeof cmd.artist !== 'string' || cmd.artist.length > 500 || (cmd.isDuet !== undefined && typeof cmd.isDuet !== 'boolean')) reject('INVALID', 'Invalid song metadata');
      else { version.title = cmd.title.trim(); version.artist = cmd.artist.trim(); if (cmd.isDuet !== undefined) version.isDuet = cmd.isDuet; if (version.metadataAmbiguous) version.metadataAmbiguous = false; }
      break;
    }
    case 'addSinger':
      if (!cmd.singer || !nonempty(cmd.singer.id) || !nonempty(cmd.singer.name) || cmd.singer.archived !== undefined || (cmd.singer.unavailableUntilMs !== undefined && (!Number.isSafeInteger(cmd.singer.unavailableUntilMs) || cmd.singer.unavailableUntilMs < 0 || cmd.singer.unavailableUntilMs > nowMs + 3600000))) reject('INVALID', 'Invalid singer');
      else if (state.singers.some(s => s.id === cmd.singer.id)) reject('DUPLICATE', 'Singer already exists');
      else state.singers.push({ ...cmd.singer });
      break;
    case 'removeSinger': {
      const singer = state.singers.find(s => s.id === cmd.singerId && !s.archived);
      if (!singer) reject('INVALID', 'Singer is not in this show');
      else if (state.requests.some(request => ['pending', 'accepted', 'staged', 'playing'].includes(request.status) &&
        (request.singerId === singer.id || request.coSingerId === singer.id)))
        reject('LOCKED', 'Remove or reassign this singer’s active and queued songs first');
      else { singer.archived = true; delete singer.unavailableUntilMs; }
      break;
    }
    case 'setSingerAvailability': {
      const singer = state.singers.find(s => s.id === cmd.singerId && !s.archived);
      const staged = state.requests.find(r => r.id === state.stagedRequestId && (r.singerId === cmd.singerId || r.coSingerId === cmd.singerId));
      const playing = state.requests.find(r => r.id === state.playback?.requestId && (r.singerId === cmd.singerId || r.coSingerId === cmd.singerId));
      if (!singer || !Number.isInteger(cmd.minutes) || cmd.minutes < 0 || cmd.minutes > 60 || !Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(nowMs + cmd.minutes * 60000) || (cmd.releaseStaged !== undefined && typeof cmd.releaseStaged !== 'boolean')) reject('INVALID', 'Choose a whole number of minutes from 0 to 60');
      else if (cmd.minutes > 0 && playing && envelope.actor.role !== 'host') reject('LOCKED', 'Ask the host while your performance is active');
      else {
        singer.unavailableUntilMs = cmd.minutes === 0 ? 0 : nowMs + cmd.minutes * 60000;
        if (cmd.minutes > 0 && staged) { staged.status = 'accepted'; state.stagedRequestId = null; }
      }
      break;
    }
    case 'request': {
      const limitMessage = singerRequestLimit(state, cmd.singerId, settings.maxFutureRequestsPerSinger, nowMs);
      if (!nonempty(cmd.requestId) || cmd.singerId !== null && !state.singers.some(s => s.id === cmd.singerId && !s.archived)) reject('INVALID', 'Invalid request or singer');
      else if (state.requests.some(r => r.id === cmd.requestId)) reject('DUPLICATE', 'Request already exists');
      else if (!versionAllowed(cmd.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else if (cmd.coSingerId != null && (cmd.singerId === null || cmd.singerId === cmd.coSingerId || !state.singers.some(s => s.id === cmd.coSingerId && !s.archived) || !state.versions.find(v => v.id === cmd.versionId)?.isDuet)) reject('INVALID', 'Choose another singer and mark this song as a duet');
      else if (limitMessage) reject('LIMIT', limitMessage);
      else {
        const request: SongRequest = { id: cmd.requestId, singerId: cmd.singerId, ...(cmd.coSingerId ? { coSingerId: cmd.coSingerId } : {}), versionId: cmd.versionId, status: 'pending', round: null, order: null };
        state.requests.push(request);
        if (settings.autoApprove) acceptRequest(state, request);
      }
      break;
    }
    case 'accept': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      if (!request || request.status !== 'pending') reject('INVALID_STATE', 'Request is not pending');
      else if (!versionAllowed(request.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else {
        acceptRequest(state, request);
      }
      break;
    }
    case 'rejectRequest': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      if (!request || request.status !== 'pending') reject('INVALID_STATE', 'Only a pending request can be rejected');
      else request.status = 'rejected';
      break;
    }
    case 'withdrawRequest': {
      const request = state.requests.find(r => r.id === cmd.requestId && r.singerId === envelope.actor.id);
      if (!request) reject('FORBIDDEN', 'Request is not available');
      else if (!['pending', 'accepted', 'staged'].includes(request.status)) reject('INVALID_STATE', 'Only a pending or queued request can be withdrawn');
      else { request.status = 'withdrawn'; if (state.stagedRequestId === request.id) state.stagedRequestId = null; if (state.promotedRequestId === request.id) state.promotedRequestId = null; }
      break;
    }
    case 'removeRequest': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      if (!request || !['pending', 'accepted', 'staged'].includes(request.status)) reject('INVALID_STATE', 'Only a pending or queued request can be removed');
      else {
        if (state.stagedRequestId === request.id) state.stagedRequestId = null;
        if (state.promotedRequestId === request.id) state.promotedRequestId = null;
        request.status = 'removed';
      }
      break;
    }
    case 'promoteRequest': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      if (!request || request.status !== 'accepted') reject('INVALID_STATE', 'Only an accepted waiting request can be promoted');
      else if (!versionAllowed(request.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else {
        const staged = state.requests.find(r => r.id === state.stagedRequestId && r.status === 'staged');
        if (staged && staged.id !== request.id) { staged.status = 'accepted'; state.stagedRequestId = null; }
        state.promotedRequestId = request.id;
      }
      break;
    }
    case 'moveRequest': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      const target = cmd.beforeRequestId === null ? null : state.requests.find(r => r.id === cmd.beforeRequestId);
      if (!request || !['accepted', 'staged'].includes(request.status) || (cmd.beforeRequestId !== null && (!target || !['accepted', 'staged'].includes(target.status))))
        reject('INVALID_STATE', 'Only queued requests may be reordered');
      else if (cmd.beforeRequestId === request.id) reject('INVALID', 'Choose a different position');
      else {
        const order = orderedFuture(state, settings.rotationMode, nowMs).filter(r => r.id !== request.id).map(r => r.id);
        const position = target ? order.indexOf(target.id) : order.length;
        order.splice(position, 0, request.id);
        // The prepared next turn is a queue position, not a playing song. Release
        // it only when the host has explicitly selected a different first item.
        const staged = state.requests.find(r => r.id === state.stagedRequestId && r.status === 'staged');
        if (staged && order[0] !== staged.id) { staged.status = 'accepted'; state.stagedRequestId = null; }
        // Keep an interrupted/active turn's place for Stop, without changing playback.
        const active = state.playback?.requestId;
        state.manualQueueOrder = [...(active ? [active] : []), ...order];
        state.promotedRequestId = null;
      }
      break;
    }
    case 'resetQueueOrder': {
      const staged = state.requests.find(r => r.id === state.stagedRequestId && r.status === 'staged');
      if (staged) { staged.status = 'accepted'; state.stagedRequestId = null; }
      state.manualQueueOrder = []; state.promotedRequestId = null;
      break;
    }
    case 'editRequest': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      if (!request || !['pending', 'accepted', 'staged'].includes(request.status)) reject('LOCKED', 'Stop the active performance before editing');
      else if (cmd.singerId !== null && !state.singers.some(s => s.id === cmd.singerId && !s.archived)) reject('INVALID', 'Choose a singer in this show or leave it unassigned');
      else if (!versionAllowed(cmd.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else if (cmd.coSingerId !== undefined && cmd.coSingerId !== null && (cmd.singerId === null || cmd.singerId === cmd.coSingerId || !state.singers.some(s => s.id === cmd.coSingerId && !s.archived) || !state.versions.find(v => v.id === cmd.versionId)?.isDuet)) reject('INVALID', 'Choose another singer and mark this song as a duet');
      else if (cmd.coSingerId === undefined && request.coSingerId && (cmd.singerId === null || cmd.singerId === request.coSingerId || !state.versions.find(v => v.id === cmd.versionId)?.isDuet)) reject('INVALID', 'Remove or change the duet singer first');
      else {
        const changingSinger = request.singerId !== cmd.singerId;
        const limit = changingSinger && singerRequestLimit(state, cmd.singerId, settings.maxFutureRequestsPerSinger, nowMs);
        if (limit) reject('LIMIT', limit);
        else {
          request.versionId = cmd.versionId;
          if (cmd.coSingerId !== undefined) request.coSingerId = cmd.coSingerId;
          if (changingSinger) {
            request.singerId = cmd.singerId;
            // Reassign to the recipient's next free round; retain an explicit host slot.
            if (request.status === 'accepted' || request.status === 'staged') { const previous = request.status; request.round = null; request.order = null; acceptRequest(state, request); request.status = previous; }
          }
        }
      }
      break;
    }
    case 'stage': {
      if (state.stagedRequestId) { reject('LOCKED', 'A song is already next in the queue'); break; }
      const next = orderedFuture(state, settings.rotationMode, nowMs).find(r => r.status === 'accepted' && singerAvailable(state, r.singerId, nowMs) && singerAvailable(state, r.coSingerId ?? null, nowMs) && versionAllowed(r.versionId) && (cmd.requestId === undefined || r.id === cmd.requestId));
      if (!next) reject('NOT_AVAILABLE', 'No eligible accepted request');
      else {
        next.status = 'staged'; state.stagedRequestId = next.id;
      }
      break;
    }
    case 'release': {
      const staged = state.requests.find(r => r.id === state.stagedRequestId && r.status === 'staged');
      if (!staged) reject('INVALID_STATE', 'No queued next song');
      else { staged.status = 'accepted'; state.stagedRequestId = null; }
      break;
    }
    case 'start': {
      const staged = state.requests.find(r => r.id === state.stagedRequestId && r.status === 'staged');
      if (state.playback) reject('INVALID_STATE', 'A track is already active');
      else if (!staged) reject('INVALID_STATE', 'No queued next song');
      else if (remainingPauseSeconds(state, nowMs)) reject('PAUSE_INTERVAL', `Wait ${remainingPauseSeconds(state, nowMs)} seconds before starting the next song.`);
      else if (!singerAvailable(state, staged.singerId, nowMs) || !singerAvailable(state, staged.coSingerId ?? null, nowMs)) reject('UNAVAILABLE', 'A singer is unavailable; wait until they return or change the queue');
      else if (!versionAllowed(staged.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else if (!nonempty(cmd.generationId) || state.usedGenerationIds.includes(cmd.generationId)) reject('INVALID', 'Playback generation must be new');
      else {
        // Preparing a later song does not consume or advance the active round.
        // An explicit promotion (or FIFO mode) can start a later round before
        // earlier eligible turns. Keep the current round open until those turns run.
        const earlierWaiting = state.requests.some(r => r.status === 'accepted' && r.round !== null &&
          r.round < staged.round! && versionAllowed(r.versionId));
        if (staged.round! > state.currentRound && !earlierWaiting) { state.currentRound = staged.round!; state.finalTurnBegun = false; }
        staged.status = 'playing'; state.stagedRequestId = null;
        state.playback = { requestId: staged.id, generationId: cmd.generationId, status: 'playing' };
        state.usedGenerationIds.push(cmd.generationId);
        if (staged.round === state.currentRound && !state.requests.some(r => r.status === 'accepted' && r.round === state.currentRound && versionAllowed(r.versionId))) state.finalTurnBegun = true;
      }
      break;
    }
    case 'pause':
      if (!state.playback || state.playback.status !== 'playing') reject('INVALID_STATE', 'No playing track');
      else state.playback.status = 'paused';
      break;
    case 'applause':
      if (settings.applauseEnabled === false) reject('DISABLED', 'Applause is turned off');
      else if (envelope.actor.role === 'singer' && !state.singers.some(s => s.id === envelope.actor.id && !s.archived)) reject('FORBIDDEN', 'Singer is unavailable');
      break;
    case 'photo':
      if (!state.singers.some(s => s.id === envelope.actor.id && !s.archived)) reject('FORBIDDEN', 'Singer is unavailable');
      else if (typeof cmd.photoHash !== 'string' || !/^[a-f0-9]{64}$/.test(cmd.photoHash)) reject('INVALID', 'Invalid photo identity');
      break;
    case 'resume':
      if (!state.playback || state.playback.status !== 'paused') reject('INVALID_STATE', 'No paused track');
      else if (!versionAllowed(state.requests.find(request => request.id === state.playback!.requestId)?.versionId ?? '')) reject('NOT_AVAILABLE', 'Version is not available');
      else state.playback.status = 'playing';
      break;
    case 'stop': {
      const active = state.requests.find(r => r.id === state.playback?.requestId && r.status === 'playing');
      if (!active) reject('INVALID_STATE', 'No active track');
      else {
        // A stopped performance has not consumed its turn. If it closed the
        // current round on start, reopen that round for singers arriving now.
        if (active.round === state.currentRound) state.finalTurnBegun = false;
        active.status = 'accepted'; state.playback = null;
      }
      break;
    }
    case 'complete': case 'skip': {
      const active = state.requests.find(r => r.id === state.playback?.requestId && r.status === 'playing');
      if (!active || state.playback?.generationId !== cmd.generationId) reject('STALE_GENERATION', 'Playback generation is no longer active');
      else if (cmd.type === 'skip' && cmd.confirmed !== true) reject('CONFIRMATION_REQUIRED', 'Skip must be confirmed');
      else {
        active.status = cmd.type === 'complete' ? 'completed' : 'skipped';
        if (state.promotedRequestId === active.id) state.promotedRequestId = null;
        state.playback = null;
        state.nextStartAtMs = nowMs + (settings.pauseIntervalSeconds ?? 0) * 1000;
      }
      break;
    }
    case 'setPolicy': {
      const p = cmd.policy;
      if (!p || typeof p.ageRestricted !== 'boolean' || !(p.includeVersionIds === null || (Array.isArray(p.includeVersionIds) && p.includeVersionIds.every(nonempty))) || !Array.isArray(p.excludeVersionIds) || !p.excludeVersionIds.every(nonempty)) { reject('INVALID', 'Invalid policy'); break; }
      state.policy = { ageRestricted: p.ageRestricted, includeVersionIds: p.includeVersionIds === null ? null : [...p.includeVersionIds], excludeVersionIds: [...p.excludeVersionIds] };
      const promoted = state.requests.find(r => r.id === state.promotedRequestId);
      if (promoted && !versionAllowed(promoted.versionId)) state.promotedRequestId = null;
      // A staged request remains locked even when it becomes ineligible. Start
      // checks the current policy; only the host may release or replace it.
      break;
    }
    default: reject('INVALID', 'Unknown command');
  }
  if (!error.value) {
    const options = { pointsEnabled: settings.pointsEnabled !== false, applauseEnabled: settings.applauseEnabled !== false };
    const relevant = ['addSinger', 'request', 'editRequest', 'editVersion', 'start', 'applause', 'photo', 'complete', 'skip', 'stop'].includes(cmd.type);
    if (relevant) {
      try {
        let points = state.points ?? newPointsLedger(state.showId);
        if (points.showId !== state.showId) throw new Error('Points belong to another show.');
        const record = (event: PointsEvent) => { points = applyPointsEvent(points, event, options).ledger; };
        // Freeze registered show participants at the moment playback starts.
        const participants = () => state.singers.filter(singer => !singer.archived).map(singer => singer.id);
        const start = (generationId: string, request: SongRequest | undefined) => {
          const performers = [request?.singerId, request?.coSingerId].filter((id): id is string => typeof id === 'string');
          record({ type: 'start', eventId: `start:${generationId}`, generationId, performers, participants: participants() });
        };
        if (cmd.type === 'addSinger') record({ type: 'join', eventId: `join:${envelope.commandId}`, singerId: cmd.singer.id });
        if (cmd.type === 'request') {
          const version = state.versions.find(item => item.id === cmd.versionId)!;
          const matching = original.requests.filter(request => {
            const other = original.versions.find(item => item.id === request.versionId);
            return !!other && sameSong(version, other);
          });
          const seen = matching.length > 0 || (history ? history.songSeenBefore(version) : true);
          record({ type: 'rememberQueue', eventId: `queue-facts:${envelope.commandId}`, requestId: cmd.requestId, everQueuedOrSung: seen,
            sungBy: [...new Set(matching.filter(request => request.status === 'completed').flatMap(request => [request.singerId, request.coSingerId].filter((id): id is string => typeof id === 'string')))] });
          if (cmd.singerId !== null) record({ type: 'queue', eventId: `queue:${envelope.commandId}`, singerId: cmd.singerId,
            sungEarlierThisShow: matching.some(request => request.status === 'completed' &&
              [request.singerId, request.coSingerId].some(id => typeof id === 'string' && id !== cmd.singerId)),
            everQueuedOrSung: seen, isDuet: !!version.isDuet, requestId: cmd.requestId, ...(cmd.coSingerId ? { coSingerId: cmd.coSingerId } : {}) });
        }
        if (cmd.type === 'editVersion' && cmd.isDuet === true && !original.versions.find(item => item.id === cmd.id)?.isDuet) {
          let sequence = 0;
          for (const request of state.requests.filter(item => item.versionId === cmd.id && ['pending', 'accepted', 'staged'].includes(item.status))) {
            for (const singerId of [request.singerId, request.coSingerId]) {
              if (singerId) record({ type: 'duetPartner', eventId: `duet:${envelope.commandId}:${sequence++}`, requestId: request.id, singerId });
            }
          }
        }
        if (cmd.type === 'editRequest') {
          const request = state.requests.find(item => item.id === cmd.requestId)!;
          const previous = original.requests.find(item => item.id === cmd.requestId);
          if (request.singerId && request.singerId !== previous?.singerId)
            record({ type: 'assignQueue', eventId: `queue-assignment:${envelope.commandId}`, requestId: request.id, singerId: request.singerId });
          if ((state.versions.find(item => item.id === request.versionId)?.isDuet || request.coSingerId) &&
              (request.versionId !== previous?.versionId || request.singerId !== previous?.singerId || request.coSingerId !== previous?.coSingerId)) {
            let sequence = 0;
            for (const singerId of [request.singerId, request.coSingerId]) {
              if (singerId) record({ type: 'duetPartner', eventId: `duet:${envelope.commandId}:${sequence++}`, requestId: request.id, singerId });
            }
          }
        }
        if (cmd.type === 'start') {
          const request = state.requests.find(item => item.id === state.playback?.requestId);
          start(cmd.generationId, request);
        }
        const oldPlayback = original.playback;
        if (oldPlayback && ['applause', 'complete', 'skip', 'stop'].includes(cmd.type) && !points.performances.some(item => item.generationId === oldPlayback.generationId)) {
          const request = original.requests.find(item => item.id === oldPlayback.requestId);
          start(oldPlayback.generationId, request);
        }
        if (cmd.type === 'applause') record({ type: 'applause', eventId: `applause:${envelope.commandId}`,
          actor: envelope.actor.role === 'singer' ? { role: 'singer', singerId: envelope.actor.id } : { role: 'host' },
          generationId: oldPlayback?.status === 'playing' ? oldPlayback.generationId : null });
        if (cmd.type === 'photo') record({ type: 'photo', eventId: `photo:${envelope.commandId}`, singerId: envelope.actor.id });
        if (oldPlayback && (cmd.type === 'complete' || cmd.type === 'skip' || cmd.type === 'stop'))
          record({ type: 'finish', eventId: `finish:${oldPlayback.generationId}`, generationId: oldPlayback.generationId, completed: cmd.type === 'complete' });
        state.points = points;
      } catch (cause) {
        reject('POINTS', cause instanceof Error ? cause.message : 'Points could not be recorded');
      }
    }
  }
  if (!error.value && state.manualQueueOrder?.length) {
    const live = new Set(state.requests.filter(r => ['accepted', 'staged', 'playing'].includes(r.status)).map(r => r.id));
    state.manualQueueOrder = state.manualQueueOrder.filter(id => live.has(id));
  }
  let outcome: Outcome;
  if (error.value) { state = JSON.parse(JSON.stringify(original)); outcome = fail(error.value.code, error.value.message); }
  else { state.revision++; outcome = { ok: true, revision: state.revision }; }
  state.receipts.push({ id: envelope.commandId, fingerprint, outcome });
  return { state, outcome };
}

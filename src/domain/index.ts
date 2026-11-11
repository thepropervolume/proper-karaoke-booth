import { DEFAULT_SETTINGS, type Settings } from './settings';
import { futureRequestLimitMessage } from './future-request-limit';

/** Pure show rules. Callers authenticate actors and must persist the returned state,
 * including receipt-only updates, before acknowledging a command. */
export type Role = 'host' | 'staff' | 'singer' | 'engine';
export type Actor = { role: Role; id: string };
export type Rating = 'clean' | 'explicit' | 'unrated' | 'uncertain';
export type Version = { id: string; title: string; artist: string; rating: Rating;
  djCode?: string; trackNumber?: string; metadataAmbiguous?: boolean; metadataTemplate?: string };
export type Singer = { id: string; name: string };
export type Policy = { ageRestricted: boolean; includeVersionIds: string[] | null; excludeVersionIds: string[] };
export type RequestStatus = 'pending' | 'accepted' | 'staged' | 'playing' | 'completed' | 'skipped' | 'removed' | 'rejected' | 'withdrawn';
export type SongRequest = { id: string; singerId: string; versionId: string; status: RequestStatus; round: number | null; order: number | null };
export type Playback = { requestId: string; generationId: string; status: 'playing' | 'paused' };
export type Command =
  | { type: 'addVersion'; version: Version }
  | { type: 'editVersion'; id: string; title: string; artist: string }
  | { type: 'addSinger'; singer: Singer }
  | { type: 'request'; requestId: string; singerId: string; versionId: string }
  | { type: 'accept'; requestId: string }
  | { type: 'removeRequest'; requestId: string }
  | { type: 'rejectRequest'; requestId: string }
  | { type: 'withdrawRequest'; requestId: string }
  | { type: 'stage' }
  | { type: 'release' }
  | { type: 'start'; generationId: string }
  | { type: 'pause' } | { type: 'resume' } | { type: 'stop' }
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
  /** Absolute deadline, persisted across host restart. */
  nextStartAtMs?: number;
  receipts: Receipt[];
};
export type CommandResult = { state: ShowState; outcome: Outcome };

export function createInitialState(showId: string, hostEpoch: string): ShowState {
  return { showId, hostEpoch, revision: 0, singers: [], versions: [], requests: [],
    policy: { ageRestricted: false, includeVersionIds: null, excludeVersionIds: [] },
    currentRound: 1, finalTurnBegun: false, nextOrder: 1, stagedRequestId: null,
    playback: null, usedGenerationIds: [], receipts: [] };
}

/** The same predicate must also guard catalog search and direct lookups. */
export function isVersionAllowed(state: ShowState, versionId: string): boolean {
  const version = state.versions.find(v => v.id === versionId);
  if (!version || state.policy.excludeVersionIds.includes(versionId)) return false;
  if (state.policy.includeVersionIds !== null && !state.policy.includeVersionIds.includes(versionId)) return false;
  return !state.policy.ageRestricted || version.rating === 'clean';
}
export function visibleVersions(state: ShowState): Version[] {
  return state.versions.filter(v => isVersionAllowed(state, v.id));
}

/** The clock comes from the caller; the gap never starts playback itself. */
export function remainingPauseSeconds(state: ShowState, nowMs: number): number {
  return Number.isFinite(state.nextStartAtMs) ? Math.ceil(Math.max(0, state.nextStartAtMs! - nowMs) / 1000) : 0;
}

/** The staged request remains locked when the scheduling mode changes. */
export function orderedFuture(state: ShowState, mode: Settings['rotationMode']): SongRequest[] {
  // Precompute each singer's position once. Spreading an entire retained
  // history into Math.min can exceed the engine's argument limit, and
  // repeatedly filtering it during sorting grows quadratic with show history.
  const positions = new Map<string, number>();
  const future: { request: SongRequest; index: number }[] = [];
  state.requests.forEach((request, index) => {
    if (request.order !== null && !['removed', 'withdrawn', 'rejected'].includes(request.status)) {
      positions.set(request.singerId, Math.min(positions.get(request.singerId) ?? Infinity, request.order));
    }
    if (request.status === 'accepted' || request.status === 'staged') future.push({ request, index });
  });
  return future.sort((left, right) => {
    const a = left.request, b = right.request;
    return (a.status === 'staged' ? -1 : 0) - (b.status === 'staged' ? -1 : 0) ||
      // Request arrays are append-only, so this also preserves FIFO for older
      // shows and for requests approved in a different order than they arrived.
      (mode === 'fifo' ? left.index - right.index : a.round! - b.round! ||
        (positions.get(a.singerId) ?? Infinity) - (positions.get(b.singerId) ?? Infinity) || a.order! - b.order!);
  }).map(item => item.request);
}

function acceptRequest(state: ShowState, request: SongRequest): void {
  let round = state.currentRound + (state.finalTurnBegun ? 1 : 0);
  while (state.requests.some(r => r.singerId === request.singerId && r.round === round && !['removed', 'withdrawn', 'rejected'].includes(r.status))) round++;
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
  if (actor.role === 'host') return command.type !== 'complete' && command.type !== 'withdrawRequest';
  if (actor.role === 'engine') return command.type === 'complete';
  if (actor.role === 'staff') return command.type === 'addSinger' || command.type === 'request' || command.type === 'accept';
  return actor.role === 'singer' && ((command.type === 'request' && command.singerId === actor.id) || command.type === 'withdrawRequest');
}

export function applyCommand(original: ShowState, envelope: Envelope, settings: Pick<Settings, 'autoApprove' | 'rotationMode'> & Partial<Pick<Settings, 'pauseIntervalSeconds' | 'maxFutureRequestsPerSinger'>> = DEFAULT_SETTINGS, nowMs = 0): CommandResult {
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
  const error: { value: { code: string; message: string } | null } = { value: null };
  const reject = (code: string, message: string) => { error.value = { code, message }; };
  const cmd = envelope.command;
  if (envelope.expectedRevision !== original.revision) reject('REVISION_CONFLICT', 'Show state has changed');
  else switch (cmd.type) {
    case 'addVersion': {
      const v = cmd.version;
      if (!v || !nonempty(v.id) || !nonempty(v.title) || typeof v.artist !== 'string' || !['clean', 'explicit', 'unrated', 'uncertain'].includes(v.rating) ||
          (v.djCode !== undefined && typeof v.djCode !== 'string') || (v.trackNumber !== undefined && typeof v.trackNumber !== 'string') ||
          (v.metadataAmbiguous !== undefined && typeof v.metadataAmbiguous !== 'boolean') || (v.metadataTemplate !== undefined && typeof v.metadataTemplate !== 'string')) reject('INVALID', 'Invalid version');
      else if (state.versions.some(x => x.id === v.id)) reject('DUPLICATE', 'Version already exists');
      else state.versions.push({ ...v });
      break;
    }
    case 'editVersion': {
      const version = state.versions.find(v => v.id === cmd.id);
      if (!version || !nonempty(cmd.title) || cmd.title.length > 500 || typeof cmd.artist !== 'string' || cmd.artist.length > 500) reject('INVALID', 'Invalid song metadata');
      else { version.title = cmd.title.trim(); version.artist = cmd.artist.trim(); if (version.metadataAmbiguous) version.metadataAmbiguous = false; }
      break;
    }
    case 'addSinger':
      if (!cmd.singer || !nonempty(cmd.singer.id) || !nonempty(cmd.singer.name)) reject('INVALID', 'Invalid singer');
      else if (state.singers.some(s => s.id === cmd.singer.id)) reject('DUPLICATE', 'Singer already exists');
      else state.singers.push({ ...cmd.singer });
      break;
    case 'request': {
      const limitMessage = futureRequestLimitMessage(state.requests, cmd.singerId, settings.maxFutureRequestsPerSinger);
      if (!nonempty(cmd.requestId) || !state.singers.some(s => s.id === cmd.singerId)) reject('INVALID', 'Invalid request or singer');
      else if (state.requests.some(r => r.id === cmd.requestId)) reject('DUPLICATE', 'Request already exists');
      else if (!isVersionAllowed(state, cmd.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else if (limitMessage) reject('LIMIT', limitMessage);
      else {
        const request: SongRequest = { id: cmd.requestId, singerId: cmd.singerId, versionId: cmd.versionId, status: 'pending', round: null, order: null };
        state.requests.push(request);
        if (settings.autoApprove) acceptRequest(state, request);
      }
      break;
    }
    case 'accept': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      if (!request || request.status !== 'pending') reject('INVALID_STATE', 'Request is not pending');
      else if (!isVersionAllowed(state, request.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
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
      else if (!['pending', 'accepted'].includes(request.status)) reject('INVALID_STATE', 'Only a pending or queued request can be withdrawn');
      else request.status = 'withdrawn';
      break;
    }
    case 'removeRequest': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      if (!request || !['pending', 'accepted', 'staged'].includes(request.status)) reject('INVALID_STATE', 'Only a pending, accepted, or staged request can be removed');
      else {
        if (state.stagedRequestId === request.id) state.stagedRequestId = null;
        request.status = 'removed';
      }
      break;
    }
    case 'stage': {
      if (state.stagedRequestId) { reject('LOCKED', 'Release the staged track first'); break; }
      const next = orderedFuture(state, settings.rotationMode).find(r => r.status === 'accepted' && isVersionAllowed(state, r.versionId));
      if (!next) reject('NOT_AVAILABLE', 'No eligible accepted request');
      else {
        next.status = 'staged'; state.stagedRequestId = next.id;
      }
      break;
    }
    case 'release': {
      const staged = state.requests.find(r => r.id === state.stagedRequestId && r.status === 'staged');
      if (!staged) reject('INVALID_STATE', 'No staged track');
      else { staged.status = 'accepted'; state.stagedRequestId = null; }
      break;
    }
    case 'start': {
      const staged = state.requests.find(r => r.id === state.stagedRequestId && r.status === 'staged');
      if (state.playback) reject('INVALID_STATE', 'A track is already active');
      else if (!staged) reject('INVALID_STATE', 'No staged track');
      else if (remainingPauseSeconds(state, nowMs)) reject('PAUSE_INTERVAL', `Wait ${remainingPauseSeconds(state, nowMs)} seconds before starting the next song.`);
      else if (!isVersionAllowed(state, staged.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else if (!nonempty(cmd.generationId) || state.usedGenerationIds.includes(cmd.generationId)) reject('INVALID', 'Playback generation must be new');
      else {
        // Preparing a later song does not consume or advance the active round.
        if (staged.round! > state.currentRound) { state.currentRound = staged.round!; state.finalTurnBegun = false; }
        staged.status = 'playing'; state.stagedRequestId = null;
        state.playback = { requestId: staged.id, generationId: cmd.generationId, status: 'playing' };
        state.usedGenerationIds.push(cmd.generationId);
        if (staged.round === state.currentRound && !state.requests.some(r => r.status === 'accepted' && r.round === state.currentRound && isVersionAllowed(state, r.versionId))) state.finalTurnBegun = true;
      }
      break;
    }
    case 'pause':
      if (!state.playback || state.playback.status !== 'playing') reject('INVALID_STATE', 'No playing track');
      else state.playback.status = 'paused';
      break;
    case 'resume':
      if (!state.playback || state.playback.status !== 'paused') reject('INVALID_STATE', 'No paused track');
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
        active.status = cmd.type === 'complete' ? 'completed' : 'skipped'; state.playback = null;
        state.nextStartAtMs = nowMs + (settings.pauseIntervalSeconds ?? 0) * 1000;
      }
      break;
    }
    case 'setPolicy': {
      const p = cmd.policy;
      if (!p || typeof p.ageRestricted !== 'boolean' || !(p.includeVersionIds === null || (Array.isArray(p.includeVersionIds) && p.includeVersionIds.every(nonempty))) || !Array.isArray(p.excludeVersionIds) || !p.excludeVersionIds.every(nonempty)) { reject('INVALID', 'Invalid policy'); break; }
      state.policy = { ageRestricted: p.ageRestricted, includeVersionIds: p.includeVersionIds === null ? null : [...p.includeVersionIds], excludeVersionIds: [...p.excludeVersionIds] };
      const staged = state.requests.find(r => r.id === state.stagedRequestId && r.status === 'staged');
      if (staged && !isVersionAllowed(state, staged.versionId)) { staged.status = 'accepted'; state.stagedRequestId = null; }
      break;
    }
    default: reject('INVALID', 'Unknown command');
  }
  let outcome: Outcome;
  if (error.value) { state = JSON.parse(JSON.stringify(original)); outcome = fail(error.value.code, error.value.message); }
  else { state.revision++; outcome = { ok: true, revision: state.revision }; }
  state.receipts.push({ id: envelope.commandId, fingerprint, outcome });
  return { state, outcome };
}

/** Pure show rules. Callers authenticate actors and must persist the returned state,
 * including receipt-only updates, before acknowledging a command. */
export type Role = 'host' | 'staff' | 'singer' | 'engine';
export type Actor = { role: Role; id: string };
export type Rating = 'clean' | 'explicit' | 'unrated' | 'uncertain';
export type Version = { id: string; title: string; artist: string; rating: Rating };
export type Singer = { id: string; name: string };
export type Policy = { ageRestricted: boolean; includeVersionIds: string[] | null; excludeVersionIds: string[] };
export type RequestStatus = 'pending' | 'accepted' | 'staged' | 'playing' | 'completed' | 'skipped';
export type SongRequest = { id: string; singerId: string; versionId: string; status: RequestStatus; round: number | null; order: number | null };
export type Playback = { requestId: string; generationId: string; status: 'playing' | 'paused' };
export type Command =
  | { type: 'addVersion'; version: Version }
  | { type: 'addSinger'; singer: Singer }
  | { type: 'request'; requestId: string; singerId: string; versionId: string }
  | { type: 'accept'; requestId: string }
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
  if (actor.role === 'host') return command.type !== 'complete';
  if (actor.role === 'engine') return command.type === 'complete';
  if (actor.role === 'staff') return command.type === 'addSinger' || command.type === 'request' || command.type === 'accept';
  return actor.role === 'singer' && command.type === 'request' && command.singerId === actor.id;
}

export function applyCommand(original: ShowState, envelope: Envelope): CommandResult {
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
      if (!v || !nonempty(v.id) || !nonempty(v.title) || typeof v.artist !== 'string' || !['clean', 'explicit', 'unrated', 'uncertain'].includes(v.rating)) reject('INVALID', 'Invalid version');
      else if (state.versions.some(x => x.id === v.id)) reject('DUPLICATE', 'Version already exists');
      else state.versions.push({ ...v });
      break;
    }
    case 'addSinger':
      if (!cmd.singer || !nonempty(cmd.singer.id) || !nonempty(cmd.singer.name)) reject('INVALID', 'Invalid singer');
      else if (state.singers.some(s => s.id === cmd.singer.id)) reject('DUPLICATE', 'Singer already exists');
      else state.singers.push({ ...cmd.singer });
      break;
    case 'request':
      if (!nonempty(cmd.requestId) || !state.singers.some(s => s.id === cmd.singerId)) reject('INVALID', 'Invalid request or singer');
      else if (state.requests.some(r => r.id === cmd.requestId)) reject('DUPLICATE', 'Request already exists');
      else if (!isVersionAllowed(state, cmd.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else if (state.requests.filter(r => r.singerId === cmd.singerId && ['pending', 'accepted', 'staged'].includes(r.status)).length >= 3) reject('LIMIT', 'Singer has three future requests');
      else state.requests.push({ id: cmd.requestId, singerId: cmd.singerId, versionId: cmd.versionId, status: 'pending', round: null, order: null });
      break;
    case 'accept': {
      const request = state.requests.find(r => r.id === cmd.requestId);
      if (!request || request.status !== 'pending') reject('INVALID_STATE', 'Request is not pending');
      else if (!isVersionAllowed(state, request.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else {
        let round = state.currentRound + (state.finalTurnBegun ? 1 : 0);
        while (state.requests.some(r => r.singerId === request.singerId && r.round === round)) round++;
        request.status = 'accepted'; request.round = round; request.order = state.nextOrder++;
      }
      break;
    }
    case 'stage': {
      if (state.stagedRequestId) { reject('LOCKED', 'Release the staged track first'); break; }
      // A singer's first accepted request establishes their rotation position.
      // Later songs retain that position even if accepted in a different order.
      const position = (singerId: string) => Math.min(...state.requests
        .filter(r => r.singerId === singerId && r.order !== null).map(r => r.order!));
      const next = state.requests.filter(r => r.status === 'accepted' && isVersionAllowed(state, r.versionId))
        .sort((a, b) => a.round! - b.round! || position(a.singerId) - position(b.singerId) || a.order! - b.order!)[0];
      if (!next) reject('NOT_AVAILABLE', 'No eligible accepted request');
      else {
        if (next.round! > state.currentRound) { state.currentRound = next.round!; state.finalTurnBegun = false; }
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
      else if (!isVersionAllowed(state, staged.versionId)) reject('NOT_AVAILABLE', 'Version is not available');
      else if (!nonempty(cmd.generationId) || state.usedGenerationIds.includes(cmd.generationId)) reject('INVALID', 'Playback generation must be new');
      else {
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
      else { active.status = 'accepted'; state.playback = null; }
      break;
    }
    case 'complete': case 'skip': {
      const active = state.requests.find(r => r.id === state.playback?.requestId && r.status === 'playing');
      if (!active || state.playback?.generationId !== cmd.generationId) reject('STALE_GENERATION', 'Playback generation is no longer active');
      else if (cmd.type === 'skip' && cmd.confirmed !== true) reject('CONFIRMATION_REQUIRED', 'Skip must be confirmed');
      else { active.status = cmd.type === 'complete' ? 'completed' : 'skipped'; state.playback = null; }
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

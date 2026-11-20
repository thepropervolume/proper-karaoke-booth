import { randomUUID } from 'node:crypto';
import { applyCommand, isVersionAllowed, orderedFuture, singerAvailable, type ShowState } from '../domain';
import type { Settings } from '../domain/settings';

/** Preparation is automatic; playback still requires Play or an already running
 * show's completion. Pending moderation and the staged lock remain authoritative. */
export function stageNextApproved(state: ShowState, settings: Settings, now = Date.now(), ready: (versionId: string) => boolean = () => true): ShowState {
  const eligible = (request: ShowState['requests'][number]) => singerAvailable(state, request.singerId, now) && singerAvailable(state, request.coSingerId ?? null, now) &&
    isVersionAllowed(state, request.versionId, settings) && (!!state.playback || ready(request.versionId));
  const staged = state.requests.find(request => request.id === state.stagedRequestId && request.status === 'staged');
  if (staged && (state.playback || ready(staged.versionId))) return state;
  const next = orderedFuture(state, settings.rotationMode, now).find(request => request.status === 'accepted' && eligible(request));
  // Keep the existing turn when nobody can go ahead. This also lets a manual
  // Play attempt report that the song is preparing instead of losing staging.
  if (staged && !next) return state;
  let candidate = state;
  if (staged) {
    const released = applyCommand(candidate, { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch,
      expectedRevision: candidate.revision, actor: { role: 'host', id: 'automatic-stage' }, command: { type: 'release' } }, settings, now);
    if (!released.outcome.ok) return state;
    candidate = released.state;
  }
  if (!next) return candidate;
  const result = applyCommand(candidate, { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch,
    expectedRevision: candidate.revision, actor: { role: 'host', id: 'automatic-stage' }, command: { type: 'stage', requestId: next.id } }, settings, now);
  return result.outcome.ok ? result.state : state;
}

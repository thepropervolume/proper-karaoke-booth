import { randomUUID } from 'node:crypto';
import { applyCommand, isVersionAllowed, orderedFuture, singerAvailable, type ShowState } from '../domain';
import type { Settings } from '../domain/settings';

/** Preparation is automatic; playback still requires Play or an already running
 * show's completion. Pending moderation and the staged lock remain authoritative. */
export function stageNextApproved(state: ShowState, settings: Settings, now = Date.now()): ShowState {
  if (state.stagedRequestId || !orderedFuture(state, settings.rotationMode, now).some(request =>
    request.status === 'accepted' && singerAvailable(state, request.singerId, now) && isVersionAllowed(state, request.versionId, settings))) return state;
  const result = applyCommand(state, { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch,
    expectedRevision: state.revision, actor: { role: 'host', id: 'automatic-stage' }, command: { type: 'stage' } }, settings, now);
  return result.outcome.ok ? result.state : state;
}

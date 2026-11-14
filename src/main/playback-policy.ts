import { compileSongBlacklist } from '../domain/song-blacklist';
import type { Settings } from '../domain/settings';
import { isVersionAllowed, type Command, type ShowState } from '../domain';

/** A staged performance must still be eligible before any Start side effects.
 * A performance already started may be resumed after a policy change. */
export function startPolicyError(state: ShowState, command: { type: Command['type'] }, expectedRequestId?: string | null, settings?: Pick<Settings, 'songBlacklist' | 'artistBlacklist'>): string | null {
  if (command.type === 'resume' && settings) {
    const active = state.versions.find(version => version.id === state.requests.find(request => request.id === state.playback?.requestId)?.versionId);
    if (active && compileSongBlacklist(settings).isBlocked(active)) return 'The current song or artist is blacklisted in Preferences. Remove the rule before resuming.';
  }
  if (command.type !== 'start') return null;
  const request = state.requests.find(item => item.id === state.stagedRequestId && item.status === 'staged');
  if (!request || (expectedRequestId !== undefined && request.id !== expectedRequestId)) return 'The staged song changed or is no longer available.';
  return isVersionAllowed(state, request.versionId, settings) ? null : 'The staged song is unavailable under the current policy. Release it or change the policy.';
}

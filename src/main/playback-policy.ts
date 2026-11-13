import { isVersionAllowed, type Command, type ShowState } from '../domain';

/** A staged performance must still be eligible before any Start side effects.
 * A performance already started may be resumed after a policy change. */
export function startPolicyError(state: ShowState, command: { type: Command['type'] }, expectedRequestId?: string | null): string | null {
  if (command.type !== 'start') return null;
  const request = state.requests.find(item => item.id === state.stagedRequestId && item.status === 'staged');
  if (!request || (expectedRequestId !== undefined && request.id !== expectedRequestId)) return 'The staged song changed or is no longer available.';
  return isVersionAllowed(state, request.versionId) ? null : 'The staged song is unavailable under the current policy. Release it or change the policy.';
}

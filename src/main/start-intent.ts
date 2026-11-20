import { isVersionAllowed, singerAvailable, type ShowState } from '../domain';
import type { Settings } from '../domain/settings';

type Policy = Pick<Settings, 'songBlacklist' | 'artistBlacklist'>;
export type StartIntent = { epoch: number; requestId: string };

/** Observe every committed selection, including changes that later revert. */
export class StartIntentFence {
  private epoch = 0;
  private last = '';
  observe(state: ShowState, settings: Policy, now: number): void {
    const request = state.requests.find(item => item.id === state.stagedRequestId && item.status === 'staged');
    const key = JSON.stringify([state.showId, state.hostEpoch, state.playback?.generationId ?? null, request?.id ?? null,
      request?.versionId ?? null, request?.singerId ?? null, request?.coSingerId ?? null,
      request ? singerAvailable(state, request.singerId, now) : false,
      request ? singerAvailable(state, request.coSingerId ?? null, now) : false,
      request ? isVersionAllowed(state, request.versionId, settings) : false]);
    if (key !== this.last) { this.last = key; this.epoch++; }
  }
  capture(state: ShowState, settings: Policy, now: number): StartIntent | null {
    this.observe(state, settings, now);
    const request = state.requests.find(item => item.id === state.stagedRequestId && item.status === 'staged');
    return request && !state.playback ? { epoch: this.epoch, requestId: request.id } : null;
  }
  current(state: ShowState, settings: Policy, now: number, intent: StartIntent | null): boolean {
    this.observe(state, settings, now);
    return !!intent && !state.playback && state.stagedRequestId === intent.requestId && this.epoch === intent.epoch;
  }
}

import type { PlaybackTimelineState } from './playback-timeline';

export const ESTIMATED_SONG_SECONDS = 240;
export type QueueWaitItem = { id: string; ready: boolean };

/** Rough starts, in ordered queue order. A blocked item makes later positions unpredictable. */
export function estimateQueueWaits(input: {
  generation: string | null; playing: boolean; autoAdvance: boolean;
  timeline: PlaybackTimelineState | null; intervalSeconds: number; items: readonly QueueWaitItem[];
}): Map<string, number | null> {
  const result = new Map<string, number | null>();
  const { generation, timeline } = input;
  let seconds: number | null = input.playing && input.autoAdvance && generation && timeline?.generation === generation &&
    !timeline.seeking && Number.isFinite(timeline.duration) && timeline.duration > 0 &&
    Number.isFinite(timeline.position) && timeline.position >= 0 && timeline.position <= timeline.duration &&
    Number.isFinite(input.intervalSeconds) && input.intervalSeconds >= 0
    ? timeline.duration - timeline.position + input.intervalSeconds : null;
  for (const item of input.items) {
    if (!item.ready) seconds = null;
    result.set(item.id, seconds);
    if (seconds !== null) seconds += ESTIMATED_SONG_SECONDS + input.intervalSeconds;
  }
  return result;
}

/** Round upward: an estimate that shows zero while a song is playing is misleading. */
export function formatQueueWait(seconds: number): string {
  return `~${Math.max(1, Math.ceil(seconds / 60))} min`;
}

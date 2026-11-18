import type { Playback } from '../domain';

/** Capture which performance is eligible for a clap at the moment audio starts. */
export function captureApplauseGeneration(playback: Playback | null): string | null {
  return playback?.status === 'playing' ? playback.generationId : null;
}

/** An acknowledgement must not award applause to a different or paused performance. */
export function applauseGenerationUnchanged(generation: string | null, playback: Playback | null): boolean {
  return captureApplauseGeneration(playback) === generation;
}

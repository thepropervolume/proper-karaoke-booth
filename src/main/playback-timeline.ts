import type { PlaybackTimelineState, PlaybackSeekResult } from '../domain/playback-timeline';

/** One generation owns timeline telemetry and seeks; seeking never starts playback. */
export class PlaybackTimeline {
  private value: PlaybackTimelineState = { generation: null, position: 0, duration: 0, seekable: false, seeking: false };
  private revision = 0;
  private completion: Promise<void> = Promise.resolve();
  constructor(private readonly seekMedia: (generation: string, position: number) => Promise<number>,
    private readonly checkpoint: (generation: string, position: number) => void, private readonly publish: () => void = () => {}) {}
  sync(generation: string | null, position = 0): void {
    if (generation === this.value.generation) return;
    ++this.revision;
    this.value = { generation, position: Number.isFinite(position) && position >= 0 ? position : 0, duration: 0, seekable: false, seeking: false };
  }
  private notify(): void { try { this.publish(); } catch { /* UI failure must not orphan a seek or change its durable outcome. */ } }
  waitForSeek(): Promise<void> { return this.completion; }
  snapshot(): PlaybackTimelineState { return { ...this.value }; }
  report(generation: string, input: { position: number; duration: number; seekable: boolean }): boolean {
    if (generation !== this.value.generation || this.value.seeking || !Number.isFinite(input.position) || input.position < 0 ||
        !Number.isFinite(input.duration) || input.duration <= 0 || typeof input.seekable !== 'boolean') return false;
    this.value = { ...this.value, position: Math.min(input.position, input.duration), duration: input.duration, seekable: input.seekable };
    return true;
  }
  async seek(input: unknown): Promise<PlaybackSeekResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Invalid playback position.' };
    const request = input as Record<string, unknown>;
    if (request.generation !== this.value.generation || !this.value.generation) return { ok: false, error: 'The playing track changed. Try again.' };
    if (typeof request.position !== 'number' || !Number.isFinite(request.position) || request.position < 0 || request.position > this.value.duration)
      return { ok: false, error: 'Choose a position within this track.' };
    if (!this.value.seekable || this.value.seeking) return { ok: false, error: 'Wait until the track is ready to seek.' };
    const generation = this.value.generation, revision = ++this.revision;
    // Avoid consuming the turn merely by dragging the handle to the endpoint.
    const position = Math.min(request.position, Math.max(0, this.value.duration - 0.05));
    let release!: () => void; this.completion = new Promise(resolve => { release = resolve; });
    this.value.seeking = true; this.notify();
    try {
      const actual = await this.seekMedia(generation, position);
      if (revision !== this.revision || generation !== this.value.generation) return { ok: false, error: 'The playing track changed. Try again.' };
      if (!Number.isFinite(actual) || actual < 0 || actual > this.value.duration) throw new Error('Invalid seek result.');
      this.checkpoint(generation, actual);
      this.value.position = actual;
      return { ok: true };
    } catch { return { ok: false, error: 'Could not seek this track. Check the player and try again.' }; }
    finally { if (revision === this.revision) { this.value.seeking = false; this.notify(); } release(); }
  }
}

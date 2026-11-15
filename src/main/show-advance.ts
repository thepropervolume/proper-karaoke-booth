export type ShowAdvanceSnapshot = {
  enabled: boolean; playing: boolean; requestId: string | null;
  notBeforeMs: number; ready: boolean; error?: string;
};
type Timer = { cancel(): void; unref?(): void };
export type ShowAdvanceClock = { now(): number; schedule(callback: () => void, delay: number): Timer };
const clock: ShowAdvanceClock = {
  now: () => Date.now(),
  schedule(callback, delay) { const timer = setTimeout(callback, delay); return { cancel: () => clearTimeout(timer), unref: () => timer.unref() }; },
};

/** A running show may advance after completion/Skip. Merely launching, queueing,
 * preparing media or restoring a show never arms karaoke playback. */
export class ShowAdvance {
  private armed = false;
  private closed = false;
  private revision = 0;
  private timer: Timer | null = null;
  private starting = false;
  constructor(private readonly snapshot: () => ShowAdvanceSnapshot,
    private readonly start: (requestId: string, stillCurrent: () => boolean) => Promise<{ ok: boolean; error?: string }>,
    private readonly report: (message: string) => void = () => {}, private readonly time: ShowAdvanceClock = clock) {}

  arm(): void { this.cancel(); if (this.closed || !this.snapshot().enabled) return; this.armed = true; this.changed(); }
  cancel(): void { this.armed = false; this.revision++; this.timer?.cancel(); this.timer = null; }
  close(): void { this.closed = true; this.cancel(); }
  isArmed(): boolean { return this.armed && !this.closed; }
  changed(): void {
    if (!this.armed || this.closed || this.starting) return;
    this.timer?.cancel();
    const state = this.snapshot();
    if (!state.enabled || state.playing) { this.cancel(); return; }
    const remaining = Math.max(0, state.notBeforeMs - this.time.now());
    const delay = remaining > 0 ? Math.min(remaining, 2_147_483_647) : state.error || state.requestId && state.ready ? 0 : 250;
    const revision = this.revision;
    this.timer = this.time.schedule(() => { this.timer = null; if (revision === this.revision) void this.advance(revision); }, delay);
    this.timer.unref?.();
  }
  private async advance(revision: number): Promise<void> {
    if (!this.armed || this.closed || revision !== this.revision || this.starting) return;
    const selected = this.snapshot();
    if (!selected.enabled || selected.playing) { this.cancel(); return; }
    if (selected.error) { this.cancel(); this.report(selected.error); return; }
    if (!selected.requestId || !selected.ready || selected.notBeforeMs > this.time.now()) { this.changed(); return; }
    const requestId = selected.requestId;
    const current = () => {
      if (!this.armed || this.closed || revision !== this.revision) return false;
      const state = this.snapshot();
      return state.enabled && !state.playing && state.requestId === requestId && state.ready && state.notBeforeMs <= this.time.now();
    };
    this.starting = true;
    try {
      const result = await this.start(requestId, current);
      if (revision !== this.revision || this.closed) return;
      this.cancel();
      if (!result.ok) this.report(result.error || 'The next song could not start. Check it and press Play.');
    } catch {
      if (revision === this.revision && !this.closed) { this.cancel(); this.report('The next song could not start. Check it and press Play.'); }
    } finally { this.starting = false; if (this.armed) this.changed(); }
  }
}

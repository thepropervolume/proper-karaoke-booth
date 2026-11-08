/** Serialize native fullscreen transitions, and recover when the window manager omits an event. */
export class DisplayFullscreen {
  private actual = false;
  private desired = false;
  private transitioning = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly setFullscreen: (value: boolean) => void,
    private readonly getFullscreen: () => boolean,
    private readonly onFailure: () => void,
    private readonly timeoutMs = 2000
  ) {}

  set(value: boolean): void { if (!this.closed) { this.desired = value; this.apply(); } }
  toggle(): void { if (!this.closed) this.set(!this.desired); }
  changed(value: boolean): void {
    if (this.closed) return;
    const wasTransitioning = this.transitioning;
    this.clearTimer();
    this.actual = value;
    this.transitioning = false;
    if (!wasTransitioning) this.desired = value; // The OS changed the window directly.
    this.apply();
  }
  close(): void { this.closed = true; this.clearTimer(); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private fail(): void {
    this.clearTimer(); this.transitioning = false; this.desired = this.actual;
    try { this.onFailure(); } catch { /* A warning cannot disrupt playback. */ }
  }
  private apply(): void {
    if (this.closed || this.transitioning || this.actual === this.desired) return;
    const attempted = this.desired;
    this.transitioning = true;
    // Some window managers never deliver the completion event. Reconcile once,
    // without endlessly repeating a request the OS declined.
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.closed || !this.transitioning) return;
      try { this.actual = this.getFullscreen(); } catch { this.fail(); return; }
      this.transitioning = false;
      if (this.actual !== attempted && this.desired === attempted) { this.fail(); return; }
      this.apply();
    }, this.timeoutMs);
    try { this.setFullscreen(attempted); } catch { this.fail(); }
  }
}

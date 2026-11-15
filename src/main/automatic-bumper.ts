/** Starts opt-in intermission only after the current display confirms karaoke silence. */
export class AutomaticBumper {
  private generation = 0;
  private pending: { playback: string; timer: ReturnType<typeof setTimeout>; serial: number } | null = null;
  private closed = false;
  constructor(private readonly eligible: () => boolean,
    private readonly start: (stillEligible: () => boolean) => Promise<boolean>,
    private readonly report: (message: string) => void = () => {}, private readonly timeoutMs = 5000) {}

  /** Call only after a successful completion/skip, before publishing the cleared display state. */
  arm(playback: string): boolean {
    this.cancel();
    if (this.closed || !playback || !this.eligible()) return false;
    const serial = this.generation;
    const timer = setTimeout(() => {
      if (!this.pending || this.pending.serial !== serial) return;
      this.pending = null;
      this.report('Automatic bumper did not start because the singer display did not confirm silence.');
    }, this.timeoutMs);
    this.pending = { playback, timer, serial };
    return true;
  }

  /** Accept only an acknowledgement from the authorised singer display. */
  async acknowledge(playback: string): Promise<boolean> {
    const pending = this.pending;
    if (!pending || pending.playback !== playback) return false;
    clearTimeout(pending.timer); this.pending = null;
    const valid = () => !this.closed && pending.serial === this.generation && this.eligible();
    if (!valid()) return false;
    try { return await this.start(valid); }
    catch (error) { this.report(error instanceof Error ? error.message : 'Automatic bumper could not start.'); return false; }
  }

  /** Startup has no old karaoke generation to silence. The same cancellation
   * fence prevents a delayed start from surviving Play, Stop or output loss. */
  async startIdle(): Promise<boolean> {
    this.cancel();
    const serial = this.generation;
    const valid = () => !this.closed && serial === this.generation && this.eligible();
    if (!valid()) return false;
    try { return await this.start(valid); }
    catch (error) { this.report(error instanceof Error ? error.message : 'Bumper music could not start.'); return false; }
  }

  /** Invalidate pending/in-flight automation before output loss, a new song or manual stop. */
  cancel(): void {
    this.generation++;
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
  close(): void { this.closed = true; this.cancel(); }
}

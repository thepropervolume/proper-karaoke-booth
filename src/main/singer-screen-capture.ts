import { createHash } from 'node:crypto';
import { SingerScreenFrameHub } from './singer-screen-server';

export type CapturedSingerScreen = { jpeg: Buffer; width: number; height: number };
type ScheduledCapture = { cancel(): void; unref?(): void };
export type SingerScreenCaptureScheduler = { schedule(callback: () => void, delayMs: number): ScheduledCapture };
export type SingerScreenCaptureOptions = {
  /** Capture only the authoritative singer window; return null when it is absent. */
  capture(): Promise<CapturedSingerScreen | null>;
  /** True while a host preview or a LAN viewer requires frames. */
  hasDemand(): boolean;
  intervalMs?: number;
  /** The scheduler must invoke callbacks asynchronously. Useful for temporal tests. */
  scheduler?: SingerScreenCaptureScheduler;
};

const scheduler: SingerScreenCaptureScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(timer), unref: () => timer.unref() };
  },
};

/** Visual capture only. Epochs fence old windows/output states and late promises. */
export class SingerScreenCapture {
  private running = false;
  private epoch = 0;
  // Never overlap expensive capturePage calls. Epoch checks discard a capture
  // that finishes after a display replacement or after the last viewer leaves.
  private inFlight = false;
  private timer: ScheduledCapture | null = null;
  private timerSequence = 0;
  private previousDemand: boolean | undefined;
  private lastDigest: string | null = null;
  private lastPublishedSequence: number | null = null;
  private readonly intervalMs: number;
  private readonly scheduler: SingerScreenCaptureScheduler;

  constructor(private readonly hub: SingerScreenFrameHub, private readonly options: SingerScreenCaptureOptions) {
    this.intervalMs = options.intervalMs ?? 125;
    this.scheduler = options.scheduler ?? scheduler;
    if (!Number.isInteger(this.intervalMs) || this.intervalMs < 50 || this.intervalMs > 5000)
      throw new Error('Singer screen capture interval must be between 50 and 5000 milliseconds.');
  }

  start(): void {
    if (this.running) return;
    this.running = true; ++this.epoch; this.previousDemand = undefined;
    this.schedule(0);
  }

  /** Call before replacing/closing the singer window or when output becomes unsafe. */
  invalidate(): void {
    ++this.epoch; this.clearFrame();
    if (this.running && !this.inFlight) this.schedule(0);
  }

  stop(): void {
    this.running = false; ++this.epoch; ++this.timerSequence;
    this.timer?.cancel(); this.timer = null; this.previousDemand = undefined;
    this.clearFrame();
  }

  private clearFrame(): void {
    this.lastDigest = null; this.lastPublishedSequence = null;
    if (this.hub.current !== null) this.hub.clear();
  }

  private readDemand(): boolean {
    let demand = false;
    try { demand = this.options.hasDemand() === true; } catch { /* Loss of demand fails closed. */ }
    if (!demand && this.previousDemand !== false) { ++this.epoch; this.clearFrame(); }
    this.previousDemand = demand;
    return demand;
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer?.cancel();
    const sequence = ++this.timerSequence;
    this.timer = this.scheduler.schedule(() => {
      if (!this.running || sequence !== this.timerSequence) return;
      this.timer = null; this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private tick(): void {
    if (!this.running) return;
    if (this.readDemand() && !this.inFlight) void this.capture(this.epoch);
    this.schedule(this.intervalMs);
  }

  private async capture(epoch: number): Promise<void> {
    this.inFlight = true;
    try {
      const frame = await this.options.capture();
      // Read demand only for the current owner. An obsolete capture must not
      // invalidate a later start or publish after an explicit window change.
      if (!this.running || epoch !== this.epoch || !this.readDemand() || epoch !== this.epoch) return;
      if (frame === null) { this.clearFrame(); return; }
      // Bound hashing/copy work before the hub performs full JPEG/dimension validation.
      if (!Buffer.isBuffer(frame.jpeg) || frame.jpeg.length > 2 * 1024 * 1024)
        throw new Error('Invalid singer display frame.');
      const digest = createHash('sha256').update(`${frame.width}x${frame.height}:`).update(frame.jpeg).digest('hex');
      if (digest === this.lastDigest && this.hub.current?.sequence === this.lastPublishedSequence) return;
      this.hub.publish(frame);
      this.lastDigest = digest; this.lastPublishedSequence = this.hub.current!.sequence;
    } catch {
      if (this.running && epoch === this.epoch) this.clearFrame();
    } finally {
      this.inFlight = false;
      // A closed/replaced display can recover as soon as its old capture settles,
      // while preserving the single-capture invariant across stop/start cycles.
      if (this.running && epoch !== this.epoch) this.schedule(0);
    }
  }
}

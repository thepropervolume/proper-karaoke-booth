import { randomUUID } from 'node:crypto';
import type { BumperOutput, BumperTrack } from './bumper-controller';

export type BumperDisplayRequest = { id: string; action: 'start'; generation: string; src: string; volume: number; deviceId: string; fadeMs: number } | { id: string; action: 'stop' };
type Pending = { action: 'start' | 'stop'; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** Only pass acknowledgements from the currently authorised display renderer. */
export class BumperDisplayOutput implements BumperOutput {
  private pending = new Map<string, Pending>();
  private attached = false;
  constructor(private send: (request: BumperDisplayRequest) => void, private volume: () => number, private deviceId: () => string, private timeoutMs = 5000, private fadeMs: () => number = () => 1000) {}
  displayReady(): void { this.attached = true; }
  async start(_track: BumperTrack, generation: string): Promise<void> {
    if (!this.attached) throw new Error('The singer player is not ready for bumper music.');
    await this.request({ id: randomUUID(), action: 'start', generation,
      src: `tpv-media://bumper/${encodeURIComponent(generation)}`, volume: this.volume(), deviceId: this.deviceId(), fadeMs: this.fadeMs() });
  }
  async stop(): Promise<void> { if (this.attached) await this.request({ id: randomUUID(), action: 'stop' }); }
  acknowledge(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const ack = value as Record<string, unknown>;
    if (typeof ack.id !== 'string' || typeof ack.ok !== 'boolean') return;
    const pending = this.pending.get(ack.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(ack.id);
    if (ack.ok) pending.resolve();
    else pending.reject(new Error(typeof ack.error === 'string' ? ack.error.slice(0, 500) : 'Bumper playback failed.'));
  }
  /** A destroyed renderer is silent; pending starts fail, pending stops complete. */
  displayDestroyed(): void {
    this.attached = false;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer); this.pending.delete(id);
      if (pending.action === 'stop') pending.resolve();
      else pending.reject(new Error('The singer display closed.'));
    }
  }
  private request(request: BumperDisplayRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error('The singer display did not confirm that bumper audio stopped.'));
      }, this.timeoutMs);
      this.pending.set(request.id, { action: request.action, resolve, reject, timer });
      try { this.send(request); }
      catch (reason) {
        clearTimeout(timer); this.pending.delete(request.id);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      }
    });
  }
}

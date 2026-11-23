export type TransportResult = { ok: boolean; error?: string };
export type TransportAction = 'playPause' | 'restart' | 'playNow';

/** Identical clicks share one operation; a different intent cannot race an
 * opening display, verified start, or acknowledged restart seek. */
export class HostTransport {
  private pending: { action: TransportAction; result: Promise<TransportResult> } | null = null;
  private revision = 0;
  busy(): boolean { return this.pending !== null; }
  /** Capture at the initiating intent, before opening, hashing or seeking. */
  capture(): () => boolean { const revision = this.revision; return () => revision === this.revision; }
  cancel(): void { this.revision++; }
  run(action: TransportAction, operation: (stillCurrent: () => boolean) => Promise<TransportResult>): Promise<TransportResult> {
    if (this.pending) return this.pending.action === action ? this.pending.result
      : Promise.resolve({ ok: false, error: 'Wait for the current playback action to finish.' });
    const current = this.capture();
    const result = Promise.resolve().then(() => current() ? operation(current) : { ok: false, error: 'Playback was cancelled.' })
      .catch((reason: unknown) => ({ ok: false, error: reason instanceof Error ? reason.message : 'Playback action failed.' }))
      .finally(() => { if (this.pending?.result === result) this.pending = null; });
    this.pending = { action, result };
    return result;
  }
}

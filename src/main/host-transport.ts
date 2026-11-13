export type TransportResult = { ok: boolean; error?: string };
export type TransportAction = 'playPause' | 'restart';

/** Identical clicks share one operation; a different intent cannot race an
 * opening display, verified start, or acknowledged restart seek. */
export class HostTransport {
  private pending: { action: TransportAction; result: Promise<TransportResult> } | null = null;
  busy(): boolean { return this.pending !== null; }
  run(action: TransportAction, operation: () => Promise<TransportResult>): Promise<TransportResult> {
    if (this.pending) return this.pending.action === action ? this.pending.result
      : Promise.resolve({ ok: false, error: 'Wait for the current playback action to finish.' });
    const result = Promise.resolve().then(operation)
      .catch((reason: unknown) => ({ ok: false, error: reason instanceof Error ? reason.message : 'Playback action failed.' }))
      .finally(() => { if (this.pending?.result === result) this.pending = null; });
    this.pending = { action, result };
    return result;
  }
}

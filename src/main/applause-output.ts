import { randomUUID } from 'node:crypto';

type Pending = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Keeps the display audio limit authoritative while acknowledgements are in flight. */
export class ApplauseOutput {
  private readonly pending = new Map<string, Pending>();
  private readonly active = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly send: (request: { id: string; volume: number; outputId: string }) => void) {}

  play(volume: number, outputId: string): Promise<void> {
    if (this.pending.size + this.active.size >= 3) return Promise.reject(new Error('Three applause tracks are already playing.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The singer player did not confirm applause playback.'));
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, volume, outputId }); }
      catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('The singer player is unavailable.'));
      }
    });
  }

  acknowledge(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const { id, ok, durationMs, error } = value as Record<string, unknown>;
    if (typeof id !== 'string' || typeof ok !== 'boolean') return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (!ok) {
      pending.reject(new Error(typeof error === 'string' ? error.slice(0, 300) : 'Could not play applause.'));
      return;
    }
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 3000 || durationMs > 8000) {
      pending.reject(new Error('The applause player returned an invalid duration.'));
      return;
    }
    const timer = setTimeout(() => this.active.delete(id), durationMs);
    timer.unref?.();
    this.active.set(id, timer);
    pending.resolve();
  }

  clear(): void {
    for (const timer of this.active.values()) clearTimeout(timer);
    this.active.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The singer player closed.'));
    }
    this.pending.clear();
  }
}

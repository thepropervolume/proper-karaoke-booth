import type { LocalCatalogResult } from '../main/karaokenerds-local-browser';

export type LibraryCatalogSearchState = { query: string; phase: 'idle' | 'waiting' | 'searching' | 'complete'; result: LocalCatalogResult | null };
type Scheduler = { schedule(callback: () => void, delayMs: number): unknown; cancel(handle: unknown): void };
const scheduler: Scheduler = { schedule: (callback, delay) => setTimeout(callback, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const unavailable = (): LocalCatalogResult => ({ status: 'unavailable', tracks: [], limited: false, lastSuccess: null });

/** Cancels queued work and ignores superseded in-flight IPC replies. Local search never waits. */
export class LibraryCatalogSearch {
  private generation = 0;
  private timer: unknown = null;
  private disposed = false;
  constructor(private readonly search: (query: string) => Promise<LocalCatalogResult>,
    private readonly publish: (state: LibraryCatalogSearchState) => void, private readonly clock: Scheduler = scheduler) {}
  update(value: string, enabled = true): void {
    if (this.disposed) return;
    const generation = ++this.generation, query = value.trim();
    if (this.timer !== null) { this.clock.cancel(this.timer); this.timer = null; }
    if (!enabled || query.length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/u.test(query)) {
      this.publish({ query, phase: 'idle', result: null }); return;
    }
    this.publish({ query, phase: 'waiting', result: null });
    this.timer = this.clock.schedule(() => {
      this.timer = null;
      if (this.disposed || generation !== this.generation) return;
      this.publish({ query, phase: 'searching', result: null });
      void Promise.resolve().then(() => this.disposed || generation !== this.generation ? null : this.search(query)).catch(unavailable).then(result => {
        if (result && !this.disposed && generation === this.generation) this.publish({ query, phase: 'complete', result });
      });
    }, 300);
  }
  dispose(): void {
    this.disposed = true; ++this.generation;
    if (this.timer !== null) { this.clock.cancel(this.timer); this.timer = null; }
  }
}

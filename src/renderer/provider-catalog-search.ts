import type { ProviderCatalogSearchResult } from '../domain/provider-catalog';

export type ProviderCatalogSearchState = {
  query: string;
  phase: 'idle' | 'waiting' | 'searching' | 'complete';
  results: ProviderCatalogSearchResult[] | null;
  failed: boolean;
};

type Scheduler = { schedule(callback: () => void, delayMs: number): unknown; cancel(handle: unknown): void };
const scheduler: Scheduler = { schedule: (callback, delay) => setTimeout(callback, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** Searches independently of local songs; obsolete IPC replies never replace the latest query. */
export class ProviderCatalogSearch {
  private generation = 0;
  private timer: unknown = null;
  private disposed = false;
  constructor(private readonly search: (query: string) => Promise<ProviderCatalogSearchResult[]>,
    private readonly publish: (state: ProviderCatalogSearchState) => void, private readonly clock: Scheduler = scheduler) {}

  update(value: string, enabled = true): void {
    if (this.disposed) return;
    const generation = ++this.generation, query = value.trim();
    if (this.timer !== null) { this.clock.cancel(this.timer); this.timer = null; }
    if (!enabled || query.length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/u.test(query)) {
      this.publish({ query, phase: 'idle', results: null, failed: false }); return;
    }
    this.publish({ query, phase: 'waiting', results: null, failed: false });
    this.timer = this.clock.schedule(() => {
      this.timer = null;
      if (this.disposed || generation !== this.generation) return;
      this.publish({ query, phase: 'searching', results: null, failed: false });
      void Promise.resolve().then(() => this.disposed || generation !== this.generation ? null : this.search(query))
        .then(results => {
          if (results && !this.disposed && generation === this.generation) this.publish({ query, phase: 'complete', results, failed: false });
        }).catch(() => {
          if (!this.disposed && generation === this.generation) this.publish({ query, phase: 'complete', results: null, failed: true });
        });
    }, 300);
  }

  dispose(): void {
    this.disposed = true; ++this.generation;
    if (this.timer !== null) { this.clock.cancel(this.timer); this.timer = null; }
  }
}

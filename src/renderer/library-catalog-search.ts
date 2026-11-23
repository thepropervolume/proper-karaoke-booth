import type { LocalCatalogResult } from '../main/karaokenerds-local-browser';

export type LibraryCatalogSearchState = {
  query: string;
  phase: 'idle' | 'waiting' | 'searching' | 'loading-more' | 'complete';
  result: LocalCatalogResult | null;
  pageError?: boolean;
};
export type SearchLibraryCatalog = (query: string, cursor?: string) => Promise<LocalCatalogResult>;
type Ready = Extract<LocalCatalogResult, { status: 'ready' }>;
type Scheduler = { schedule(callback: () => void, delayMs: number): unknown; cancel(handle: unknown): void };
const scheduler: Scheduler = { schedule: (callback, delay) => setTimeout(callback, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const unavailable = (): LocalCatalogResult => ({ status: 'unavailable', tracks: [], limited: false, lastSuccess: null });

function mergePages(previous: Ready, page: Ready): Ready {
  const key = (track: Ready['tracks'][number]) => track.youtubeId ?? track.id;
  const seen = new Set(previous.tracks.map(key));
  const newTracks = page.tracks.filter(track => {
    const id = key(track);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const offlineTimes = [previous, page].flatMap(result =>
    result.source === 'offline-cache' && result.fetchedAt !== undefined ? [result.fetchedAt] : []);
  return { ...page, tracks: [...previous.tracks, ...newTracks],
    source: previous.source === 'offline-cache' || page.source === 'offline-cache' ? 'offline-cache' : page.source,
    fetchedAt: offlineTimes.length ? Math.min(...offlineTimes) : page.fetchedAt,
    stale: previous.stale || page.stale,
    cachePersisted: previous.cachePersisted === false ? false : page.cachePersisted };
}

/** Cancels queued work and ignores superseded in-flight IPC replies. Local search never waits. */
export class LibraryCatalogSearch {
  private generation = 0;
  private timer: unknown = null;
  private disposed = false;
  private state: LibraryCatalogSearchState = { query: '', phase: 'idle', result: null };
  constructor(private readonly search: SearchLibraryCatalog,
    private readonly publish: (state: LibraryCatalogSearchState) => void, private readonly clock: Scheduler = scheduler) {}
  private setState(state: LibraryCatalogSearchState): void { this.state = state; this.publish(state); }
  update(value: string, enabled = true): void {
    if (this.disposed) return;
    const generation = ++this.generation, query = value.trim();
    if (this.timer !== null) { this.clock.cancel(this.timer); this.timer = null; }
    if (!enabled || query.length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/u.test(query)) {
      this.setState({ query, phase: 'idle', result: null }); return;
    }
    this.setState({ query, phase: 'waiting', result: null });
    this.timer = this.clock.schedule(() => {
      this.timer = null;
      if (this.disposed || generation !== this.generation) return;
      this.setState({ query, phase: 'searching', result: null });
      void Promise.resolve().then(() => this.disposed || generation !== this.generation ? null : this.search(query)).catch(unavailable).then(result => {
        if (result && !this.disposed && generation === this.generation) this.setState({ query, phase: 'complete', result });
      });
    }, 300);
  }
  async loadMore(): Promise<void> {
    const { query, phase, result } = this.state;
    if (this.disposed || phase !== 'complete' || result?.status !== 'ready' || !result.nextCursor) return;
    const cursor = result.nextCursor;
    const generation = this.generation;
    this.setState({ query, phase: 'loading-more', result });
    const next = await Promise.resolve().then(() => this.disposed || generation !== this.generation ? null : this.search(query, cursor)).catch(unavailable);
    if (!next || this.disposed || generation !== this.generation) return;
    if (next.status === 'forbidden' || next.status === 'unauthorized' || next.status === 'configuration-error') {
      this.setState({ query, phase: 'complete', result: next });
      return;
    }
    // A catalog refresh can invalidate the cursor while the first page is on screen.
    if (next.status !== 'ready' || next.revision !== result.revision || next.nextCursor === cursor) {
      this.setState({ query, phase: 'complete', result, pageError: true });
      return;
    }
    this.setState({ query, phase: 'complete', result: mergePages(result, next) });
  }
  dispose(): void {
    this.disposed = true; ++this.generation;
    if (this.timer !== null) { this.clock.cancel(this.timer); this.timer = null; }
  }
}

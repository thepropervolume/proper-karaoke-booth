/** One lazily constructed show authority shared by all trusted remote transports. */
import type { ShowState } from '../domain';
import type { Settings } from '../domain/settings';
import type { RemoteQueue } from './remote-queue';
import type { Store } from './store';

export class RemoteAuthorityCoordinator {
  private queue: RemoteQueue | undefined;
  private failed = false;
  private failures = new Set<() => void>();
  constructor(private readonly store: Store<ShowState>,
    private readonly settings: () => Pick<Settings, 'autoApprove' | 'rotationMode' | 'pauseIntervalSeconds'> & Partial<Pick<Settings, 'maxFutureRequestsPerSinger'>>,
    private readonly installCommitted: (state: ShowState) => void) {}

  private notify(callback: () => void): void {
    try {
      const result: unknown = callback();
      // Owners must gate synchronously. Do not let an accidental async
      // notification rejection crash the host after the authority is latched.
      if (result && typeof result === 'object' && 'then' in result) void Promise.resolve(result).catch(() => {});
    } catch {}
  }

  usesStore(store: Store<ShowState>): boolean { return store === this.store; }
  getAuthority(): RemoteQueue {
    if (this.failed) throw new Error('Show authority needs recovery. Restart the application before making further changes.');
    this.store.assertRemoteQueueAvailable();
    if (!this.queue) this.queue = this.store.openRemoteQueue(this.settings, this.installCommitted, Date.now, () => {
        // Store has latched the write gate before any callback can reenter.
        this.failed = true;
        for (const callback of [...this.failures]) this.notify(callback);
    });
    return this.queue;
  }
  /** Failure callbacks must synchronously deny their transport before starting cleanup. */
  onFailure(callback: () => void): () => void {
    if (this.failed) { this.notify(callback); return () => {}; }
    this.failures.add(callback);
    return () => { this.failures.delete(callback); };
  }
}

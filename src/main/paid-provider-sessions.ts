/** Main-process-only lifecycle for explicitly installed, trusted provider adapters.
 * No adapter is installed by default; this module makes no network requests.
 */
export const PAID_PROVIDERS = ['karafun', 'party-tyme', 'sunfly'] as const;
export type PaidProviderId = typeof PAID_PROVIDERS[number];
export type PaidProviderPhase = 'unavailable' | 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error' | 'recovery-required';
export type PaidProviderStatus = { id: PaidProviderId; phase: PaidProviderPhase };

/**
 * A handle and any secrets it owns remain in the main process. disconnect must
 * be safe to retry and may resolve only after this app has relinquished access.
 */
export interface PaidProviderConnection { disconnect(): Promise<void> }
/**
 * Only app-owned, approved adapters may be injected. A rejected connect must
 * clean up any partially created access before rejecting. If connect returns
 * after abort, its handle will be disconnected before another attempt is allowed.
 */
export interface PaidProviderAdapter { connect(signal: AbortSignal): Promise<PaidProviderConnection> }

type Entry = {
  adapter?: PaidProviderAdapter;
  phase: PaidProviderPhase;
  connection?: PaidProviderConnection;
  controller?: AbortController;
  pending?: Promise<void>;
};

export class PaidProviderSessions {
  private readonly entries = new Map<PaidProviderId, Entry>();

  constructor(adapters: Partial<Record<PaidProviderId, PaidProviderAdapter>> = {}) {
    for (const id of PAID_PROVIDERS) {
      const adapter = adapters[id];
      this.entries.set(id, { adapter, phase: adapter ? 'disconnected' : 'unavailable' });
    }
  }

  private entry(id: PaidProviderId): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Unknown paid provider.');
    return entry;
  }

  /** Returns only stable provider IDs and lifecycle states, never credentials or account data. */
  status(): PaidProviderStatus[] {
    return PAID_PROVIDERS.map(id => ({ id, phase: this.entry(id).phase }));
  }

  async connect(id: PaidProviderId): Promise<void> {
    const entry = this.entry(id);
    if (!entry.adapter) throw new Error('Provider connection is not available.');
    if (entry.phase !== 'disconnected' && entry.phase !== 'error') throw new Error('Provider connection is busy or requires recovery.');
    const controller = new AbortController();
    entry.controller = controller;
    entry.phase = 'connecting';
    // Install the operation before calling adapter code, including synchronous callbacks.
    const operation = Promise.resolve().then(() => this.establish(entry, controller));
    entry.pending = operation;
    await operation;
  }

  private async establish(entry: Entry, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) {
      entry.phase = 'disconnected';
      entry.controller = undefined;
      entry.pending = undefined;
      return;
    }
    let handle: PaidProviderConnection;
    try {
      handle = await entry.adapter!.connect(controller.signal);
      if (!handle || typeof handle.disconnect !== 'function') throw new Error('Invalid provider connection.');
    } catch {
      entry.phase = controller.signal.aborted ? 'disconnected' : 'error';
      entry.controller = undefined;
      entry.pending = undefined;
      return;
    }
    entry.connection = handle;
    entry.controller = undefined;
    if (!controller.signal.aborted) {
      entry.phase = 'connected';
      entry.pending = undefined;
      return;
    }
    // An adapter may finish after cancellation; do not abandon its handle.
    try {
      await handle.disconnect();
      entry.connection = undefined;
      entry.phase = 'disconnected';
    } catch {
      entry.phase = 'recovery-required';
    }
    entry.pending = undefined;
  }

  async disconnect(id: PaidProviderId): Promise<void> {
    const entry = this.entry(id);
    if (!entry.adapter) throw new Error('Provider connection is not available.');
    if (entry.phase === 'disconnecting') { await entry.pending; return; }
    if (entry.phase === 'connecting') {
      entry.phase = 'disconnecting';
      entry.controller!.abort();
      await entry.pending;
      return;
    }
    if (entry.phase === 'disconnected' || entry.phase === 'error') {
      entry.phase = 'disconnected';
      return;
    }
    if (!entry.connection) throw new Error('Provider connection requires recovery.');
    entry.phase = 'disconnecting';
    const handle = entry.connection;
    const operation = (async () => {
      try {
        await handle.disconnect();
        entry.connection = undefined;
        entry.phase = 'disconnected';
      } catch {
        entry.phase = 'recovery-required';
      }
      entry.pending = undefined;
    })();
    entry.pending = operation;
    await operation;
  }
}

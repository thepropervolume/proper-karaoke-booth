/** Disconnected development-room composition. No tunnel is started until explicitly invoked. */
import { QuickTunnelOpenError, startQuickTunnelDev, type QuickTunnelDevOptions, type QuickTunnelDevSession } from './quick-tunnel-dev';
import { isQuickTunnelOrigin } from './quick-tunnel-loopback';
import { createRelayGuestHandler } from './remote-relay-http';
import { RemoteRelayScope } from './remote-relay-scope';
import type { SingerStaticHandler } from './remote-static';
import type { RemoteQueue } from './remote-queue';

export type RelayRoom = {
  origin: string;
  createInvitation(ttlMs: number): string;
  revokeInvitations(): void;
  revokeGuest(singerId: string): void;
  guests(): { singerId: string; name: string }[];
  stop(): Promise<void>;
};
export class RelayRoomOpenError extends Error {
  constructor(readonly retryCleanup: () => Promise<void>) { super('Relay startup cleanup is incomplete.'); }
}
type Options = Omit<QuickTunnelDevOptions, 'handler' | 'onFailure'> & {
  queue: RemoteQueue;
  staticHandler: SingerStaticHandler;
  onFailure: () => void;
  onGuestsChanged?: () => void;
  onMissingRequest?: () => void;
};
type Start = (options: QuickTunnelDevOptions) => Promise<QuickTunnelDevSession>;

/** Caller must verify the connector binary and provide a trusted HTTPS origin certificate. */
export async function openDevelopmentRelayRoom(options: Options, start: Start = startQuickTunnelDev): Promise<RelayRoom> {
  if (options.enabled !== true || options.signal?.aborted) throw new Error('Development relay is disabled.');
  const scope = new RemoteRelayScope(options.queue, { guests: options.onGuestsChanged, missing: options.onMissingRequest });
  let session: QuickTunnelDevSession | undefined, recovery: (() => Promise<void>) | undefined;
  let failed = false, closed = false, stopping: Promise<void> | undefined;
  const abort = () => fail(false);
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    closed = true; options.signal?.removeEventListener('abort', abort);
    let revokeFailed = false;
    try { scope.close(); } catch { revokeFailed = true; }
    const task = (async () => {
      const result = await Promise.allSettled([session ? session.stop() : recovery ? recovery() : Promise.resolve()]);
      if (revokeFailed || result.some(item => item.status === 'rejected')) throw new Error('Relay cleanup failed.');
    })();
    stopping = task;
    void task.catch(() => { if (stopping === task) stopping = undefined; });
    return task;
  };
  const fail = (notify = true) => {
    if (failed || closed) return;
    failed = true;
    // This changes the scope to inactive before any fallible persistence work.
    try { scope.close(); } catch {}
    if (session) void stop().catch(() => {});
    if (notify) { try { options.onFailure(); } catch {} }
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) throw new Error('Relay startup was cancelled.');
    session = await start({ enabled: true, executable: options.executable, caFile: options.caFile, cert: options.cert, key: options.key,
      handler: createRelayGuestHandler(scope, options.staticHandler), signal: options.signal, startupTimeoutMs: options.startupTimeoutMs, onFailure: () => fail() });
    if (failed || closed || options.signal?.aborted || !isQuickTunnelOrigin(session.origin)) throw new Error('Relay startup failed.');
    const origin = session.origin;
    const requireOpen = () => { if (failed || closed) throw new Error('Relay room is unavailable.'); };
    return { origin,
      createInvitation(ttl) { requireOpen(); return `${origin}/singer/#invite=${scope.createInvitation(ttl)}`; },
      revokeInvitations() { requireOpen(); scope.revokeInvitations(); },
      revokeGuest(id) { requireOpen(); scope.revokeGuest(id); },
      guests() { requireOpen(); return scope.guests(); }, stop };
  } catch (error) {
    if (error instanceof QuickTunnelOpenError) recovery = error.retryCleanup;
    try { await stop(); } catch { throw new RelayRoomOpenError(stop); }
    throw new Error('Development relay could not start.');
  }
}

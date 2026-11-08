import { randomUUID } from 'node:crypto';
import { validateOpenLan, type HostRemoteStatus, type OpenLanInput, type RemoteGuest, type RemoteInterface, type SelectedFile } from '../remote/host-control';

/** Only trusted main-process code may implement this adapter. It must validate TLS, DNS, interfaces and authorization independently. */
export type RemoteRoom = {
  origin: string;
  guests(): RemoteGuest[];
  createInvitation(ttlMs: number): string;
  revokeInvitations(): void;
  revokeGuest(singerId: string): void;
  /** Reject further requests and invalidate all guest and invite credentials. */
  revokeAll(): Promise<void>;
  /** Stop accepting and drain or terminate existing connections. */
  stop(): Promise<void>;
};
export type HostRoomProvider = {
  interfaces(): RemoteInterface[];
  select(kind: 'certificate' | 'privateKey'): Promise<{ label: string; handle: unknown } | null>;
  open(input: Omit<OpenLanInput, 'certificateToken' | 'privateKeyToken'> & { certificate: unknown; privateKey: unknown;
    signal: AbortSignal; onGuestsChanged: () => void; onMissingRequest: () => void; onFailure: () => void }): Promise<RemoteRoom>;
};

/** One room at a time. A null provider is a hard gate: no listener or authority is created. */
export class HostRemoteLifecycle {
  private room: RemoteRoom | null = null;
  private roomId: string | null = null;
  private phase: HostRemoteStatus['room'] = 'closed';
  private selections = new Map<string, { kind: 'certificate' | 'privateKey'; handle: unknown }>();
  private pending = false;
  private disposing = false;
  private openController: AbortController | null = null;
  private opening: Promise<void> | null = null;
  private cleaning: Promise<void> | null = null;
  private shutdownTask: Promise<boolean> | null = null;
  constructor(private readonly provider: HostRoomProvider | null, private readonly publish: (value: HostRemoteStatus) => void = () => {},
    private readonly onMissingRequest: () => void = () => {}) {}
  status(): HostRemoteStatus {
    let interfaces: RemoteInterface[] = [], guests: RemoteGuest[] = [];
    if (this.provider) interfaces = this.provider.interfaces().map(({ id, label }) => ({ id, label }));
    if (this.room && this.phase === 'open') guests = this.room.guests().map(({ singerId, name }) => ({ singerId, name }));
    return { available: !!this.provider && !this.disposing, room: this.phase, roomId: this.phase === 'open' ? this.roomId : null,
      lanOrigin: this.phase === 'open' ? this.room?.origin ?? null : null, interfaces, guests,
      message: this.disposing ? 'Remote queueing is shutting down.' : !this.provider ? 'Remote queueing is not available yet.' : this.phase === 'failed' ? 'The room needs recovery before it can be reopened.' : '' };
  }
  private changed(): void { try { this.publish(this.status()); } catch { /* UI notification must not interrupt cleanup. */ } }
  private requireProvider(): HostRoomProvider { if (!this.provider || this.disposing) throw new Error('Remote queueing is not available yet.'); return this.provider; }
  private requireRoom(): RemoteRoom { if (this.disposing || !this.room || this.phase !== 'open' || this.pending) throw new Error('Remote room is unavailable.'); return this.room; }
  async select(kind: 'certificate' | 'privateKey'): Promise<SelectedFile | null> {
    const provider = this.requireProvider();
    if (this.phase !== 'closed' || this.pending) throw new Error('Close the room first.');
    this.pending = true;
    try {
      const selected = await provider.select(kind);
      if (this.disposing) return null;
      if (!selected) return null;
      // Labels are filenames, never paths or private-key contents.
      if (typeof selected.label !== 'string' || !selected.label || selected.label.length > 255 || /[\\/\x00-\x1f]/.test(selected.label)) throw new Error('Invalid file selection.');
      for (const [token, item] of this.selections) if (item.kind === kind) this.selections.delete(token);
      const token = randomUUID(); this.selections.set(token, { kind, handle: selected.handle });
      return { token, label: selected.label };
    } finally { this.pending = false; }
  }
  async open(input: unknown): Promise<void> {
    const provider = this.requireProvider();
    if (this.phase !== 'closed' || this.pending || this.room) throw new Error('A room is already active or needs recovery.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid room settings.');
    const fields = input as Record<string, unknown>;
    if (Object.keys(fields).sort().join(',') !== 'certificateToken,hostname,interfaceId,port,privateKeyToken' ||
      typeof fields.interfaceId !== 'string' || typeof fields.hostname !== 'string' || typeof fields.port !== 'number' ||
      typeof fields.certificateToken !== 'string' || typeof fields.privateKeyToken !== 'string') throw new Error('Invalid room settings.');
    const value = fields as OpenLanInput;
    const certificate = this.selections.get(value.certificateToken), key = this.selections.get(value.privateKeyToken);
    if (validateOpenLan(value, provider.interfaces()) || certificate?.kind !== 'certificate' || key?.kind !== 'privateKey') throw new Error('Invalid room settings.');
    this.pending = true; this.phase = 'opening'; this.roomId = randomUUID(); const roomId = this.roomId;
    const controller = new AbortController(); this.openController = controller;
    let finishOpening!: () => void;
    const opening = new Promise<void>(resolve => { finishOpening = resolve; }); this.opening = opening;
    let failedDuringOpen = false;
    this.changed();
    try {
      this.room = await provider.open({ interfaceId: value.interfaceId, hostname: value.hostname, port: value.port, certificate: certificate.handle, privateKey: key.handle, signal: controller.signal,
        onGuestsChanged: () => { if (this.roomId === roomId && this.phase === 'open') this.changed(); },
        onMissingRequest: () => { if (this.roomId === roomId && this.phase === 'open' && !this.disposing) { try { this.onMissingRequest(); } catch { /* Host can reload the list. */ } } },
        onFailure: () => { if (this.roomId !== roomId) return; if (this.phase === 'opening') failedDuringOpen = true; else void this.failRoom(roomId); } });
      if (this.disposing || controller.signal.aborted) throw new Error('Remote room startup was cancelled.');
      if (failedDuringOpen) throw new Error('Remote listener failed during startup.');
      const expected = new URL(`https://${value.hostname.includes(':') ? `[${value.hostname}]` : value.hostname}:${value.port}`).origin;
      if (this.room.origin !== expected) throw new Error('Invalid room origin.');
      this.phase = 'open';
      this.selections.clear();
    } catch (error) {
      if (this.room) {
        try { await this.cleanup(); } catch { this.phase = 'failed'; this.changed(); throw new Error('Remote room needs recovery.'); }
      }
      this.roomId = null; this.phase = 'closed'; this.changed(); throw error;
    } finally { this.pending = false; finishOpening(); if (this.opening === opening) this.opening = null; }
    this.changed();
  }
  createInvitation(ttlSeconds: unknown): string {
    const room = this.requireRoom();
    if (!Number.isInteger(ttlSeconds) || (ttlSeconds as number) < 60 || (ttlSeconds as number) > 3600) throw new Error('Invalid invitation duration.');
    const token = room.createInvitation((ttlSeconds as number) * 1000);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid invitation.');
    return `${room.origin}/singer/#invite=${token}`;
  }
  revokeInvitations(): void { this.requireRoom().revokeInvitations(); this.changed(); }
  revokeGuest(singerId: unknown): void {
    if (typeof singerId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(singerId)) throw new Error('Invalid singer.');
    this.requireRoom().revokeGuest(singerId); this.changed();
  }
  async close(): Promise<void> {
    this.requireProvider();
    if (!this.pending && this.phase === 'failed' && !this.room) { this.roomId = null; this.phase = 'closed'; this.changed(); return; }
    if (this.pending || !this.room || (this.phase !== 'open' && this.phase !== 'failed')) throw new Error('Remote room is unavailable.');
    this.pending = true; this.phase = 'closing'; this.changed();
    try { await this.cleanup(); this.phase = 'closed'; }
    catch { this.phase = 'failed'; throw new Error('Remote room needs recovery.'); }
    finally { this.pending = false; this.changed(); }
  }
  private async failRoom(roomId: string): Promise<void> {
    if (this.roomId !== roomId || this.phase !== 'open' || this.pending) return;
    this.pending = true; this.phase = 'failed'; this.changed();
    try { await this.cleanup(); } catch { /* Keep the room and block reopening for recovery. */ }
    finally { this.pending = false; this.changed(); }
  }
  /** Starts shutdown synchronously; returns false at the deadline rather than blocking app exit. */
  shutdown(timeoutMs = 5000): Promise<boolean> {
    if (this.shutdownTask) return this.shutdownTask;
    this.disposing = true;
    // Providers must immediately stop guest calls and prevent later authority creation on abort.
    this.openController?.abort();
    if (this.phase === 'open') this.phase = 'closing';
    this.changed();
    const deadline = Math.max(0, Math.min(10000, Number.isFinite(timeoutMs) ? timeoutMs : 5000));
    const work = (async () => {
      if (this.opening) await this.opening;
      if (this.room) await this.cleanup();
      return true;
    })().catch(() => false);
    this.shutdownTask = new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), deadline);
      void work.then(result => { clearTimeout(timer); resolve(result); });
    });
    return this.shutdownTask;
  }
  needsShutdownWait(): boolean { return !!this.opening || !!this.room || !!this.cleaning; }
  private async cleanup(): Promise<void> {
    if (this.cleaning) return this.cleaning;
    const room = this.room!;
    const cleaning = (async () => {
      // Start both actions without waiting for either; a slow drain must not delay revocation.
      const [stopped, revoked] = await Promise.allSettled([
        Promise.resolve().then(() => room.stop()), Promise.resolve().then(() => room.revokeAll())
      ]);
      if (stopped.status === 'rejected' || revoked.status === 'rejected') throw new Error('Remote room cleanup failed.');
      this.room = null; this.roomId = null;
    })();
    this.cleaning = cleaning;
    try { await cleaning; } finally { if (this.cleaning === cleaning) this.cleaning = null; }
  }
}

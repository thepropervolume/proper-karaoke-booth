/** Host-owned, separate relay room on the same show authority. No network is opened here. */
import type { RemoteQueue } from './remote-queue';

export class RemoteRelayScope {
  private readonly scope: string;
  private active = true;
  private revoked = false;
  constructor(private readonly queue: RemoteQueue, private readonly notify: { guests?: () => void; missing?: () => void } = {}) { this.scope = queue.beginRelayScope(); }
  private requireActive(): void { if (!this.active) throw new Error('Guest access denied.'); }
  private changed(callback: (() => void) | undefined): void { try { callback?.(); } catch { /* Never turn a committed request into a failure. */ } }
  createInvitation(ttlMs: number): string { this.requireActive(); return this.queue.createInvitation(ttlMs, this.scope); }
  revokeInvitations(): void { this.requireActive(); this.queue.revokeInvitations(this.scope); }
  revokeGuest(singerId: string): void { this.requireActive(); this.queue.revokeGuest(singerId, this.scope); this.changed(this.notify.guests); }
  guests() { this.requireActive(); return this.queue.listGuests(this.scope); }
  /** Synchronously blocks access first; persistent revocation can be retried if it fails. */
  close(): void {
    this.active = false;
    if (!this.revoked) { this.queue.closeRoom(this.scope); this.revoked = true; }
  }
  readonly authority = {
    admissionInfo: (invitation: unknown) => { this.requireActive(); return this.queue.admissionInfo(invitation, this.scope); },
    join: (invitation: unknown, id: unknown, secret: unknown, name: unknown, revision: unknown) => { this.requireActive(); const result = this.queue.join(invitation, id, secret, name, revision, this.scope); this.changed(this.notify.guests); return result; },
    resume: (secret: unknown) => { this.requireActive(); return this.queue.resume(secret, this.scope); },
    snapshot: (session: unknown) => { this.requireActive(); return this.queue.snapshot(session, this.scope); },
    catalog: (session: unknown, offset = 0, limit = 50) => { this.requireActive(); return this.queue.catalog(session, offset, limit, this.scope); },
    outcome: (session: unknown, command: unknown) => { this.requireActive(); return this.queue.outcome(session, command, this.scope); },
    submit: (session: unknown, command: unknown) => { this.requireActive(); return this.queue.submit(session, command, this.scope); },
    setAvailability: (session: unknown, command: unknown) => { this.requireActive(); return this.queue.setAvailability(session, command, this.scope); },
    withdraw: (session: unknown, command: unknown) => { this.requireActive(); return this.queue.withdraw(session, command, this.scope); },
    submitMissing: (session: unknown, command: unknown) => { this.requireActive(); const result = this.queue.submitMissing(session, command, this.scope); if (result.ok) this.changed(this.notify.missing); return result; },
  };
}


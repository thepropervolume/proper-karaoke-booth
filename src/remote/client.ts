import type { Outcome, RequestStatus } from '../domain';

export type Song = { id: string; title: string; artist: string };
export type GuestSnapshot = { showId: string; hostEpoch: string; revision: number; singerId: string; singerName: string;
  unavailableUntilMs?: number; serverNowMs?: number; catalog: Song[]; catalogNextOffset: number | null; requestsTruncated?: boolean; requests: { id: string; versionId: string; status: RequestStatus }[] };
export type GuestTransport = {
  admission(invitation: string): Promise<{ showId: string; hostEpoch: string; revision: number }>;
  join(invitation: string, joinId: string, resumeSecret: string, name: string, revision: number): Promise<{ session: string; singerId: string }>;
  resume(resumeSecret: string): Promise<{ session: string; singerId: string }>;
  snapshot(session: string): Promise<GuestSnapshot>;
  catalog(session: string, offset: number, limit: number): Promise<{ revision: number; items: Song[]; nextOffset: number | null }>;
  submit(session: string, request: { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; versionId: string }): Promise<Outcome>;
  withdraw(session: string, request: { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; requestId: string }): Promise<Outcome>;
  setAvailability?(session: string, request: { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; minutes: number }): Promise<Outcome>;
  submitMissing(session: string, request: { commandId: string; title: string; artist: string }): Promise<Outcome>;
  outcome(session: string, commandId: string): Promise<Outcome | null>;
};

export type GuestView = { joined: boolean; snapshot: GuestSnapshot | null; songs: Song[]; nextOffset: number | null; busy: boolean;
  message: string; uncertain: boolean; joinUncertain: boolean };
type PendingJoin = { name: string; id: string; secret: string; revision: number };
/** A specifically identified, rolled-back admission conflict; no guest was created. */
export class JoinRevisionConflict extends Error {}

/** All bearer credentials and invitation remain private to this object and live only in memory. */
export class SingerClient {
  private invitation: string;
  private session = '';
  private resumeSecret = '';
  private pendingJoin: PendingJoin | null = null;
  private pendingRequest: string | null = null;
  private pendingKind: 'song' | 'missing' | 'withdraw' | 'availability' | null = null;
  private view: GuestView = { joined: false, snapshot: null, songs: [], nextOffset: null, busy: false, message: '', uncertain: false, joinUncertain: false };
  constructor(private transport: GuestTransport, invitation: string, private random: () => string = randomSecret) { this.invitation = invitation; }
  private emit(listener: (view: GuestView) => void, changes: Partial<GuestView>): void {
    this.view = { ...this.view, ...changes }; listener(this.state());
  }
  state(): GuestView { return structuredClone(this.view); }
  /** A lost join response can be retried using the exact same identity and revision. */
  async join(name: string, listener: (view: GuestView) => void): Promise<void> {
    if (this.view.busy || this.session) return;
    const cleaned = name.trim();
    if (!cleaned || cleaned.length > 100) { this.emit(listener, { message: 'Enter a name of up to 100 characters.' }); return; }
    if (this.pendingJoin && this.pendingJoin.name !== cleaned) { this.emit(listener, { message: 'Retry with the same name to recover your earlier join attempt.' }); return; }
    this.emit(listener, { busy: true, message: '' });
    try {
      if (!this.pendingJoin) {
        const info = await this.transport.admission(this.invitation);
        this.pendingJoin = { name: cleaned, id: this.random(), secret: this.random(), revision: info.revision };
      }
      const pending = this.pendingJoin;
      const joined = await this.transport.join(this.invitation, pending.id, pending.secret, pending.name, pending.revision);
      this.session = joined.session; this.resumeSecret = pending.secret;
      this.invitation = ''; this.pendingJoin = null;
      this.emit(listener, { joined: true, joinUncertain: false });
      await this.loadSnapshot(listener);
    } catch (error) {
      if (!this.session && error instanceof JoinRevisionConflict) {
        this.pendingJoin = null;
        this.emit(listener, { joinUncertain: false, message: 'The show changed while you joined. Please try again.' });
      } else this.emit(listener, { joinUncertain: !!this.pendingJoin, message: this.session ? 'Joined, but the show could not be loaded. Refresh to reconnect.' : this.pendingJoin ? 'Could not confirm joining. Retry with the same name.' : 'Could not connect or the invitation is unavailable.' });
    } finally { this.emit(listener, { busy: false }); }
  }
  private async loadSnapshot(listener: (view: GuestView) => void): Promise<void> {
    const snapshot = await this.transport.snapshot(this.session);
    this.emit(listener, { snapshot, songs: snapshot.catalog, nextOffset: snapshot.catalogNextOffset, message: '' });
  }
  async refresh(listener: (view: GuestView) => void): Promise<void> {
    if (!this.session || this.view.busy) return;
    this.emit(listener, { busy: true });
    try { await this.loadSnapshot(listener); }
    catch { this.emit(listener, { message: 'Connection unavailable. Reconnect and refresh to see current status.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  async reconnect(listener: (view: GuestView) => void): Promise<void> {
    if (!this.resumeSecret || this.view.busy) return;
    this.emit(listener, { busy: true });
    try { this.session = (await this.transport.resume(this.resumeSecret)).session; await this.loadSnapshot(listener); }
    catch { this.emit(listener, { message: 'Could not reconnect. The show may be offline or access may have expired.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  async more(listener: (view: GuestView) => void): Promise<void> {
    if (!this.session || this.view.busy || this.view.nextOffset === null || !this.view.snapshot) return;
    this.emit(listener, { busy: true });
    try {
      const page = await this.transport.catalog(this.session, this.view.nextOffset, 50);
      if (page.revision !== this.view.snapshot.revision) { await this.loadSnapshot(listener); this.emit(listener, { message: 'The catalog changed; the list was refreshed.' }); }
      else this.emit(listener, { songs: [...this.view.songs, ...page.items], nextOffset: page.nextOffset, message: '' });
    } catch { this.emit(listener, { message: 'Could not load more songs. Check your connection.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  async request(versionId: string, listener: (view: GuestView) => void): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.session || !snapshot || this.view.busy || this.pendingRequest || !this.view.songs.some(song => song.id === versionId)) return;
    const commandId = this.random(); this.pendingRequest = commandId; this.pendingKind = 'song';
    this.emit(listener, { busy: true, message: '' });
    try {
      const result = await this.transport.submit(this.session, { commandId, showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, versionId });
      this.pendingRequest = null; this.pendingKind = null;
      await this.afterOutcome(result, listener, 'song');
    } catch { this.emit(listener, { uncertain: true, message: 'The request may have been received. Check its outcome before requesting another song.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  async withdraw(requestId: string, listener: (view: GuestView) => void): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.session || !snapshot || this.view.busy || this.pendingRequest || !snapshot.requests.some(item => item.id === requestId && ['pending', 'accepted'].includes(item.status))) return;
    const commandId = this.random(); this.pendingRequest = commandId; this.pendingKind = 'withdraw';
    this.emit(listener, { busy: true, message: '' });
    try {
      const result = await this.transport.withdraw(this.session, { commandId, showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, requestId });
      this.pendingRequest = null; this.pendingKind = null;
      await this.afterOutcome(result, listener, 'withdraw');
    } catch { this.emit(listener, { uncertain: true, message: 'Withdrawal may have been received. Check its outcome before making another request.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  async setAvailability(minutes: number, listener: (view: GuestView) => void): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.session || !snapshot || this.view.busy || this.pendingRequest) return;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) { this.emit(listener, { message: 'Choose a whole number of minutes from 0 to 60.' }); return; }
    if (!this.transport.setAvailability) { this.emit(listener, { message: 'Availability controls are unavailable on this connection.' }); return; }
    const commandId = this.random(); this.pendingRequest = commandId; this.pendingKind = 'availability';
    this.emit(listener, { busy: true, message: '' });
    try {
      const result = await this.transport.setAvailability(this.session, { commandId, showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, minutes });
      this.pendingRequest = null; this.pendingKind = null;
      await this.afterOutcome(result, listener, 'availability');
    } catch { this.emit(listener, { uncertain: true, message: 'Availability may have been updated. Check its outcome before making another change.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  /** Missing songs go to the host's request list, not the performance rotation. */
  async requestMissing(title: string, artist: string, listener: (view: GuestView) => void): Promise<void> {
    if (!this.session || !this.view.snapshot || this.view.busy || this.pendingRequest) return;
    const cleanTitle = title.trim(), cleanArtist = artist.trim();
    if (!cleanTitle || cleanTitle.length > 200 || cleanArtist.length > 200) { this.emit(listener, { message: 'Enter a title and keep each field within 200 characters.' }); return; }
    const commandId = this.random(); this.pendingRequest = commandId; this.pendingKind = 'missing';
    this.emit(listener, { busy: true, message: '' });
    try {
      const result = await this.transport.submitMissing(this.session, { commandId, title: cleanTitle, artist: cleanArtist });
      this.pendingRequest = null; this.pendingKind = null;
      await this.afterOutcome(result, listener, 'missing');
    } catch { this.emit(listener, { uncertain: true, message: 'The request may have been received. Check its outcome before requesting another song.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  async checkOutcome(listener: (view: GuestView) => void): Promise<void> {
    if (!this.session || !this.pendingRequest || this.view.busy) return;
    this.emit(listener, { busy: true });
    try {
      const result = await this.transport.outcome(this.session, this.pendingRequest);
      if (!result) this.emit(listener, { message: 'The result is not available yet. Check again before sending another request.' });
      else { const kind = this.pendingKind ?? 'song'; this.pendingRequest = null; this.pendingKind = null; await this.afterOutcome(result, listener, kind); }
    } catch { this.emit(listener, { message: 'Could not check the request. Reconnect and try again.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  private async afterOutcome(result: Outcome, listener: (view: GuestView) => void, kind: 'song' | 'missing' | 'withdraw' | 'availability'): Promise<void> {
    this.emit(listener, { uncertain: false });
    const success = kind === 'availability' ? 'Availability updated.' : kind === 'missing' ? 'Missing-song request sent to the host.' : kind === 'withdraw' ? 'Request withdrawn.' : 'Request received.';
    try { await this.loadSnapshot(listener); }
    catch { this.emit(listener, { message: result.ok ? `${success} Refresh when connected for status.` : `${result.message} Refresh when connected.` }); return; }
    this.emit(listener, { message: result.ok ? success : `${result.message} Review the refreshed list before trying again.` });
  }
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Read once and remove the invitation from the address bar and browser history immediately. */
export function takeInvitation(location: Location, history: History): string {
  const value = new URLSearchParams(location.hash.slice(1)).get('invite') ?? '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return value;
}

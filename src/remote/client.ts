import type { Outcome, RequestStatus } from '../domain';
import { SINGER_ON_HOLD } from '../domain/singer-availability';

export type Song = { id: string; title: string; artist: string };
export type GuestSnapshot = { showId: string; hostEpoch: string; revision: number; singerId: string; singerName: string;
  unavailableUntilMs?: number; serverNowMs?: number; applauseEnabled?: boolean; applauseCredits?: number; points?: number; photoEnabled?: boolean; catalog: Song[]; catalogNextOffset: number | null; requestsTruncated?: boolean; requests: { id: string; versionId: string; status: RequestStatus }[] };
export type GuestTransport = {
  admission(invitation: string): Promise<{ showId: string; hostEpoch: string; revision: number }>;
  join(invitation: string, joinId: string, resumeSecret: string, name: string, revision: number): Promise<{ session: string; singerId: string }>;
  resume(resumeSecret: string): Promise<{ session: string; singerId: string }>;
  snapshot(session: string): Promise<GuestSnapshot>;
  catalog(session: string, offset: number, limit: number, query?: string): Promise<{ revision: number; items: Song[]; nextOffset: number | null }>;
  submit(session: string, request: { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; versionId: string }): Promise<Outcome>;
  withdraw(session: string, request: { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; requestId: string }): Promise<Outcome>;
  setAvailability?(session: string, request: { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; minutes: number }): Promise<Outcome>;
  applaud?(session: string, request: { commandId: string; showId: string; hostEpoch: string; expectedRevision: number }): Promise<Outcome>;
  submitPhoto?(session: string, request: { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; dataUrl: string }): Promise<Outcome>;
  submitMissing(session: string, request: { commandId: string; title: string; artist: string }): Promise<Outcome>;
  outcome(session: string, commandId: string): Promise<Outcome | null>;
};

export type GuestView = { joined: boolean; snapshot: GuestSnapshot | null; songs: Song[]; nextOffset: number | null; busy: boolean;
  message: string; uncertain: boolean; retryAvailable: boolean; joinUncertain: boolean; searching?: boolean };
type PendingJoin = { name: string; id: string; secret: string; revision: number };
type PendingRequest =
  | { kind: 'song'; command: Parameters<GuestTransport['submit']>[1] }
  | { kind: 'withdraw'; command: Parameters<GuestTransport['withdraw']>[1] }
  | { kind: 'availability'; command: Parameters<NonNullable<GuestTransport['setAvailability']>>[1] }
  | { kind: 'applause'; command: Parameters<NonNullable<GuestTransport['applaud']>>[1] }
  | { kind: 'photo'; command: Parameters<NonNullable<GuestTransport['submitPhoto']>>[1] }
  | { kind: 'missing'; command: Parameters<GuestTransport['submitMissing']>[1] };
function validOutcome(value: unknown): value is Outcome {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return Number.isSafeInteger(result.revision) && (result.revision as number) >= 0 &&
    (result.ok === true || (result.ok === false && typeof result.code === 'string' && !!result.code && typeof result.message === 'string'));
}
/** A specifically identified, rolled-back admission conflict; no guest was created. */
export class JoinRevisionConflict extends Error {}

/** All bearer credentials and invitation remain private to this object and live only in memory. */
export class SingerClient {
  private invitation: string;
  private catalogQuery = '';
  private catalogGeneration = 0;
  private session = '';
  private singerId = '';
  private resumeSecret = '';
  private pendingJoin: PendingJoin | null = null;
  private pendingRequest: PendingRequest | null = null;
  private view: GuestView = { joined: false, snapshot: null, songs: [], nextOffset: null, busy: false, message: '', uncertain: false, retryAvailable: false, joinUncertain: false };
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
      if (typeof joined.session !== 'string' || !joined.session || typeof joined.singerId !== 'string' || !joined.singerId) throw new Error('Invalid singer identity.');
      this.session = joined.session; this.singerId = joined.singerId; this.resumeSecret = pending.secret;
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
    const generation = ++this.catalogGeneration;
    const snapshot = await this.transport.snapshot(this.session);
    if (!snapshot || snapshot.singerId !== this.singerId) throw new Error('Singer identity changed.');
    if (generation !== this.catalogGeneration) return;
    this.emit(listener, { snapshot, songs: this.catalogQuery ? [] : snapshot.catalog,
      nextOffset: this.catalogQuery ? null : snapshot.catalogNextOffset, searching: !!this.catalogQuery, message: '' });
    if (this.catalogQuery) {
      try {
        const page = await this.transport.catalog(this.session, 0, 50, this.catalogQuery);
        if (generation !== this.catalogGeneration) return;
        if (page.revision !== snapshot.revision) throw new Error('Catalog changed while refreshing.');
        this.emit(listener, { songs: page.items, nextOffset: page.nextOffset, searching: false });
      } catch (error) {
        if (generation === this.catalogGeneration) this.emit(listener, { searching: false, message: 'Could not search songs. Refresh to try again.' });
        throw error;
      }
    }
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
    try {
      const resumed = await this.transport.resume(this.resumeSecret);
      if (typeof resumed.session !== 'string' || !resumed.session || resumed.singerId !== this.singerId) throw new Error('Singer identity changed.');
      this.session = resumed.session; await this.loadSnapshot(listener);
    }
    catch { this.emit(listener, { message: 'Could not reconnect. The show may be offline or access may have expired.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  /** Search is server-side; the generation fences late responses to earlier text. */
  async search(query: string, listener: (view: GuestView) => void): Promise<void> {
    const generation = ++this.catalogGeneration;
    this.catalogQuery = query.slice(0, 200);
    this.emit(listener, { songs: [], nextOffset: null, searching: true, message: '' });
    await new Promise(resolve => setTimeout(resolve, 250));
    if (generation !== this.catalogGeneration || !this.session || !this.view.snapshot) return;
    try {
      const page = await this.transport.catalog(this.session, 0, 50, this.catalogQuery);
      if (generation !== this.catalogGeneration) return;
      if (page.revision !== this.view.snapshot.revision) { await this.loadSnapshot(listener); return; }
      this.emit(listener, { songs: page.items, nextOffset: page.nextOffset, searching: false });
    } catch {
      if (generation === this.catalogGeneration) this.emit(listener, { searching: false, message: 'Could not search songs. Check your connection.' });
    }
  }
  async more(listener: (view: GuestView) => void): Promise<void> {
    if (!this.session || this.view.busy || this.view.nextOffset === null || !this.view.snapshot) return;
    const generation = this.catalogGeneration;
    this.emit(listener, { busy: true });
    try {
      const page = await this.transport.catalog(this.session, this.view.nextOffset, 50, this.catalogQuery);
      if (generation !== this.catalogGeneration) return;
      if (page.revision !== this.view.snapshot!.revision) { await this.loadSnapshot(listener); this.emit(listener, { message: 'The catalog changed; the list was refreshed.' }); }
      else this.emit(listener, { songs: [...this.view.songs, ...page.items], nextOffset: page.nextOffset, message: '' });
    } catch { if (generation === this.catalogGeneration) this.emit(listener, { message: 'Could not load more songs. Check your connection.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  async request(versionId: string, listener: (view: GuestView) => void): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.session || !snapshot || this.view.busy || this.pendingRequest || !this.view.songs.some(song => song.id === versionId)) return;
    this.pendingRequest = { kind: 'song', command: { commandId: this.random(), showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, versionId } };
    await this.sendPending(listener);
  }
  async withdraw(requestId: string, listener: (view: GuestView) => void): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.session || !snapshot || this.view.busy || this.pendingRequest || !snapshot.requests.some(item => item.id === requestId && ['pending', 'accepted', 'staged'].includes(item.status))) return;
    this.pendingRequest = { kind: 'withdraw', command: { commandId: this.random(), showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, requestId } };
    await this.sendPending(listener);
  }
  async setAvailability(minutes: number, listener: (view: GuestView) => void): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.session || !snapshot || this.view.busy || this.pendingRequest) return;
    if (snapshot.unavailableUntilMs === SINGER_ON_HOLD) { this.emit(listener, { message: 'Ask the host to return you to the rotation.' }); return; }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) { this.emit(listener, { message: 'Choose a whole number of minutes from 0 to 60.' }); return; }
    if (!this.transport.setAvailability) { this.emit(listener, { message: 'Availability controls are unavailable on this connection.' }); return; }
    this.pendingRequest = { kind: 'availability', command: { commandId: this.random(), showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, minutes } };
    await this.sendPending(listener);
  }
  async applaud(listener: (view: GuestView) => void): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.session || !snapshot || this.view.busy || this.pendingRequest || !this.transport.applaud) return;
    this.pendingRequest = { kind: 'applause', command: { commandId: this.random(), showId: snapshot.showId,
      hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision } };
    await this.sendPending(listener);
  }
  async sendPhoto(dataUrl: string, listener: (view: GuestView) => void): Promise<void> {
    const snapshot = this.view.snapshot;
    if (!this.session || !snapshot || this.view.busy || this.pendingRequest || !this.transport.submitPhoto || !snapshot.photoEnabled) return;
    this.pendingRequest = { kind: 'photo', command: { commandId: this.random(), showId: snapshot.showId,
      hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, dataUrl } };
    await this.sendPending(listener);
  }
  /** Missing songs go to the host's request list, not the performance rotation. */
  async requestMissing(title: string, artist: string, listener: (view: GuestView) => void): Promise<void> {
    if (!this.session || !this.view.snapshot || this.view.busy || this.pendingRequest) return;
    const cleanTitle = title.trim(), cleanArtist = artist.trim();
    if (!cleanTitle || cleanTitle.length > 200 || cleanArtist.length > 200) { this.emit(listener, { message: 'Enter a title and keep each field within 200 characters.' }); return; }
    this.pendingRequest = { kind: 'missing', command: { commandId: this.random(), title: cleanTitle, artist: cleanArtist } };
    await this.sendPending(listener);
  }
  /** Explicit user retry uses the exact original command, never a new ID or revision. */
  async retryPending(listener: (view: GuestView) => void): Promise<void> {
    if (!this.view.uncertain || !this.view.retryAvailable || !this.pendingRequest || !this.session || this.view.busy) return;
    await this.sendPending(listener);
  }
  private async sendPending(listener: (view: GuestView) => void): Promise<void> {
    const pending = this.pendingRequest;
    if (!pending || !this.session || this.view.busy) return;
    this.emit(listener, { busy: true, message: '', retryAvailable: false });
    try {
      let result: Outcome;
      if (pending.kind === 'song') result = await this.transport.submit(this.session, { ...pending.command });
      else if (pending.kind === 'withdraw') result = await this.transport.withdraw(this.session, { ...pending.command });
      else if (pending.kind === 'availability') {
        if (!this.transport.setAvailability) throw new Error('Availability controls are unavailable.');
        result = await this.transport.setAvailability(this.session, { ...pending.command });
      } else if (pending.kind === 'applause') {
        if (!this.transport.applaud) throw new Error('Applause is unavailable.');
        result = await this.transport.applaud(this.session, { ...pending.command });
      } else if (pending.kind === 'photo') {
        if (!this.transport.submitPhoto) throw new Error('Photo sharing is unavailable.');
        result = await this.transport.submitPhoto(this.session, { ...pending.command });
      } else result = await this.transport.submitMissing(this.session, { ...pending.command });
      // Even a malformed success response is outcome-unknown; do not lose the ID.
      if (!validOutcome(result)) throw new Error('Invalid request outcome.');
      this.pendingRequest = null;
      await this.afterOutcome(result, listener, pending.kind);
    } catch {
      const subject = pending.kind === 'withdraw' ? 'Withdrawal' : pending.kind === 'availability' ? 'Availability' : 'The request';
      this.emit(listener, { uncertain: true, message: `${subject} may have been received. Check its outcome before making another request.` });
    } finally { this.emit(listener, { busy: false }); }
  }
  async checkOutcome(listener: (view: GuestView) => void): Promise<void> {
    if (!this.session || !this.pendingRequest || this.view.busy) return;
    this.emit(listener, { busy: true });
    try {
      const result = await this.transport.outcome(this.session, this.pendingRequest.command.commandId);
      if (result === null) this.emit(listener, { retryAvailable: true, message: 'No outcome is available yet. You can check again or retry the original action safely.' });
      else {
        if (!validOutcome(result)) throw new Error('Invalid request outcome.');
        const kind = this.pendingRequest.kind; this.pendingRequest = null;
        await this.afterOutcome(result, listener, kind);
      }
    } catch { this.emit(listener, { message: 'Could not check the request. Reconnect and try again.' }); }
    finally { this.emit(listener, { busy: false }); }
  }
  private async afterOutcome(result: Outcome, listener: (view: GuestView) => void, kind: 'song' | 'missing' | 'withdraw' | 'availability' | 'applause' | 'photo'): Promise<void> {
    this.emit(listener, { uncertain: false, retryAvailable: false });
    const success = kind === 'photo' ? 'Photo sent to the host.' : kind === 'applause' ? 'Applause sent.' : kind === 'availability' ? 'Availability updated.' : kind === 'missing' ? 'Missing-song request sent to the host.' : kind === 'withdraw' ? 'Request withdrawn.' : 'Request received.';
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

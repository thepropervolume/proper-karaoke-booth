import { mobileJson, MobileHttpError, MOBILE_ORIGIN } from './api';
import { MobileRoomAuthority } from './room-authority';
import { validateSessionSlug } from '../remote/internet-session-control';
import type { InternetGuestCall, InternetGuestReply } from '../main/internet-queue-client';
import { MAX_PHOTO_BODY_BYTES } from '../domain/photo';

type Room = { roomId: string; generation: string; slug: string; publicUrl: string; expiresAt: number };
type OwnedRoom = { room: Room; token: string };
type OpenAttempt = { slug: string; openId: string; token: string; accessUntil: number; sent: boolean; cancelled: boolean; owned?: OwnedRoom };
type LiveRoom = OwnedRoom & { controller: AbortController; epoch: number };
type Options = { json?: typeof mobileJson; retryDelayMs?: number; now?: () => number };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const OPERATIONS = new Set(['admission', 'join', 'resume', 'snapshot', 'catalog', 'outcome', 'request', 'withdraw', 'availability', 'missing-request', 'applause', 'photo']);
const MUTATIONS = new Set(['join', 'request', 'withdraw', 'availability', 'missing-request', 'applause', 'photo']);
const terminal = (error: unknown) => error instanceof MobileHttpError && [400, 401, 403, 404, 409, 410].includes(error.status);
class InvalidRoomResponse extends Error {}
export type MobileRoomStatus = { state: 'stopped' | 'starting' | 'online' | 'reconnecting' | 'failed'; link: string; message: string;
  pending?: boolean; pendingAction?: 'open' | 'close' };

/** One room generation at a time; capabilities stay in memory and never cross attempts. */
export class MobileHostedRoom {
  private opening: OpenAttempt | null = null;
  private closing: OwnedRoom | null = null;
  private live: LiveRoom | null = null;
  private controller: AbortController | null = null;
  private stopping: Promise<void> | null = null;
  private epoch = 0;
  private readonly json: typeof mobileJson;
  private readonly retryDelay: number;
  private readonly now: () => number;
  constructor(private authority: MobileRoomAuthority, private publish: (status: MobileRoomStatus) => void,
    private discovery: () => boolean, private persist: () => Promise<void> = async () => {}, options: Options = {}) {
    this.json = options.json ?? mobileJson; this.retryDelay = options.retryDelayMs ?? 2000; this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.retryDelay) || this.retryDelay < 0 || this.retryDelay > 15_000) throw new Error('Invalid room reconnect delay.');
  }
  private notify(status: MobileRoomStatus): void { try { this.publish(status); } catch { /* UI disposal cannot alter room ownership. */ } }
  private pendingStatus(): Pick<MobileRoomStatus, 'pending' | 'pendingAction'> {
    return this.closing || this.opening?.cancelled ? { pending: true, pendingAction: 'close' } : this.opening?.sent ? { pending: true, pendingAction: 'open' } : { pending: false };
  }
  private current(controller: AbortController, epoch: number): boolean { return this.controller === controller && !controller.signal.aborted && this.epoch === epoch; }
  private parseRoom(value: unknown, slug: string): Room {
    if (!record(value) || typeof value.roomId !== 'string' || !UUID.test(value.roomId) || typeof value.generation !== 'string' || !UUID.test(value.generation) ||
      value.slug !== slug || value.publicUrl !== `${MOBILE_ORIGIN}/${slug}` || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= this.now())
      throw new InvalidRoomResponse('Invalid room response.');
    return { roomId: value.roomId, generation: value.generation, slug, publicUrl: value.publicUrl as string, expiresAt: value.expiresAt as number };
  }
  async start(slug: string): Promise<void> {
    if (this.stopping || this.controller || this.live) throw new Error('End the current room before opening another.');
    if (validateSessionSlug(slug)) throw new Error('Choose a valid room address.');
    if (this.closing || this.opening?.cancelled) throw new Error('Retry closing the pending room before opening another.');
    if (this.opening && this.opening.slug !== slug) throw new Error('Retry the previous room address or close its pending attempt first.');
    const attempt = this.opening ?? { slug, openId: crypto.randomUUID(), token: '', accessUntil: 0, sent: false, cancelled: false };
    this.opening = attempt;
    const controller = new AbortController(), epoch = ++this.epoch; this.controller = controller;
    this.authority.reset();
    this.notify({ state: 'starting', link: '', message: attempt.sent ? 'Checking the previous room opening…' : 'Opening room…', ...this.pendingStatus() });
    try {
      if (!attempt.token) {
        const access = await this.json('/v1/mobile/hosts', {}, { signal: controller.signal });
        if (!this.current(controller, epoch)) return;
        if (!record(access) || typeof access.token !== 'string' || !SECRET.test(access.token) || !Number.isSafeInteger(access.expiresAt) || (access.expiresAt as number) <= this.now())
          throw new InvalidRoomResponse('Invalid room access.');
        attempt.token = access.token; attempt.accessUntil = access.expiresAt as number;
      }
      if (attempt.accessUntil <= this.now()) throw new MobileHttpError(401, 'mobile-access-expired');
      if (!this.current(controller, epoch)) return;
      // The same owner and openId must recover an unknown result. A fresh owner
      // could only see a conflicting reservation, never the room it just opened.
      attempt.sent = true;
      const value = await this.json('/v1/relay/host/open', { slug, openId: attempt.openId }, { token: attempt.token, signal: controller.signal, discovery: this.discovery() });
      const owned = { room: this.parseRoom(value, slug), token: attempt.token }; attempt.owned = owned;
      if (!this.current(controller, epoch)) { await this.closeLate(attempt, owned); return; }
      this.opening = null;
      const live: LiveRoom = { ...owned, controller, epoch }; this.live = live;
      this.notify({ state: 'online', link: live.room.publicUrl, message: 'Room open. Keep this app in the foreground.', pending: false });
      void this.poll(live);
    } catch (error) {
      if (!this.current(controller, epoch)) return;
      this.controller = null; controller.abort();
      if (!attempt.sent || terminal(error)) this.opening = null;
      const pending = this.pendingStatus();
      const message = pending.pending ? 'Room opening was not confirmed. Retry the same address or close the pending room.' :
        error instanceof MobileHttpError && error.status === 409 ? 'That room address is already in use. Choose another address.' :
          error instanceof MobileHttpError && [401, 403, 410].includes(error.status) ? 'Room access expired. Open a new room.' : 'Could not open this room. Try again.';
      this.notify({ state: 'failed', link: '', message, ...pending });
      throw new Error(message);
    }
  }
  private calls(value: unknown, room: Room): InternetGuestCall[] {
    if (!record(value) || Object.keys(value).sort().join(',') !== 'generation,requests,roomId' || value.roomId !== room.roomId || value.generation !== room.generation ||
      !Array.isArray(value.requests) || value.requests.length > 8) throw new InvalidRoomResponse('Invalid room response.');
    const seen = new Set<string>();
    for (const call of value.requests) {
      if (!record(call) || Object.keys(call).some(key => !['requestId', 'operation', 'payload', 'session'].includes(key)) ||
        typeof call.requestId !== 'string' || !UUID.test(call.requestId) || seen.has(call.requestId) || typeof call.operation !== 'string' || !OPERATIONS.has(call.operation) ||
        !record(call.payload) || new TextEncoder().encode(JSON.stringify(call.payload)).length > (call.operation === 'photo' ? MAX_PHOTO_BODY_BYTES : 8192) || call.session !== undefined && (typeof call.session !== 'string' || !SECRET.test(call.session)))
        throw new InvalidRoomResponse('Invalid room response.');
      seen.add(call.requestId);
    }
    return value.requests as InternetGuestCall[];
  }
  private async poll(live: LiveRoom): Promise<void> {
    const { room, token, controller, epoch } = live, identity = { roomId: room.roomId, generation: room.generation };
    let replies: InternetGuestReply[] | null = null;
    while (this.current(controller, epoch) && room.expiresAt > this.now()) {
      try {
        if (replies) {
          try { await this.json('/v1/relay/host/reply', { ...identity, responses: replies }, { token, signal: controller.signal }); }
          catch (error) {
            // This envelope was already executed and persisted. The singer can
            // recover its command outcome; replaying the mutation would be wrong.
            if (!(error instanceof MobileHttpError && error.status === 409 && error.code === 'reply-not-pending')) throw error;
          }
          replies = null;
        }
        if (!this.current(controller, epoch)) return;
        const value = await this.json('/v1/relay/host/poll', identity, { token, signal: controller.signal, discovery: this.discovery() });
        if (!this.current(controller, epoch)) return;
        const calls = this.calls(value, room);
        const batch = await Promise.all(calls.map(call => call.operation === 'applause' ? this.authority.dispatchApplause(call) :
          call.operation === 'photo' ? this.authority.dispatchPhoto(call) : this.authority.dispatch(call)));
        if (calls.some(call => MUTATIONS.has(call.operation))) {
          try { await this.persist(); }
          catch {
            if (this.current(controller, epoch)) {
              await this.stop().catch(() => {});
              this.notify({ state: 'failed', link: '', message: 'Room disconnected because show changes could not be saved. Check device storage before reopening.', ...this.pendingStatus() });
            }
            return;
          }
        }
        if (!this.current(controller, epoch)) return;
        replies = batch.length ? batch : null;
        this.notify({ state: 'online', link: room.publicUrl, message: 'Room open. Keep this app in the foreground.', pending: false });
      } catch (error) {
        if (!this.current(controller, epoch)) return;
        if (terminal(error) || error instanceof InvalidRoomResponse) {
          await this.stop().catch(() => {});
          this.notify({ state: 'failed', link: '', message: 'This room ended or its access changed. Open a new room to invite singers again.', ...this.pendingStatus() }); return;
        }
        this.notify({ state: 'reconnecting', link: room.publicUrl, message: 'Reconnecting room. Playback stays on this device.', pending: false });
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, this.retryDelay); controller.signal.addEventListener('abort', done, { once: true });
          if (controller.signal.aborted) done();
        });
      }
    }
    if (this.current(controller, epoch)) {
      await this.stop().catch(() => {});
      this.notify({ state: 'failed', link: '', message: 'This room expired. Open a new room to continue accepting requests.', ...this.pendingStatus() });
    }
  }
  /** Returns false if access was revoked: the device is detached, without claiming a confirmed close. */
  private async closeOwned(owned: OwnedRoom): Promise<boolean> {
    if (owned.room.expiresAt <= this.now()) return true;
    try { await this.json('/v1/relay/host/close', { roomId: owned.room.roomId, generation: owned.room.generation }, { token: owned.token, signal: AbortSignal.timeout(5000) }); return true; }
    catch (error) {
      if (error instanceof MobileHttpError && [404, 410].includes(error.status)) return true;
      if (error instanceof MobileHttpError && [401, 403].includes(error.status)) return false;
      throw error;
    }
  }
  private async closeLate(attempt: OpenAttempt, owned: OwnedRoom): Promise<void> {
    try {
      const confirmed = await this.closeOwned(owned);
      const ownsPending = this.opening === attempt || this.closing?.room.roomId === owned.room.roomId && this.closing.room.generation === owned.room.generation;
      if (this.opening === attempt) this.opening = null;
      if (this.closing?.room.roomId === owned.room.roomId && this.closing.room.generation === owned.room.generation) this.closing = null;
      if (ownsPending && !this.live && !this.controller && !this.stopping && !this.opening && !this.closing) this.notify({ state: confirmed ? 'stopped' : 'failed', link: '', pending: false,
        message: confirmed ? 'Room closed.' : 'Room access expired. This device has disconnected.' });
    } catch { /* A cancelled attempt stays recoverable; it never replaces a newer live room. */ }
  }
  async stop(): Promise<void> {
    if (this.stopping) return await this.stopping;
    const active = this.live, attempt = this.opening;
    this.epoch++; this.controller?.abort(); this.controller = null; this.live = null; this.authority.reset();
    if (attempt) attempt.cancelled = true;
    if (active) this.closing = { room: active.room, token: active.token };
    if (!this.closing && !attempt?.sent) { this.opening = null; this.notify({ state: 'stopped', link: '', message: 'Room closed.', pending: false }); return; }
    this.notify({ state: 'reconnecting', link: '', message: 'Closing room…', pending: true, pendingAction: 'close' });
    const work = (async () => {
      try {
        if (!this.closing && attempt?.sent) {
          if (attempt.owned) this.closing = attempt.owned;
          else {
            // Recover the same open before closing. This may briefly establish an
            // unpolled lease, but cannot silently switch its owner or generation.
            try {
              const value = await this.json('/v1/relay/host/open', { slug: attempt.slug, openId: attempt.openId }, { token: attempt.token, signal: AbortSignal.timeout(5000), discovery: false });
              this.closing = { room: this.parseRoom(value, attempt.slug), token: attempt.token };
            } catch (error) {
              if (!(error instanceof MobileHttpError && [401, 403, 404, 410].includes(error.status))) throw error;
              this.opening = null;
              this.notify({ state: error.status === 401 || error.status === 403 ? 'failed' : 'stopped', link: '', pending: false,
                message: error.status === 401 || error.status === 403 ? 'Room access expired. This device has disconnected.' : 'Room closed.' }); return;
            }
          }
        }
        const confirmed = this.closing ? await this.closeOwned(this.closing) : true;
        this.closing = null; this.opening = null;
        this.notify({ state: confirmed ? 'stopped' : 'failed', link: '', pending: false, message: confirmed ? 'Room closed.' : 'Room access expired. This device has disconnected.' });
      } catch {
        this.notify({ state: 'failed', link: '', message: 'Could not confirm room closure. Retry closing the pending room.', pending: true, pendingAction: 'close' });
        throw new Error('Could not confirm room closure. Retry closing the pending room.');
      }
    })();
    this.stopping = work;
    try { await work; } finally { if (this.stopping === work) this.stopping = null; }
  }
}

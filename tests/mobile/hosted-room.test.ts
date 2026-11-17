import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileHostedRoom, type MobileRoomStatus } from '../../src/mobile/hosted-room';
import { MobileHttpError, type mobileJson } from '../../src/mobile/api';
import { MobileShow } from '../../src/mobile/show';
import { MobileRoomAuthority, mobileSecret } from '../../src/mobile/room-authority';
import type { InternetGuestCall } from '../../src/main/internet-queue-client';

type Room = { roomId: string; generation: string; slug: string; publicUrl: string; expiresAt: number };
const pause = (ms = 2) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) { const end = Date.now() + 2500; while (!check()) { if (Date.now() >= end) throw new Error('Mobile room test timed out.'); await pause(); } }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

/** Simulates idempotent leases, lost responses and cancellable long polls in memory. */
class Relay {
  accesses = 0; polls = 0;
  opens: { slug: string; openId: string; token: string }[] = [];
  closes: { roomId: string; generation: string; token: string }[] = [];
  replies: { responses: { requestId: string; status: number; body: unknown }[] }[] = [];
  private rooms = new Map<string, { room: Room; token: string; closed: boolean }>();
  private pending: { room: Room; resolve(value: unknown): void; reject(error: unknown): void } | null = null;
  afterOpen?: (room: Room, ordinal: number) => Promise<unknown>;
  replyError?: () => Error | undefined;
  closeError?: () => Error | undefined;
  readonly json: typeof mobileJson = async (path, value, options = {}) => {
    const body = value as Record<string, unknown>, token = options.token ?? '';
    if (path === '/v1/mobile/hosts') { this.accesses++; return { token: mobileSecret(), expiresAt: Date.now() + 60_000 }; }
    if (path.endsWith('/open')) {
      const input = body as { slug: string; openId: string };
      this.opens.push({ ...input, token });
      let existing = this.rooms.get(input.openId);
      if (existing && (existing.closed || existing.token !== token || existing.room.slug !== input.slug)) throw new MobileHttpError(410, 'room-ended');
      if (!existing) {
        if ([...this.rooms.values()].some(item => item.room.slug === input.slug && !item.closed)) throw new MobileHttpError(409, 'slug-unavailable');
        existing = { token, closed: false, room: { roomId: crypto.randomUUID(), generation: crypto.randomUUID(), slug: input.slug,
          publicUrl: `https://queue.thepropervolume.com/${input.slug}`, expiresAt: Date.now() + 60_000 } };
        this.rooms.set(input.openId, existing);
      }
      return this.afterOpen ? await this.afterOpen(existing.room, this.opens.length) : existing.room;
    }
    const owned = [...this.rooms.values()].find(item => item.room.roomId === body.roomId && item.room.generation === body.generation);
    if (!owned || owned.token !== token) throw new MobileHttpError(403, 'owner-forbidden');
    if (path.endsWith('/close')) {
      this.closes.push({ roomId: owned.room.roomId, generation: owned.room.generation, token });
      const failure = this.closeError?.(); if (failure) throw failure;
      if (owned.closed) throw new MobileHttpError(410, 'room-ended');
      owned.closed = true; return { ok: true };
    }
    if (owned.closed) throw new MobileHttpError(410, 'room-ended');
    if (path.endsWith('/reply')) { this.replies.push(body as typeof this.replies[number]); const failure = this.replyError?.(); if (failure) throw failure; return { ok: true }; }
    if (path.endsWith('/poll')) {
      this.polls++;
      return await new Promise((resolve, reject) => {
        assert.equal(this.pending, null, 'there must be only one live poll');
        const pending = { room: owned.room, resolve: (value: unknown) => { cleanup(); resolve(value); }, reject: (error: unknown) => { cleanup(); reject(error); } };
        const aborted = () => pending.reject(new Error('Cancelled'));
        const cleanup = () => { if (this.pending === pending) this.pending = null; options.signal?.removeEventListener('abort', aborted); };
        this.pending = pending; options.signal?.addEventListener('abort', aborted, { once: true });
        if (options.signal?.aborted) aborted();
      });
    }
    throw new Error('Unexpected test route.');
  };
  deliver(requests: InternetGuestCall[]) {
    assert.ok(this.pending, 'host must have an outstanding poll');
    const { room } = this.pending; this.pending.resolve({ roomId: room.roomId, generation: room.generation, requests });
  }
  failPoll(error: Error) { assert.ok(this.pending); this.pending.reject(error); }
  liveRooms(): number { return [...this.rooms.values()].filter(room => !room.closed).length; }
  openedRoom(openId: string): Room { const owned = this.rooms.get(openId); assert.ok(owned); return owned.room; }
}
function fixture(persist: () => Promise<void> = async () => {}) {
  const relay = new Relay(), show = new MobileShow();
  show.add([{ id: 'youtube_Video123456', provider: 'karaokenerds', videoId: 'Video123456', artist: 'Oasis', title: 'Wonderwall' }]);
  const authority = new MobileRoomAuthority(show), statuses: MobileRoomStatus[] = [];
  const host = new MobileHostedRoom(authority, status => statuses.push(status), () => true, persist, { json: relay.json, retryDelayMs: 1 });
  const call = (operation: string, payload: unknown, session?: string): InternetGuestCall => ({ requestId: crypto.randomUUID(), operation, payload, ...(session ? { session } : {}) });
  const join = () => {
    const resumeSecret = mobileSecret();
    const value = authority.dispatch(call('join', { joinId: mobileSecret(), resumeSecret, name: 'Alice', expectedRevision: show.revision }));
    assert.equal(value.status, 200);
    const { session, singerId } = value.body as { session: string; singerId: string };
    return { session, singerId, resumeSecret };
  };
  const request = (session: string) => {
    const admission = authority.dispatch(call('admission', {})).body as { showId: string; hostEpoch: string; revision: number };
    const command = { commandId: mobileSecret(), showId: admission.showId, hostEpoch: admission.hostEpoch, expectedRevision: admission.revision, versionId: 'youtube_Video123456' };
    return { command, rpc: call('request', { command }, session) };
  };
  return { relay, show, authority, host, statuses, join, request, call, latest: () => statuses.at(-1)! };
}

test('unknown open retries preserve the owner and openId and cannot silently switch room addresses', async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {}));
  f.relay.afterOpen = async (room, ordinal) => { if (ordinal === 1) throw new Error('Lost response after commit'); return room; };
  await assert.rejects(() => f.host.start('audit-room'), /not confirmed/);
  assert.equal(f.latest().pendingAction, 'open'); assert.equal(f.relay.liveRooms(), 1);
  await assert.rejects(() => f.host.start('different-room'), /previous room/);
  await f.host.start('audit-room');
  assert.equal(f.relay.accesses, 1); assert.deepEqual(f.relay.opens[0], f.relay.opens[1]);
  assert.equal(f.latest().state, 'online'); assert.equal(f.latest().pending, false);
});

test('closing an unknown open recovers its identity before closing, and failed closes remain explicit and retryable', async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {}));
  f.relay.afterOpen = async (room, ordinal) => { if (ordinal === 1) throw new Error('Lost'); return room; };
  await assert.rejects(() => f.host.start('audit-room'));
  let failures = 0; f.relay.closeError = () => failures++ === 0 ? new Error('Offline') : undefined;
  await assert.rejects(() => f.host.stop(), /Retry closing/);
  assert.equal(f.latest().pendingAction, 'close'); assert.equal(f.relay.liveRooms(), 1);
  await assert.rejects(() => f.host.start('another-room'), /Retry closing/);
  await f.host.stop();
  assert.equal(f.relay.liveRooms(), 0); assert.equal(f.latest().state, 'stopped'); assert.equal(f.relay.accesses, 1);
});

test('a cancelled late open is closed with its original capability without replacing a newer room', async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {})); const late = deferred<unknown>();
  f.relay.afterOpen = async (room, ordinal) => ordinal === 1 ? await late.promise : room;
  const opening = f.host.start('late-room'); await until(() => f.relay.opens.length === 1);
  const oldOpen = f.relay.opens[0]; await f.host.stop();
  assert.equal(f.relay.liveRooms(), 0);
  await f.host.start('new-room');
  late.resolve(f.relay.openedRoom(oldOpen.openId)); await opening;
  assert.equal(f.relay.liveRooms(), 1); assert.equal(f.latest().link, 'https://queue.thepropervolume.com/new-room');
  assert.equal(f.relay.closes[0].token, oldOpen.token); assert.equal(f.latest().state, 'online');
});

test('an old late-open cleanup cannot hide a newer uncertain open status', async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {})); const late = deferred<unknown>();
  f.relay.afterOpen = async (room, ordinal) => { if (ordinal === 1) return await late.promise; if (ordinal === 3) throw new Error('New open response lost'); return room; };
  const opening = f.host.start('late-room'); await until(() => f.relay.opens.length === 1);
  const first = f.relay.opens[0]; await f.host.stop();
  await assert.rejects(() => f.host.start('new-room'), /not confirmed/);
  late.resolve(f.relay.openedRoom(first.openId)); await opening;
  assert.equal(f.latest().state, 'failed'); assert.equal(f.latest().pendingAction, 'open');
  assert.equal(f.relay.liveRooms(), 1);
});

test('room closure and the next generation invalidate singer sessions/resume secrets while preserving host requests', async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {})); await f.host.start('first-room');
  const guest = f.join(), request = f.request(guest.session);
  const oldEpoch = (f.authority.dispatch(f.call('admission', {})).body as { hostEpoch: string }).hostEpoch;
  assert.equal((f.authority.dispatch(request.rpc).body as { ok: boolean }).ok, true);
  await f.host.stop();
  assert.equal(f.authority.dispatch(f.call('snapshot', {}, guest.session)).status, 400);
  await f.host.start('second-room');
  assert.equal(f.authority.dispatch(f.call('resume', { resumeSecret: guest.resumeSecret })).status, 400);
  const newEpoch = (f.authority.dispatch(f.call('admission', {})).body as { hostEpoch: string }).hostEpoch;
  assert.notEqual(newEpoch, oldEpoch); assert.equal(f.show.state().queue.length, 1);
});

test('expired RPC reply receipts resume polling without replaying the persisted mutation', async t => {
  let persisted = 0; const f = fixture(async () => { persisted++; }); t.after(() => f.host.stop().catch(() => {}));
  await f.host.start('audit-room'); const guest = f.join(), { command, rpc } = f.request(guest.session);
  let failures = 0; f.relay.replyError = () => failures++ === 0 ? new MobileHttpError(409, 'reply-not-pending') : undefined;
  f.relay.deliver([rpc]); await until(() => f.relay.polls === 2);
  assert.equal(f.show.state().queue.length, 1); assert.equal(persisted, 1);
  f.relay.deliver([f.call('outcome', { commandId: command.commandId }, guest.session)]);
  await until(() => f.relay.replies.length === 2);
  assert.equal((f.relay.replies[1].responses[0].body as { ok: boolean }).ok, true); assert.equal(f.show.state().queue.length, 1);
});

for (const status of [401, 403, 404, 410]) test(`terminal ${status} stops host polling and revokes singer access`, async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {})); await f.host.start('audit-room'); const guest = f.join();
  f.relay.failPoll(new MobileHttpError(status, 'room-ended'));
  await until(() => f.latest().state === 'failed'); await pause(15);
  assert.equal(f.relay.polls, 1); assert.equal(f.relay.liveRooms(), 0); assert.equal(f.latest().pending, false);
  assert.equal(f.authority.dispatch(f.call('snapshot', {}, guest.session)).status, 400);
});

test('remote success is sent only after the storage barrier commits', async t => {
  const storage = deferred<void>(); let saving = false; const f = fixture(async () => { saving = true; await storage.promise; });
  t.after(() => f.host.stop().catch(() => {})); await f.host.start('audit-room'); const guest = f.join();
  f.relay.deliver([f.request(guest.session).rpc]); await until(() => saving);
  assert.equal(f.show.state().queue.length, 1); assert.equal(f.relay.replies.length, 0);
  storage.resolve(); await until(() => f.relay.replies.length === 1);
  assert.equal((f.relay.replies[0].responses[0].body as { ok: boolean }).ok, true);
});

test('failed persistence disconnects the room without acknowledging a volatile mutation', async t => {
  const f = fixture(async () => { throw new Error('Storage full'); }); t.after(() => f.host.stop().catch(() => {}));
  await f.host.start('audit-room'); const guest = f.join(); f.relay.deliver([f.request(guest.session).rpc]);
  await until(() => f.latest().state === 'failed');
  assert.equal(f.relay.replies.length, 0); assert.equal(f.relay.liveRooms(), 0); assert.match(f.latest().message, /could not be saved/);
  assert.equal(f.authority.dispatch(f.call('snapshot', {}, guest.session)).status, 400);
});

test('a transient poll outage reconnects the same room and owner', async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {})); await f.host.start('audit-room');
  f.relay.failPoll(new Error('Temporarily offline')); await until(() => f.relay.polls === 2);
  f.relay.deliver([]); await until(() => f.latest().state === 'online');
  assert.equal(f.relay.accesses, 1); assert.equal(f.relay.opens.length, 1); assert.equal(f.relay.liveRooms(), 1);
});

test('a malformed operation ends the room instead of dispatching host controls', async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {})); await f.host.start('audit-room');
  f.relay.deliver([f.call('play', {})]); await until(() => f.latest().state === 'failed');
  assert.equal(f.relay.replies.length, 0); assert.equal(f.relay.liveRooms(), 0);
});

test('a conflicting reply ends the room instead of retrying a terminal conflict forever', async t => {
  const f = fixture(); t.after(() => f.host.stop().catch(() => {})); await f.host.start('audit-room');
  f.relay.replyError = () => new MobileHttpError(409, 'reply-conflict');
  f.relay.deliver([f.call('admission', {})]); await until(() => f.latest().state === 'failed');
  assert.equal(f.relay.replies.length, 1); assert.equal(f.relay.polls, 1); assert.equal(f.relay.liveRooms(), 0);
});

test('a storage commit completing after Stop cannot acknowledge the old generation', async t => {
  const storage = deferred<void>(); let saving = false;
  const f = fixture(async () => { saving = true; await storage.promise; }); t.after(() => f.host.stop().catch(() => {}));
  await f.host.start('audit-room'); const guest = f.join(); f.relay.deliver([f.request(guest.session).rpc]);
  await until(() => saving); await f.host.stop();
  await f.host.start('next-room'); storage.resolve(); await pause(15);
  assert.equal(f.relay.replies.length, 0); assert.equal(f.latest().link, 'https://queue.thepropervolume.com/next-room'); assert.equal(f.relay.liveRooms(), 1);
});

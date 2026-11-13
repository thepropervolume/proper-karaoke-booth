import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { RelayBroker } from '../../src/relay/broker';
import { RelayError, RelayStore, type HostOpenResult, type RelayStoreApi, type RoomLease } from '../../src/relay/store';

const code = (status: number, reason?: string) => (error: unknown) => error instanceof RelayError && error.status === status && (!reason || error.code === reason);
const admission = { operation: 'admission' as const, payload: {} };
const body = { showId: 'show-demo-id', hostEpoch: 'host-demo-epoch', revision: 1 };
class Clock {
  now = 1000; next = 0; timers = new Map<number, { at: number; run: () => void }>();
  set = (run: () => void, delay: number): number => { const id = ++this.next; this.timers.set(id, { at: this.now + delay, run }); return id; };
  clear = (id: unknown): void => { this.timers.delete(id as number); };
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.timers].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.now = due[1].at; this.timers.delete(due[0]); due[1].run();
    }
    this.now = until;
  }
}
async function fixture(run: (broker: RelayBroker, store: RelayStore, clock: Clock, owner: string, room: HostOpenResult, db: DatabaseSync) => Promise<void>, leaseMs?: number): Promise<void> {
  const db = new DatabaseSync(':memory:'), clock = new Clock(), owner = randomUUID();
  const store = new RelayStore(db, { now: () => clock.now, leaseMs });
  const broker = new RelayBroker(store, { setTimer: clock.set, clearTimer: clock.clear });
  const room = await broker.open(owner, { slug: 'my-party', openId: randomUUID() });
  try { await run(broker, store, clock, owner, room, db); }
  finally { await broker.stop(); assert.equal(clock.timers.size, 0); db.close(); }
}
async function online(broker: RelayBroker, clock: Clock, owner: string, room: HostOpenResult): Promise<void> {
  const poll = broker.poll(owner, room); await flush(); clock.advance(20_000); assert.deepEqual(await poll, { requests: [] });
}

test('heartbeat establishes online state and host disconnect becomes offline after forty-five seconds', () => fixture(async (broker, _store, clock, owner, room) => {
  assert.equal((await broker.lookup(room.slug))?.online, false);
  await assert.rejects(broker.invoke(room, admission), code(503, 'host-offline'));
  await online(broker, clock, owner, room); assert.equal((await broker.lookup(room.slug))?.online, true);
  clock.advance(45_001); assert.equal((await broker.lookup(room.slug))?.online, false);
  await assert.rejects(broker.invoke(room, admission), code(503, 'host-offline'));
}));

test('one pending host poll, abort cleanup and immediate guest dispatch are isolated', () => fixture(async (broker, _store, clock, owner, room) => {
  const controller = new AbortController(), waiting = broker.poll(owner, room, controller.signal);
  const cancelled = assert.rejects(waiting, code(503, 'poll-cancelled'));
  await assert.rejects(broker.poll(owner, room), code(409, 'poll-already-pending'));
  controller.abort(); await cancelled;
  const poll = broker.poll(owner, room), response = broker.invoke(room, admission);
  const delivery = await poll; assert.equal(delivery.requests.length, 1);
  const request = delivery.requests[0]; assert.equal(request.operation, 'admission');
  await broker.reply(owner, { ...roomIdentity(room), responses: [{ requestId: request.requestId, status: 200, body: { ...body, privatePath: '/never-forward' } }] });
  assert.deepEqual(await response, { status: 200, body });
  assert.ok(clock.timers.size >= 1);
}));

const roomIdentity = (room: HostOpenResult) => ({ roomId: room.roomId, generation: room.generation });
async function flush(): Promise<void> { for (let index = 0; index < 4; index++) await Promise.resolve(); }

test('FIFO delivery is at most eight per poll and delivered requests are never redelivered', () => fixture(async (broker, _store, clock, owner, room) => {
  await online(broker, clock, owner, room);
  const pending = Array.from({ length: 16 }, () => broker.invoke(room, admission));
  const settled = Promise.allSettled(pending);
  const first = await broker.poll(owner, room), second = await broker.poll(owner, room);
  assert.equal(first.requests.length, 8); assert.equal(second.requests.length, 8);
  assert.equal(new Set([...first.requests, ...second.requests].map(request => request.requestId)).size, 16);
  await assert.rejects(broker.invoke(room, admission), code(503, 'request-capacity'));
  const next = broker.poll(owner, room);
  await flush(); clock.advance(15_000);
  const outcomes = await settled; assert.ok(outcomes.every(result => result.status === 'rejected' && code(503, 'request-uncertain')(result.reason)));
  clock.advance(5_000); assert.deepEqual(await next, { requests: [] });
  assert.deepEqual(await broker.reply(owner, { ...roomIdentity(room), responses: [{ requestId: first.requests[0].requestId, status: 200, body }] }), { ok: true });
}));

test('whole reply batches validate before any guest resolves; projected retry receipts are idempotent', () => fixture(async (broker, _store, clock, owner, room) => {
  await online(broker, clock, owner, room);
  const one = broker.invoke(room, admission), two = broker.invoke(room, admission);
  let resolved = false; void one.then(() => { resolved = true; }, () => {}); void two.catch(() => {});
  const delivered = await broker.poll(owner, room);
  const responses = delivered.requests.map(request => ({ requestId: request.requestId, status: 200 as const, body: { ...body } }));
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [responses[0], { ...responses[1], body: { invalid: true } }] }), code(400));
  await Promise.resolve(); assert.equal(resolved, false);
  await assert.rejects(broker.reply(randomUUID(), { ...roomIdentity(room), responses }), code(403));
  assert.deepEqual(await broker.reply(owner, { ...roomIdentity(room), responses }), { ok: true });
  assert.deepEqual(await one, { status: 200, body }); await two;
  assert.deepEqual(await broker.reply(owner, { ...roomIdentity(room), responses: responses.map(reply => ({ ...reply, body: { ...body, ignoredExtra: 'safe' } })) }), { ok: true });
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [{ ...responses[0], body: { ...body, revision: 2 } }] }), code(409, 'reply-conflict'));
  clock.advance(60_000);
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [responses[0]] }), code(409));
}));

test('unknown and duplicate reply IDs cannot consume valid pending work', () => fixture(async (broker, _store, clock, owner, room) => {
  await online(broker, clock, owner, room);
  const pending = broker.invoke(room, admission);
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [{ requestId: randomUUID(), status: 200, body }] }), code(409));
  const delivery = await broker.poll(owner, room), reply = { requestId: delivery.requests[0].requestId, status: 200, body };
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [reply, reply] }), code(400));
  await broker.reply(owner, { ...roomIdentity(room), responses: [reply] }); assert.deepEqual(await pending, { status: 200, body });
}));

test('another owner or room cannot settle a delivered guest request', () => fixture(async (broker, _store, clock, owner, room) => {
  await online(broker, clock, owner, room);
  const otherOwner = randomUUID(), other = await broker.open(otherOwner, { slug: 'other-party', openId: randomUUID() });
  await online(broker, clock, otherOwner, other);
  const pending = broker.invoke(room, admission), delivery = await broker.poll(owner, room);
  const response = { requestId: delivery.requests[0].requestId, status: 200, body };
  await assert.rejects(broker.reply(otherOwner, { ...roomIdentity(room), responses: [response] }), code(403));
  await assert.rejects(broker.reply(otherOwner, { ...roomIdentity(other), responses: [response] }), code(409));
  await broker.reply(owner, { ...roomIdentity(room), responses: [response] });
  assert.deepEqual(await pending, { status: 200, body });
}));

test('guest abort removes queued work and a delivered cancellation cannot be retried by the relay', () => fixture(async (broker, _store, clock, owner, room) => {
  await online(broker, clock, owner, room);
  const cancelled = new AbortController(), queued = broker.invoke(room, admission, cancelled.signal);
  const caught = assert.rejects(queued, code(503, 'request-cancelled')); cancelled.abort(); await caught;
  const second = new AbortController(), pending = broker.invoke(room, admission, second.signal);
  const rejected = assert.rejects(pending, code(503, 'request-cancelled'));
  const delivery = await broker.poll(owner, room); assert.equal(delivery.requests.length, 1);
  second.abort(); await rejected;
  assert.deepEqual(await broker.reply(owner, { ...roomIdentity(room), responses: [{ requestId: delivery.requests[0].requestId, status: 200, body }] }), { ok: true });
  const poll = broker.poll(owner, room); await flush(); clock.advance(20_000); assert.deepEqual(await poll, { requests: [] });
}));

test('a delivered guest abort permits a late reply in the same validated batch as another active RPC', () => fixture(async (broker, _store, clock, owner, room) => {
  await online(broker, clock, owner, room);
  const controller = new AbortController();
  const cancelled = broker.invoke(room, admission, controller.signal), cancelledResult = assert.rejects(cancelled, code(503, 'request-cancelled'));
  const active = broker.invoke(room, admission); void active.catch(() => {});
  const delivery = await broker.poll(owner, room); assert.equal(delivery.requests.length, 2);
  controller.abort(); await cancelledResult;
  const responses = delivery.requests.map(request => ({ requestId: request.requestId, status: 200, body: { ...body } }));
  let resolved = false; void active.then(() => { resolved = true; }, () => {});
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [{ ...responses[0], body: { invalid: true } }, responses[1]] }), code(400));
  await Promise.resolve(); assert.equal(resolved, false);
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [responses[0], { ...responses[1], requestId: randomUUID() }] }), code(409));
  assert.equal(resolved, false);
  assert.deepEqual(await broker.reply(owner, { ...roomIdentity(room), responses }), { ok: true });
  assert.deepEqual(await active, { status: 200, body });
  assert.deepEqual(await broker.reply(owner, { ...roomIdentity(room), responses }), { ok: true });
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [{ ...responses[0], body: { ...body, revision: 2 } }] }), code(409, 'reply-conflict'));
  assert.equal((await broker.lookup(room.slug))?.online, true);
}));

test('delivered timeout tombstones acknowledge late replies without retaining or redelivering work', () => fixture(async (broker, _store, clock, owner, room) => {
  await online(broker, clock, owner, room);
  const pending = broker.invoke(room, admission), timedOut = assert.rejects(pending, code(503, 'request-uncertain'));
  const delivery = await broker.poll(owner, room);
  clock.advance(15_000); await timedOut;
  const reply = { ...roomIdentity(room), responses: [{ requestId: delivery.requests[0].requestId, status: 200, body }] };
  assert.deepEqual(await broker.reply(owner, reply), { ok: true });
  assert.deepEqual(await broker.reply(owner, reply), { ok: true });
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [{ requestId: randomUUID(), status: 200, body }] }), code(409));
  const poll = broker.poll(owner, room); await flush(); clock.advance(20_000); assert.deepEqual(await poll, { requests: [] });
  clock.advance(40_000);
  await assert.rejects(broker.reply(owner, reply), code(409));
}));

test('close and generation rotation synchronously fence old host polls, guest requests and late replies', () => fixture(async (broker, _store, clock, owner, room) => {
  await online(broker, clock, owner, room);
  const guest = broker.invoke(room, admission), ended = assert.rejects(guest, code(410));
  const delivered = await broker.poll(owner, room);
  const poll = broker.poll(owner, room), closedPoll = assert.rejects(poll, code(410));
  const next = await broker.open(owner, { slug: room.slug, openId: randomUUID() });
  await ended; await closedPoll;
  await assert.rejects(broker.reply(owner, { ...roomIdentity(room), responses: [{ requestId: delivered.requests[0].requestId, status: 200, body }] }), code(410));
  assert.equal((await broker.lookup(next.slug))?.online, false);
  await online(broker, clock, owner, next);
  const nextGuest = broker.invoke(next, admission), nextEnded = assert.rejects(nextGuest, code(410));
  await broker.close(owner, next); await nextEnded;
  assert.equal((await broker.lookup(next.slug))?.online, false);
  await assert.rejects(broker.invoke(next, admission), code(410));
}));

test('expiry settles pending work without another incoming request', () => fixture(async (broker, _store, clock, owner, room) => {
  const poll = broker.poll(owner, room);
  const guest = broker.invoke(room, admission), ended = assert.rejects(guest, code(410));
  // The poll was delivered, so install a fresh pending host poll too.
  await poll;
  const nextPoll = broker.poll(owner, room), nextEnded = assert.rejects(nextPoll, code(410));
  await flush(); clock.advance(100); await ended; await nextEnded;
  assert.equal(await broker.lookup(room.slug), null);
}, 100));

test('shutdown fences every pending promise and stores no guest payload or credential in SQLite', () => fixture(async (broker, _store, clock, owner, room, db) => {
  await online(broker, clock, owner, room);
  const secret = 'A'.repeat(43);
  const guest = broker.invoke(room, { operation: 'catalog', payload: { offset: 0, limit: 1 }, session: secret });
  const rejected = assert.rejects(guest, error => error instanceof RelayError);
  const tables = ['relay_leases', 'relay_opens'];
  const stored = JSON.stringify(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()));
  assert.equal(stored.includes(secret), false); assert.equal(stored.includes('offset'), false); assert.equal(stored.includes('payload'), false);
  const poll = broker.poll(owner, room); await poll;
  const nextPoll = broker.poll(owner, room), stopped = assert.rejects(nextPoll, error => error instanceof RelayError);
  await broker.stop(); await rejected; await stopped;
  await assert.rejects(broker.invoke(room, admission), code(503, 'relay-stopped'));
  await assert.rejects(broker.open(owner, { slug: 'another-party', openId: randomUUID() }), code(503));
}));

test('the global one-thousand outstanding limit is independent of each room limit and reclaims cancelled capacity', () => fixture(async (broker, _store, clock, firstOwner, firstRoom) => {
  const cancelled = new AbortController(), pending: Promise<unknown>[] = [];
  for (let roomIndex = 0; roomIndex < 63; roomIndex++) {
    const owner = roomIndex === 0 ? firstOwner : randomUUID();
    const room = roomIndex === 0 ? firstRoom : await broker.open(owner, { slug: `party-${roomIndex}`, openId: randomUUID() });
    const heartbeat = broker.poll(owner, room, cancelled.signal); void heartbeat.catch(() => {});
    for (let index = 0; index < (roomIndex === 62 ? 8 : 16); index++) {
      const invocation = broker.invoke(room, admission, cancelled.signal); void invocation.catch(() => {}); pending.push(invocation);
    }
    if (roomIndex === 62) await assert.rejects(broker.invoke(room, admission), code(503, 'request-capacity'));
  }
  assert.equal(pending.length, 1000); cancelled.abort(); await Promise.allSettled(pending);
  const recovered = broker.invoke(firstRoom, admission), deadline = assert.rejects(recovered, code(503, 'request-uncertain'));
  await flush(); clock.advance(15_000); await deadline;
}));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type AsyncHooks = { read?: (lease: RoomLease) => Promise<RoomLease>; close?: () => Promise<void>; deactivate?: () => Promise<void> };
async function asyncFixture(run: (broker: RelayBroker, store: RelayStore, hooks: AsyncHooks, clock: Clock, owner: string, room: HostOpenResult) => Promise<void>) {
  const db = new DatabaseSync(':memory:'), clock = new Clock(), owner = randomUUID(), hooks: AsyncHooks = {};
  const store = new RelayStore(db, { now: () => clock.now });
  const adapter: RelayStoreApi = {
    now: store.now, onFence: listener => store.onFence(listener), expire: async () => store.expire(),
    lookup: async slug => store.lookup(slug), open: async (id, input) => store.open(id, input),
    assertActive: async (id, identity) => {
      const lease = store.assertActive(id, identity), read = hooks.read; hooks.read = undefined;
      return read ? await read(lease) : lease;
    },
    close: async (id, identity) => { if (hooks.close) await hooks.close(); store.close(id, identity); },
    deactivateAll: async () => { if (hooks.deactivate) await hooks.deactivate(); store.deactivateAll(); },
  };
  const broker = new RelayBroker(adapter, { setTimer: clock.set, clearTimer: clock.clear });
  const room = await broker.open(owner, { slug: 'async-party', openId: randomUUID() });
  try { await run(broker, store, hooks, clock, owner, room); }
  finally { await broker.stop(); assert.equal(clock.timers.size, 0); db.close(); }
}
async function asyncOnline(broker: RelayBroker, clock: Clock, owner: string, room: HostOpenResult) {
  const poll = broker.poll(owner, room);
  await flush();
  clock.advance(20_000); await poll;
}

test('a stale asynchronous lease read cannot recreate the old generation after a committed rotation', () => asyncFixture(async (broker, _store, hooks, clock, owner, room) => {
  await asyncOnline(broker, clock, owner, room);
  const read = deferred<RoomLease>(), entered = deferred<void>();
  hooks.read = lease => { entered.resolve(); return read.promise.then(() => lease); };
  const invocation = broker.invoke(room, admission), rejected = assert.rejects(invocation, code(410));
  await entered.promise;
  const next = await broker.open(owner, { slug: room.slug, openId: randomUUID() });
  read.resolve({} as RoomLease); await rejected;
  assert.equal((await broker.lookup(next.slug))?.online, false);
  await assert.rejects(broker.poll(owner, room), code(410));
}));

test('close gates before awaiting the database and stays closed locally after a persistence failure', () => asyncFixture(async (broker, store, hooks, clock, owner, room) => {
  await asyncOnline(broker, clock, owner, room);
  const guest = broker.invoke(room, admission), ended = assert.rejects(guest, code(410));
  const delivered = await broker.poll(owner, room);
  const read = deferred<RoomLease>(), entered = deferred<void>(), closing = deferred<void>();
  hooks.read = lease => { entered.resolve(); return read.promise.then(() => lease); };
  const late = broker.reply(owner, { ...roomIdentity(room), responses: [{ requestId: delivered.requests[0].requestId, status: 200, body }] });
  const lateRejected = assert.rejects(late, code(410)); await entered.promise;
  hooks.close = () => closing.promise;
  const close = broker.close(owner, room), closeFailed = assert.rejects(close);
  read.resolve({} as RoomLease); await lateRejected; await ended;
  await assert.rejects(broker.invoke(room, admission), code(410));
  assert.equal((await broker.lookup(room.slug))?.online, false);
  closing.reject(new Error('synthetic persistence failure')); await closeFailed;
  assert.equal(store.assertActive(owner, room).active, true, 'the fixture database failed before its close commit');
  await assert.rejects(broker.poll(owner, room), code(410));
  hooks.close = undefined; await broker.close(owner, room);
}));

test('shutdown fences memory before an asynchronous database shutdown completes', () => asyncFixture(async (broker, _store, hooks, clock, owner, room) => {
  await asyncOnline(broker, clock, owner, room);
  const read = deferred<RoomLease>(), entered = deferred<void>(), closing = deferred<void>();
  hooks.read = lease => { entered.resolve(); return read.promise.then(() => lease); };
  const invocation = broker.invoke(room, admission), rejected = assert.rejects(invocation, code(503, 'relay-stopped'));
  await entered.promise; hooks.deactivate = () => closing.promise;
  const stop = broker.stop();
  assert.equal(clock.timers.size, 0);
  read.resolve({} as RoomLease); await rejected;
  await assert.rejects(broker.open(owner, { slug: 'new-party', openId: randomUUID() }), code(503));
  closing.resolve(); await stop;
}));

test('the complete poll and RPC deadlines include a delayed database gate and ignore its late completion', async () => {
  for (const kind of ['poll', 'invoke'] as const) await asyncFixture(async (broker, _store, hooks, clock, owner, room) => {
    await asyncOnline(broker, clock, owner, room);
    const read = deferred<RoomLease>(), entered = deferred<void>();
    hooks.read = lease => { entered.resolve(); return read.promise.then(() => lease); };
    const result = kind === 'poll' ? broker.poll(owner, room) : broker.invoke(room, admission);
    const failed = assert.rejects(result, code(503, kind === 'poll' ? 'poll-timeout' : 'request-uncertain'));
    await entered.promise; clock.advance(kind === 'poll' ? 20_000 : 15_000); await failed;
    assert.equal(clock.timers.size, 1, 'only the room lease timer remains');
    read.resolve({} as RoomLease); await flush();
    const poll = broker.poll(owner, room); await flush(); clock.advance(20_000);
    assert.deepEqual(await poll, { requests: [] }, 'the late read did not enqueue or dispatch timed-out work');
  });
});

test('aborting a database gate clears its deadline and observes late rejection without forwarding work', async () => {
  for (const kind of ['poll', 'invoke'] as const) await asyncFixture(async (broker, _store, hooks, clock, owner, room) => {
    await asyncOnline(broker, clock, owner, room);
    const read = deferred<RoomLease>(), entered = deferred<void>(), controller = new AbortController();
    hooks.read = () => { entered.resolve(); return read.promise; };
    const result = kind === 'poll' ? broker.poll(owner, room, controller.signal) : broker.invoke(room, admission, controller.signal);
    const failed = assert.rejects(result, code(503, kind === 'poll' ? 'poll-cancelled' : 'request-cancelled'));
    await entered.promise; controller.abort(); await failed;
    assert.equal(clock.timers.size, 1);
    read.reject(new Error('synthetic late database rejection')); await flush();
    const poll = broker.poll(owner, room); await flush(); clock.advance(20_000);
    assert.deepEqual(await poll, { requests: [] });
  });
});

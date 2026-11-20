/** Memory-only, at-most-once RPC forwarding. The host remains the show authority. */
import { createHash, randomUUID } from 'node:crypto';
import { parseGuestRequest, parseHostReplyEnvelope, projectGuestResponse, type GuestRequest, type GuestResponse,
  type RelayOperation, type RoomIdentity } from './protocol';
import { RelayError, type RelayStoreApi, type HostOpenResult, type RoomLease } from './store';
import type { HostOpen } from './protocol';

export type RpcEnvelope = { requestId: string; operation: RelayOperation; payload: GuestRequest['payload']; session?: string };
export type PublicRoom = RoomIdentity & { slug: string; expiresAt: number; online: boolean };
type Timer = unknown;
type Options = { now?: () => number; pollTimeoutMs?: number; rpcTimeoutMs?: number; offlineAfterMs?: number;
  setTimer?: (callback: () => void, delay: number) => Timer; clearTimer?: (timer: Timer) => void };
type Poll = { resolve: (value: { requests: RpcEnvelope[] }) => void; reject: (error: RelayError) => void; cleanup: () => void };
type Rpc = { envelope: RpcEnvelope; delivered: boolean; resolve: (reply: GuestResponse) => void; reject: (error: RelayError) => void; cleanup: () => void };
type Room = { lease: RoomLease; lastPoll: number | null; queue: string[]; pending: Map<string, Rpc>; poll?: Poll; expiry?: Timer };
type Receipt = { operation: RelayOperation; hash?: string; expiresAt: number };
type Gate = { identity: RoomIdentity; fail: (error: unknown) => void };

export class RelayBroker {
  private readonly rooms = new Map<string, Room>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly gates = new Set<Gate>();
  private readonly now: () => number;
  private readonly setTimer: NonNullable<Options['setTimer']>;
  private readonly clearTimer: NonNullable<Options['clearTimer']>;
  private readonly pollTimeout: number;
  private readonly rpcTimeout: number;
  private readonly offlineAfter: number;
  private readonly unsubscribe: () => void;
  private outstanding = 0;
  private stopped = false;
  private stopTask?: Promise<void>;
  private readonly blocked = new Map<string, number>();
  private blockedOverflowUntil = 0;

  constructor(private readonly store: RelayStoreApi, options: Options = {}) {
    this.now = options.now ?? store.now;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.pollTimeout = options.pollTimeoutMs ?? 20_000;
    this.rpcTimeout = options.rpcTimeoutMs ?? 15_000;
    this.offlineAfter = options.offlineAfterMs ?? 45_000;
    if ([this.pollTimeout, this.rpcTimeout, this.offlineAfter].some(value => !Number.isSafeInteger(value) || value < 1) ||
        this.pollTimeout > 20_000 || this.rpcTimeout > 15_000 || this.offlineAfter > 45_000)
      throw new RelayError(400, 'invalid-configuration');
    this.unsubscribe = store.onFence(identity => this.fence(identity, new RelayError(410, 'room-ended')));
  }
  private running(): void {
    if (this.stopped) throw new RelayError(503, 'relay-stopped');
    if (this.blockedOverflowUntil > this.now()) throw new RelayError(503, 'fence-capacity');
  }
  private key(identity: RoomIdentity): string { return `${identity.roomId}:${identity.generation}`; }
  private rememberFence(identity: RoomIdentity, expiresAt?: number): void {
    if (this.stopped) return;
    const now = this.now();
    for (const [key, expiry] of this.blocked) if (expiry <= now) this.blocked.delete(key);
    const key = this.key(identity), expiry = expiresAt ?? now + 12 * 60 * 60 * 1000;
    if (expiry <= now) return;
    if (!this.blocked.has(key) && this.blocked.size >= 8192) {
      // Never evict a live fence: a delayed database read could still return it.
      // Capacity exhaustion gates the broker until that unrecorded lease ends.
      this.blockedOverflowUntil = Math.max(this.blockedOverflowUntil, expiry); return;
    }
    this.blocked.set(key, Math.min(this.blocked.get(key) ?? expiry, expiry));
  }
  private lease(lease: RoomLease, expected?: RoomIdentity, ownerId?: string): RoomLease {
    this.running();
    if (ownerId !== undefined && lease.ownerId !== ownerId) throw new RelayError(403, 'owner-forbidden');
    if (expected && (lease.roomId !== expected.roomId || lease.generation !== expected.generation)) throw new RelayError(410, 'room-ended');
    if (!lease.active || lease.expiresAt <= this.now() || this.blocked.has(this.key(lease))) {
      this.fence(lease, new RelayError(410, 'room-ended'), lease.expiresAt);
      throw new RelayError(410, 'room-ended');
    }
    return lease;
  }
  private memory(lease: RoomLease): Room {
    this.lease(lease);
    let room = this.rooms.get(lease.roomId);
    if (!room) {
      room = { lease, lastPoll: null, queue: [], pending: new Map() };
      this.rooms.set(lease.roomId, room);
      this.armExpiry(room);
    }
    return room;
  }
  private armExpiry(room: Room): void {
    room.expiry = this.setTimer(() => { void this.expireRoom(room); }, Math.max(0, room.lease.expiresAt - this.now()));
  }
  private async expireRoom(room: Room): Promise<void> {
    try {
      await this.store.expire();
      if (this.stopped) return;
      if (!this.rooms.has(room.lease.roomId)) return;
      if (this.now() >= room.lease.expiresAt) this.fence(room.lease, new RelayError(410, 'room-ended'));
      else this.armExpiry(room);
    } catch {
      if (!this.stopped) this.fence(room.lease, new RelayError(503, 'relay-unavailable'));
    }
  }
  private fence(identity: RoomIdentity, error: RelayError, expiresAt?: number): void {
    const room = this.rooms.get(identity.roomId);
    this.rememberFence(identity, expiresAt ?? room?.lease.expiresAt);
    for (const gate of this.gates) if (this.key(gate.identity) === this.key(identity)) gate.fail(error);
    if (!room || room.lease.generation !== identity.generation) return;
    this.rooms.delete(identity.roomId);
    if (room.expiry !== undefined) this.clearTimer(room.expiry);
    const poll = room.poll; room.poll = undefined;
    if (poll) { poll.cleanup(); poll.reject(error); }
    for (const rpc of room.pending.values()) { rpc.cleanup(); this.outstanding--; rpc.reject(error); }
    room.pending.clear(); room.queue.length = 0;
    const prefix = `${identity.roomId}:`;
    for (const key of this.receipts.keys()) if (key.startsWith(prefix)) this.receipts.delete(key);
  }
  async open(ownerId: string, input: HostOpen): Promise<HostOpenResult> {
    this.running(); const result = await this.store.open(ownerId, input);
    this.running();
    if (this.blocked.has(this.key(result)) || result.expiresAt <= this.now()) throw new RelayError(410, 'room-ended');
    const lease = await this.store.assertActive(ownerId, result);
    this.memory(this.lease(lease, result, ownerId)); return result;
  }
  async close(ownerId: string, identity: RoomIdentity): Promise<{ ok: true }> {
    this.running();
    const known = identity && this.rooms.get(identity.roomId);
    if (known && known.lease.generation === identity.generation && known.lease.ownerId === ownerId)
      this.fence(identity, new RelayError(410, 'room-ended'), known.lease.expiresAt);
    else {
      const lease = await this.store.assertActive(ownerId, identity);
      this.running();
      if (lease.ownerId !== ownerId) throw new RelayError(403, 'owner-forbidden');
      if (lease.roomId !== identity.roomId || lease.generation !== identity.generation) throw new RelayError(410, 'room-ended');
      this.fence(identity, new RelayError(410, 'room-ended'), lease.expiresAt);
    }
    await this.store.close(ownerId, identity); this.running(); return { ok: true };
  }
  async lookup(slug: string): Promise<PublicRoom | null> {
    this.running(); const lease = await this.store.lookup(slug); this.running();
    if (!lease) return null;
    const room = this.rooms.get(lease.roomId);
    return { roomId: lease.roomId, generation: lease.generation, slug: lease.slug, expiresAt: lease.expiresAt,
      online: lease.active && lease.expiresAt > this.now() && !this.blocked.has(this.key(lease)) &&
        room?.lastPoll !== null && room?.lastPoll !== undefined && this.now() - room.lastPoll <= this.offlineAfter };
  }
  /** Screen publishers must own the current active lease, just like queue hosts. */
  async screenLease(ownerId: string, identity: RoomIdentity): Promise<RoomLease> {
    this.running();
    const lease = await this.store.assertActive(ownerId, identity);
    return this.lease(lease, identity, ownerId);
  }
  private dispatch(room: Room): void {
    if (this.stopped || this.blocked.has(this.key(room.lease)) || this.rooms.get(room.lease.roomId) !== room) return;
    if (!room.poll || !room.queue.length) return;
    const requests: RpcEnvelope[] = [];
    while (requests.length < 8 && room.queue.length) {
      const rpc = room.pending.get(room.queue.shift()!);
      if (!rpc) continue;
      rpc.delivered = true; requests.push(rpc.envelope);
    }
    if (!requests.length) return;
    const poll = room.poll; room.poll = undefined;
    poll.cleanup(); poll.resolve({ requests });
  }
  private gate<T>(identity: RoomIdentity, operation: () => T | Promise<T>, deadline: number, signal: AbortSignal | undefined,
    timeoutCode: string, cancelCode: string): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false, timer: Timer, gate: Gate;
      const cleanup = () => { this.clearTimer(timer); signal?.removeEventListener('abort', abort); this.gates.delete(gate); };
      const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
      const abort = () => fail(new RelayError(503, cancelCode));
      gate = { identity, fail }; this.gates.add(gate);
      if (signal?.aborted) { fail(new RelayError(503, cancelCode)); return; }
      const remaining = deadline - this.now();
      if (remaining <= 0) { fail(new RelayError(503, timeoutCode)); return; }
      timer = this.setTimer(() => fail(new RelayError(503, timeoutCode)), remaining);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        // Both late fulfillment and late rejection are observed, but neither can
        // resume the caller after the gate has timed out or been cancelled.
        Promise.resolve(operation()).then(value => {
          if (settled) return; settled = true; cleanup(); resolve(value);
        }, fail);
      } catch (error) { fail(error); }
    });
  }
  async poll(ownerId: string, identity: RoomIdentity, signal?: AbortSignal): Promise<{ requests: RpcEnvelope[] }> {
    this.running(); const deadline = this.now() + this.pollTimeout;
    const lease = await this.gate(identity, () => this.store.assertActive(ownerId, identity), deadline, signal, 'poll-timeout', 'poll-cancelled');
    const remaining = deadline - this.now();
    if (remaining <= 0) throw new RelayError(503, 'poll-timeout');
    const room = this.memory(this.lease(lease, identity, ownerId));
    if (signal?.aborted) throw new RelayError(503, 'poll-cancelled');
    if (room.poll) throw new RelayError(409, 'poll-already-pending');
    room.lastPoll = this.now();
    return new Promise((resolve, reject) => {
      let timer: Timer;
      const abort = () => { if (room.poll !== poll) return; room.poll = undefined; poll.cleanup(); reject(new RelayError(503, 'poll-cancelled')); };
      const poll: Poll = { resolve, reject, cleanup: () => { this.clearTimer(timer); signal?.removeEventListener('abort', abort); } };
      timer = this.setTimer(() => { if (room.poll !== poll) return; room.poll = undefined; room.lastPoll = this.now(); poll.cleanup(); resolve({ requests: [] }); }, remaining);
      room.poll = poll; signal?.addEventListener('abort', abort, { once: true });
      this.dispatch(room);
    });
  }
  async invoke(identity: RoomIdentity, input: GuestRequest, signal?: AbortSignal): Promise<GuestResponse> {
    this.running();
    const deadline = this.now() + this.rpcTimeout;
    const request = input && parseGuestRequest(input.operation, input.payload, input.session);
    if (!request) throw new RelayError(400, 'invalid-request');
    const lease = await this.gate(identity, () => this.store.assertActive(undefined, identity), deadline, signal, 'request-uncertain', 'request-cancelled');
    const remaining = deadline - this.now();
    if (remaining <= 0) throw new RelayError(503, 'request-uncertain');
    const room = this.memory(this.lease(lease, identity));
    if (room.lastPoll === null || this.now() - room.lastPoll > this.offlineAfter) throw new RelayError(503, 'host-offline');
    if (signal?.aborted) throw new RelayError(503, 'request-cancelled');
    if (room.pending.size >= 16 || this.outstanding >= 1000) throw new RelayError(503, 'request-capacity');
    // One photo per room and a small global cap bound large payloads in memory.
    if (request.operation === 'photo') {
      const photos = [...this.rooms.values()].flatMap(item => [...item.pending.values()].filter(rpc => rpc.envelope.operation === 'photo'));
      if (photos.length >= 32 || [...room.pending.values()].some(rpc => rpc.envelope.operation === 'photo')) throw new RelayError(503, 'photo-capacity');
    }
    const requestId = randomUUID();
    const envelope: RpcEnvelope = { requestId, operation: request.operation, payload: request.payload,
      ...(request.session === undefined ? {} : { session: request.session }) };
    return new Promise((resolve, reject) => {
      let timer: Timer;
      const remove = (error: RelayError) => {
        if (!room.pending.delete(requestId)) return;
        const queued = room.queue.indexOf(requestId); if (queued >= 0) room.queue.splice(queued, 1);
        this.outstanding--; rpc.cleanup();
        // The host may already be executing this RPC. Keep only its operation
        // and identity so a legitimate late response can be acknowledged without
        // retaining guest credentials/payloads or redelivering the operation.
        if (rpc.delivered) this.remember(`${room.lease.roomId}:${room.lease.generation}:${requestId}`,
          { operation: rpc.envelope.operation, expiresAt: this.now() + 60_000 });
        reject(error);
      };
      const abort = () => remove(new RelayError(503, 'request-cancelled'));
      const rpc: Rpc = { envelope, delivered: false, resolve, reject,
        cleanup: () => { this.clearTimer(timer); signal?.removeEventListener('abort', abort); } };
      timer = this.setTimer(() => remove(new RelayError(503, 'request-uncertain')), remaining);
      room.pending.set(requestId, rpc); room.queue.push(requestId); this.outstanding++;
      signal?.addEventListener('abort', abort, { once: true }); this.dispatch(room);
    });
  }
  async reply(ownerId: string, input: unknown): Promise<{ ok: true }> {
    this.running(); const batch = parseHostReplyEnvelope(input);
    if (!batch) throw new RelayError(400, 'invalid-reply');
    const lease = await this.store.assertActive(ownerId, batch); this.lease(lease, batch, ownerId);
    const room = this.rooms.get(batch.roomId);
    this.pruneReceipts();
    const prepared: { id: string; rpc?: Rpc; projected: GuestResponse; operation: RelayOperation; key: string; hash: string }[] = [];
    for (const response of batch.responses) {
      const key = `${batch.roomId}:${batch.generation}:${response.requestId}`;
      const rpc = room?.pending.get(response.requestId);
      const receipt = this.receipts.get(key);
      if (!rpc) {
        if (!receipt) throw new RelayError(409, 'reply-not-pending');
        const projected = projectGuestResponse(receipt.operation, response.status, response.body);
        if (!projected) throw new RelayError(400, 'invalid-reply');
        const hash = createHash('sha256').update(JSON.stringify(projected)).digest('hex');
        if (receipt.hash !== undefined && receipt.hash !== hash) throw new RelayError(409, 'reply-conflict');
        if (receipt.hash === undefined)
          prepared.push({ id: response.requestId, projected, operation: receipt.operation, key, hash });
        continue;
      }
      if (!rpc.delivered) throw new RelayError(409, 'reply-not-delivered');
      const projected = projectGuestResponse(rpc.envelope.operation, response.status, response.body);
      if (!projected) throw new RelayError(400, 'invalid-reply');
      const hash = createHash('sha256').update(JSON.stringify(projected)).digest('hex');
      prepared.push({ id: response.requestId, rpc, projected, operation: rpc.envelope.operation, key, hash });
    }
    // No promises resolve until every member of the batch has been checked.
    for (const entry of prepared) {
      if (entry.rpc) { room!.pending.delete(entry.id); entry.rpc.cleanup(); this.outstanding--; }
      this.remember(entry.key, { operation: entry.operation, hash: entry.hash, expiresAt: this.now() + 60_000 });
    }
    for (const entry of prepared) entry.rpc?.resolve(entry.projected);
    return { ok: true };
  }
  private pruneReceipts(): void {
    for (const [key, receipt] of this.receipts) if (receipt.expiresAt <= this.now()) this.receipts.delete(key);
  }
  private remember(key: string, receipt: Receipt): void {
    this.pruneReceipts(); this.receipts.set(key, receipt);
    while (this.receipts.size > 2000) this.receipts.delete(this.receipts.keys().next().value!);
  }
  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    for (const gate of this.gates) gate.fail(new RelayError(503, 'relay-stopped'));
    for (const room of [...this.rooms.values()]) this.fence(room.lease, new RelayError(503, 'relay-stopped'));
    this.receipts.clear(); this.blocked.clear(); this.unsubscribe();
    this.stopTask = (async () => { await this.store.deactivateAll(); })();
    return this.stopTask;
  }
}

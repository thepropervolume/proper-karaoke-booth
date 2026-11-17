import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { HostOpenResult } from './store';
import type { PublicRoom } from './broker';
/** Short-lived browser-host capabilities, isolated from configured desktop owners. */
export class MobileHostAccess {
  private entries = new Map<string, { owner: string; until: number; hash: Buffer }>();
  constructor(private now: () => number = Date.now) {}
  issue(): { token: string; expiresAt: number } {
    for (const [key, value] of this.entries) if (value.until <= this.now()) this.entries.delete(key);
    if (this.entries.size >= 200) throw new Error('Mobile hosting capacity reached.');
    // Reserved UUID prefix separates anonymous reservations from desktop owners.
    const token = randomBytes(32).toString('base64url'), owner = 'f17e0001-' + randomUUID().slice(9), until = this.now() + 12 * 60 * 60 * 1000;
    this.entries.set(owner, { owner, until, hash: createHash('sha256').update(token).digest() });
    return { token, expiresAt: until };
  }
  authenticate(token: string): string | undefined {
    const hash = createHash('sha256').update(token).digest();
    for (const entry of this.entries.values()) if (entry.until > this.now() && timingSafeEqual(hash, entry.hash)) return entry.owner;
    return undefined;
  }
}
type Nearby = { room: HostOpenResult; network: string; until: number };
/** Same-egress hints, not proof of proximity. Raw IPs are never stored or returned. */
export class NearbyRooms {
  private readonly salt = randomBytes(32);
  private entries = new Map<string, Nearby>();
  constructor(private now: () => number = Date.now) {}
  private network(ip: string) { return createHmac('sha256', this.salt).update(ip.replace(/^::ffff:/, '')).digest('hex'); }
  record(room: HostOpenResult, client: string, enabled: boolean): void {
    this.entries.delete(room.roomId);
    for (const [id, value] of this.entries) if (value.room.expiresAt <= this.now()) this.entries.delete(id);
    if (this.entries.size < 200) this.entries.set(room.roomId, { room, network: enabled ? this.network(client) : '', until: this.now() + 45_000 });
  }
  refresh(identity: { roomId: string; generation: string }, client: string, enabled: boolean): void {
    const entry = this.entries.get(identity.roomId);
    if (entry?.room.generation === identity.generation) this.record(entry.room, client, enabled);
  }
  forget(roomId: string): void { this.entries.delete(roomId); }
  async discover(client: string, lookup: (slug: string) => Promise<PublicRoom | null>): Promise<PublicRoom[]> {
    const network = this.network(client), result: PublicRoom[] = [];
    for (const entry of this.entries.values()) if (entry.until > this.now() && entry.network === network) {
      const room = await lookup(entry.room.slug);
      if (room?.online && room.roomId === entry.room.roomId && room.generation === entry.room.generation) result.push(room);
    }
    return result.slice(0, 20);
  }
}

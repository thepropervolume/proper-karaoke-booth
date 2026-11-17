import { createHash } from 'node:crypto';
import multicastDns from 'multicast-dns';
import { discoverSingerScreenAddresses, isPrivateSingerScreenIPv4 } from './singer-screen-network';
import { validSessionLink, type InternetSessionStatus } from '../remote/internet-session-control';

const SERVICE = '_tpv-karaoke._tcp.local';
const ANNOUNCE_MS = 5_000, RECHECK_MS = 30_000, TTL_SECONDS = 30;
export type MobileBeaconSocket = Pick<ReturnType<typeof multicastDns>, 'on' | 'respond' | 'destroy'>;
type SocketEntry = { socket: MobileBeaconSocket; ready: boolean; generation: number; lastSentAt: number };
export type MobileRoomBeaconOptions = {
  addresses?: () => Promise<string[]>;
  socket?: (address: string) => MobileBeaconSocket;
  every?: (callback: () => void, delay: number) => () => void;
  now?: () => number;
};

/** DNS labels count UTF-8 bytes, not JavaScript string length. */
export function mobileBeaconLabel(name: string, maximumBytes = 63): string {
  let result = '';
  for (const character of name.replace(/[.\x00-\x1f\x7f]/g, '-').trim()) {
    if (Buffer.byteLength(result + character, 'utf8') > maximumBytes) break;
    result += character;
  }
  return result.trim() || 'TPV Karaoke';
}

function records(address: string, desired: { url: string; name: string }) {
  // Two booths can have the same friendly name. DNS-SD caches key by instance
  // name, so give each public room a stable suffix rather than merging them.
  const roomKey = createHash('sha256').update(desired.url).digest('hex').slice(0, 8);
  const instance = `${mobileBeaconLabel(desired.name, 54)}-${roomKey}.${SERVICE}`;
  const host = `tpv-${createHash('sha256').update(address + '\0' + desired.url).digest('hex').slice(0, 12)}.local`;
  // This is a discovery beacon: native clients follow the public TXT URL rather
  // than opening the advertised local SRV address. Never enumerate other NICs.
  return [
    { name: SERVICE, type: 'PTR' as const, ttl: TTL_SECONDS, data: instance },
    { name: instance, type: 'SRV' as const, ttl: TTL_SECONDS, data: { port: 443, target: host, priority: 0, weight: 0 } },
    { name: instance, type: 'TXT' as const, ttl: TTL_SECONDS, data: [Buffer.from(`url=${desired.url}`, 'utf8')] },
    { name: host, type: 'A' as const, ttl: TTL_SECONDS, data: address },
  ];
}

/** Public room address only. Network-profile failure removes every advertisement. */
export class MobileRoomBeacon {
  private readonly sockets = new Map<string, SocketEntry>();
  private desired: { url: string; name: string } | null = null;
  private key = '';
  private generation = 0;
  private cancelTimers: (() => void)[] = [];
  constructor(private readonly options: MobileRoomBeaconOptions = {}) {}

  update(status: InternetSessionStatus, name: string, enabled: boolean): void {
    const desired = enabled && status.state === 'online' && validSessionLink(status.joinUrl, status.slug)
      ? { url: status.joinUrl, name: mobileBeaconLabel(name) } : null;
    const key = JSON.stringify(desired);
    if (key === this.key) return;
    this.key = key; this.clear(); this.desired = desired;
    if (!desired) return;
    const generation = this.generation;
    void this.reconcile(generation);
    this.cancelTimers.push(this.every(() => { void this.reconcile(generation); }, RECHECK_MS));
    // Bounded repeated announcements also reach phones that begin scanning
    // after the initial registration; query handling remains available too.
    this.cancelTimers.push(this.every(() => {
      for (const [address, entry] of this.sockets) this.announce(address, entry);
    }, ANNOUNCE_MS));
  }

  private every(callback: () => void, delay: number): () => void {
    if (this.options.every) return this.options.every(callback, delay);
    const timer = setInterval(callback, delay); timer.unref();
    return () => clearInterval(timer);
  }

  private async reconcile(generation: number): Promise<void> {
    let addresses: string[];
    try { addresses = await (this.options.addresses ?? discoverSingerScreenAddresses)(); }
    catch { addresses = []; }
    if (generation !== this.generation || !this.desired) return;
    const approved = new Set(addresses.filter(isPrivateSingerScreenIPv4).slice(0, 16));
    for (const [address, entry] of this.sockets) if (!approved.has(address)) this.retire(address, entry);
    for (const address of approved) if (!this.sockets.has(address)) {
      try {
        // Keep Windows' verified private-unicast binding. No TCP listener or
        // all-interface multicast membership is introduced by discovery.
        const socket = this.options.socket?.(address) ?? multicastDns({ interface: address, bind: address });
        const entry: SocketEntry = { socket, ready: false, generation, lastSentAt: -Infinity };
        this.sockets.set(address, entry);
        const failed = () => this.retire(address, entry);
        // Socket errors arrive after construction. Keep these handlers attached
        // even while retiring, so a late error cannot become an uncaught event.
        socket.on('error', failed); socket.on('warning', failed);
        socket.on('ready', () => { if (this.live(address, entry)) { entry.ready = true; this.announce(address, entry); } });
        socket.on('query', query => {
          if (!this.live(address, entry) || !this.desired || !Array.isArray(query.questions)) return;
          const names = new Set(records(address, this.desired).map(record => record.name.toLocaleLowerCase('en-US')));
          if (query.questions.slice(0, 64).some(question => typeof question.name === 'string' && names.has(question.name.toLocaleLowerCase('en-US')))) this.announce(address, entry);
        });
      } catch { /* Manual joining and same-egress suggestions remain available. */ }
    }
  }

  private live(address: string, entry: SocketEntry): boolean {
    return entry.generation === this.generation && this.desired !== null && this.sockets.get(address) === entry;
  }
  private announce(address: string, entry: SocketEntry): void {
    if (!entry.ready || !this.live(address, entry) || !this.desired) return;
    const now = this.options.now?.() ?? performance.now();
    // Many phones can ask the same question at once. One response covers them
    // all; never amplify a query burst into an unbounded packet burst.
    if (!Number.isFinite(now) || now - entry.lastSentAt < 250) return;
    entry.lastSentAt = now;
    try { entry.socket.respond({ answers: records(address, this.desired) }, error => { if (error) this.retire(address, entry); }); }
    catch { this.retire(address, entry); }
  }
  private retire(address: string, entry: SocketEntry): void {
    if (this.sockets.get(address) !== entry) return;
    this.sockets.delete(address);
    try { entry.socket.destroy(() => {}); } catch { /* A bind failure may leave an unbound socket. */ }
  }
  private clear(): void {
    this.generation++;
    for (const cancel of this.cancelTimers) cancel(); this.cancelTimers = [];
    for (const [address, entry] of this.sockets) this.retire(address, entry);
  }
  close(): void { this.desired = null; this.key = ''; this.clear(); }
}

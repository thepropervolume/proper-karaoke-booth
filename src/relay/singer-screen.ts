/** Ephemeral still frames only. Rooms, credentials and host addresses are never persisted here. */
import { isRelayUuid, type RoomIdentity } from './protocol';
import { RelayError } from './store';
import { createHash, timingSafeEqual } from 'node:crypto';

export const SCREEN_FRAME_BYTES = 256 * 1024;
export type ScreenLease = RoomIdentity & { slug: string; expiresAt: number };
type Screen = ScreenLease & { streamId: string; viewerDigest: Buffer; lastFrameAt: number; frame: Buffer | null; sequence: number; viewers: Map<string, number> };
const TTL_MS = 4_000, VIEWER_TTL_MS = 10_000;

export class InternetSingerScreens {
  private readonly screens = new Map<string, Screen>();
  private readonly stopped = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  private prune(): void {
    const now = this.now();
    for (const [id, expiresAt] of this.stopped) if (now >= expiresAt) this.stopped.delete(id);
    for (const [slug, screen] of this.screens) {
      if (now >= screen.expiresAt || now - screen.lastFrameAt > TTL_MS) this.screens.delete(slug);
      else for (const [viewer, seen] of screen.viewers) if (now - seen > VIEWER_TTL_MS) screen.viewers.delete(viewer);
    }
  }
  start(lease: ScreenLease, streamId: string, viewerDigest: string): void {
    this.prune();
    if (!isRelayUuid(streamId) || !/^[a-f0-9]{64}$/.test(viewerDigest) || lease.expiresAt <= this.now()) throw new RelayError(400, 'invalid-screen');
    if (this.stopped.has(streamId)) throw new RelayError(410, 'screen-ended');
    const previous = this.screens.get(lease.slug);
    if (previous && (previous.roomId !== lease.roomId || previous.generation !== lease.generation || previous.streamId !== streamId))
      throw new RelayError(409, 'screen-already-publishing');
    if (!previous && this.screens.size >= 64) throw new RelayError(503, 'screen-capacity');
    if (previous && !timingSafeEqual(previous.viewerDigest, Buffer.from(viewerDigest, 'hex'))) throw new RelayError(409, 'screen-already-publishing');
    if (!previous) this.screens.set(lease.slug, { ...lease, streamId, viewerDigest: Buffer.from(viewerDigest, 'hex'), frame: null, sequence: 0, lastFrameAt: this.now(), viewers: new Map() });
  }
  publish(lease: ScreenLease, streamId: string, sequence: number, jpeg: Buffer): void {
    this.prune(); const screen = this.screens.get(lease.slug);
    if (!screen || screen.roomId !== lease.roomId || screen.generation !== lease.generation || screen.streamId !== streamId || this.stopped.has(streamId))
      throw new RelayError(410, 'screen-ended');
    if (!Number.isSafeInteger(sequence) || sequence <= screen.sequence || !Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg.length > SCREEN_FRAME_BYTES ||
        jpeg.readUInt16BE(0) !== 0xffd8 || jpeg.readUInt16BE(jpeg.length - 2) !== 0xffd9) throw new RelayError(400, 'invalid-screen-frame');
    screen.frame = Buffer.from(jpeg); screen.sequence = sequence; screen.lastFrameAt = this.now();
  }
  clear(identity: RoomIdentity, streamId?: string): void {
    this.prune();
    if (streamId !== undefined) {
      if (!isRelayUuid(streamId)) throw new RelayError(400, 'invalid-screen');
      if (!this.stopped.has(streamId) && this.stopped.size >= 4096) throw new RelayError(503, 'screen-capacity');
      this.stopped.set(streamId, this.now() + 12 * 60 * 60_000);
    }
    for (const [slug, screen] of this.screens) if (screen.roomId === identity.roomId && screen.generation === identity.generation &&
      (streamId === undefined || screen.streamId === streamId)) this.screens.delete(slug);
  }
  frame(slug: string, identity: RoomIdentity, viewer: string, secret: string): Buffer | null {
    this.prune(); const screen = this.screens.get(slug);
    const digest = createHash('sha256').update(secret).digest();
    if (!screen || !screen.frame || screen.roomId !== identity.roomId || screen.generation !== identity.generation || !timingSafeEqual(digest, screen.viewerDigest)) return null;
    if (!screen.viewers.has(viewer) && screen.viewers.size >= 32) throw new RelayError(429, 'screen-viewer-capacity');
    screen.viewers.set(viewer, this.now());
    return Buffer.from(screen.frame);
  }
}

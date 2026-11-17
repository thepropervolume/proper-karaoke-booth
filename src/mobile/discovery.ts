import { Capacitor, registerPlugin } from '@capacitor/core';
import { mobileFetch, mobileJson, MOBILE_ORIGIN } from './api';
import { lookupInternetSingerRoom } from '../remote/internet-transport';
import { validateSessionSlug } from '../remote/internet-session-control';
export type DiscoveredRoom = { slug: string; name: string; instance: string; method: 'bonjour' | 'same-egress' };
interface DiscoveryPlugin { discover(): Promise<{ rooms: { url: string; name: string }[] }>; advertise(options: { url: string; name: string }): Promise<void>; stop(): Promise<void> }
const native = registerPlugin<DiscoveryPlugin>('TPVRoomDiscovery');
/** Discovery suggests public join addresses; it never joins or grants privileges. */
export function roomSlug(value: string): string | null {
  if (!validateSessionSlug(value.trim())) return value.trim();
  try {
    const u = new URL(value.trim());
    const slug = u.pathname.replace(/^\//, '').replace(/\/$/, '');
    return u.origin === MOBILE_ORIGIN && !u.username && !u.password && !u.search && !u.hash && !validateSessionSlug(slug) ? slug : null;
  } catch { return null; }
}
export async function discoverRooms(signal?: AbortSignal): Promise<DiscoveredRoom[]> {
  if (Capacitor.isNativePlatform()) {
    try {
      const value = await native.discover();
      if (signal?.aborted) return [];
      const found = await Promise.all(value.rooms.slice(0, 20).map(async room => {
        const slug = roomSlug(room.url); if (!slug) return null;
        try { const live = await lookupInternetSingerRoom(slug, mobileFetch); return live.online ? { slug, name: room.name.slice(0, 100), instance: `${live.roomId}:${live.generation}`, method: 'bonjour' as const } : null; } catch { return null; }
      }));
      const rooms = found.filter((room): room is NonNullable<typeof room> => room !== null);
      if (rooms.length) return rooms;
    } catch { /* Denied/missing local-network discovery still permits a manual link. */ }
  }
  const value = await mobileJson('/v1/mobile/nearby', undefined, { signal });
  if (!value || typeof value !== 'object' || !Array.isArray((value as { rooms?: unknown }).rooms)) return [];
  return (value as { rooms: unknown[] }).rooms.slice(0, 20).flatMap(room => {
    if (!room || typeof room !== 'object') return [];
    const r = room as { slug: unknown; online: unknown; roomId: unknown; generation: unknown };
    return typeof r.slug === 'string' && !validateSessionSlug(r.slug) && r.online === true && typeof r.roomId === 'string' && typeof r.generation === 'string' && /^[a-f0-9-]{36}$/.test(r.roomId) && /^[a-f0-9-]{36}$/.test(r.generation) ? [{ slug: r.slug, name: r.slug, instance: `${r.roomId}:${r.generation}`, method: 'same-egress' as const }] : [];
  });
}
export async function advertiseMobileRoom(url: string, name: string): Promise<void> { if (Capacitor.isNativePlatform() && roomSlug(url)) await native.advertise({ url, name }); }
export async function stopMobileDiscovery(): Promise<void> { if (Capacitor.isNativePlatform()) await native.stop(); }

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { GuestNowPlaying } from '../domain/guest-stage';

export type NativeLiveActivityStatus = 'available' | 'blocked' | 'unsupported';

type ActivityUpdate = {
  room: string;
  title: string;
  artist: string;
  singer: string;
  paused: boolean;
  progress?: number;
};

interface LiveActivityPlugin {
  status(): Promise<{ status: NativeLiveActivityStatus }>;
  update(update: ActivityUpdate): Promise<{ status: NativeLiveActivityStatus }>;
  clear(): Promise<void>;
}

const pluginName = 'TPVLiveActivity';
const plugin = registerPlugin<LiveActivityPlugin>(pluginName);
const supported = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(pluginName);
const refreshMs = 20_000;
let latest = 0;
let operations = Promise.resolve();
let published: { signature: string; updatedAt: number } | undefined;

export async function getNativeLiveActivityStatus(): Promise<NativeLiveActivityStatus> {
  if (!supported()) return 'unsupported';
  try {
    const result = await plugin.status();
    return result.status;
  } catch { return 'unsupported'; }
}

function shortText(value: string, limit: number): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim()).slice(0, limit).join('');
}

/** Serialize handoffs so a late update cannot revive a card after leaving a room. */
function schedule(task: () => Promise<void>): Promise<void> {
  const sequence = ++latest;
  operations = operations.then(async () => {
    if (sequence !== latest) return;
    await task();
  }).catch(() => { published = undefined; });
  return operations;
}

export function clearNativeLiveActivity(): Promise<void> {
  if (!supported()) return Promise.resolve();
  return schedule(async () => {
    published = undefined;
    await plugin.clear();
  });
}

export function updateNativeLiveActivity(room: string, playing: GuestNowPlaying | null): Promise<void> {
  if (!supported()) return Promise.resolve();
  if (!playing) return clearNativeLiveActivity();

  const progress = playing.timing && Number.isFinite(playing.timing.position) &&
    Number.isFinite(playing.timing.duration) && playing.timing.duration > 0
    ? Math.floor(Math.min(100, Math.max(0, 100 * playing.timing.position / playing.timing.duration))) : undefined;
  const update: ActivityUpdate = {
    room: shortText(room, 80), title: shortText(playing.title, 110), artist: shortText(playing.artist, 85),
    singer: shortText(playing.singer, 85), paused: playing.status === 'paused',
    ...(progress === undefined ? {} : { progress }),
  };
  if (!update.title) return clearNativeLiveActivity();
  const signature = JSON.stringify(update);
  return schedule(async () => {
    if (published?.signature === signature && performance.now() - published.updatedAt < refreshMs) return;
    const result = await plugin.update(update);
    published = result.status === 'available' ? { signature, updatedAt: performance.now() } : undefined;
  });
}

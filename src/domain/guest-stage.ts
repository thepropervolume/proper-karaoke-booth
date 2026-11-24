import type { SourceId } from './settings';
import type { RecordingKey } from './song-rating';
import { isGuestRecordingId, isGuestSource } from './guest-sources';

export const MAX_GUEST_ROTATION = 30;

export type GuestRotationEntry = {
  title: string;
  artist: string;
  singer: string;
  position: number;
  status: 'queued' | 'preparing';
  ownRequestId?: string;
};
export type GuestNowPlaying = {
  title: string;
  artist: string;
  singer: string;
  versionId: string;
  status: 'playing' | 'paused';
  source?: SourceId;
  recordingId?: RecordingKey;
  timing?: { position: number; duration: number };
};
export type GuestStage = { nowPlaying: GuestNowPlaying | null; queue: GuestRotationEntry[]; queueTruncated: boolean };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const guestStageText = (value: unknown, max: number, empty = false): value is string =>
  typeof value === 'string' && value.length <= max && (empty || !!value.trim()) && !/[\u0000-\u001f\u007f\ufffd]/u.test(value);
const core = (value: Record<string, unknown>) => guestStageText(value.title, 500) &&
  guestStageText(value.artist, 500, true) && guestStageText(value.singer, 203, true)
  ? { title: value.title, artist: value.artist, singer: value.singer } : null;
const timing = (value: unknown): value is NonNullable<GuestNowPlaying['timing']> => object(value) &&
  typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration > 0 && value.duration <= 86400 &&
  typeof value.position === 'number' && Number.isFinite(value.position) && value.position >= 0 && value.position <= value.duration;

/** Project only the bounded song, display-name and timing fields allowed in a joined room. */
export function projectGuestStage(value: unknown): GuestStage | null {
  if (!object(value) || !Array.isArray(value.queue) || value.queue.length > MAX_GUEST_ROTATION || typeof value.queueTruncated !== 'boolean') return null;
  let nowPlaying: GuestNowPlaying | null = null;
  if (value.nowPlaying !== null) {
    const current = value.nowPlaying;
    if (!object(current)) return null;
    const details = core(current);
    if (!details || typeof current.versionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(current.versionId) ||
        (current.status !== 'playing' && current.status !== 'paused') ||
        (current.source !== undefined && !isGuestSource(current.source)) ||
        (current.recordingId !== undefined && !isGuestRecordingId(current.recordingId, current.source)) ||
        (current.timing !== undefined && !timing(current.timing))) return null;
    nowPlaying = { ...details, versionId: current.versionId, status: current.status,
      ...(current.source === undefined ? {} : { source: current.source }),
      ...(current.recordingId === undefined ? {} : { recordingId: current.recordingId }),
      ...(current.timing === undefined ? {} : { timing: { position: current.timing.position, duration: current.timing.duration } }) };
  }
  const queue: GuestRotationEntry[] = [];
  for (const row of value.queue) {
    if (!object(row)) return null;
    const details = core(row);
    if (!details || row.position !== queue.length + 1 || (row.status !== 'queued' && row.status !== 'preparing') ||
        (row.ownRequestId !== undefined && !guestStageText(row.ownRequestId, 500))) return null;
    queue.push({ ...details, position: row.position, status: row.status,
      ...(row.ownRequestId === undefined ? {} : { ownRequestId: row.ownRequestId }) });
  }
  return { nowPlaying, queue, queueTruncated: value.queueTruncated };
}

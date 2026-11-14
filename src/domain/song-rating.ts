import { validStreamingSource } from './streaming-source';

export type RecordingKey = `youtube:${string}` | `sha256:${string}`;
export type LocalRecordingKey = `sha256:${string}`;
export type RatingStorage = 'local' | 'global';
export type SongRating = { recordingKey: RecordingKey; average: number | null; count: number; ownVote: number | null };
export const MAX_RATING_KEYS = 100;

export function isRecordingKey(value: unknown): value is RecordingKey {
  return typeof value === 'string' && /^(?:youtube:[A-Za-z0-9_-]{11}|sha256:[a-f0-9]{64})$/.test(value);
}

/** Unidentified local files stay on the host, even when they have a content hash. */
export function isLocalRecordingKey(value: unknown): value is LocalRecordingKey {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

export function ratingStorageFor(key: RecordingKey): RatingStorage {
  return isLocalRecordingKey(key) ? 'local' : 'global';
}

/** Ratings describe an exact recording, never an artist/title approximation. */
export function recordingKeyFor(source: unknown, fingerprint?: unknown): RecordingKey | null {
  if (validStreamingSource(source)) return `youtube:${source.videoId}`;
  return typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint) ? `sha256:${fingerprint}` : null;
}

export function validHeartVote(value: unknown): value is number | null {
  return value === null || Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10;
}

export function parseRecordingKeys(value: unknown): RecordingKey[] {
  if (!Array.isArray(value) || value.length > MAX_RATING_KEYS || value.some(key => !isRecordingKey(key)) || new Set(value).size !== value.length)
    throw new Error(`Choose up to ${MAX_RATING_KEYS} distinct recordings for ratings.`);
  return [...value] as RecordingKey[];
}

export function parseSongRating(value: unknown): SongRating | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!isRecordingKey(item.recordingKey) || !Number.isSafeInteger(item.count) || (item.count as number) < 0 || !validHeartVote(item.ownVote) ||
      !(item.average === null || typeof item.average === 'number' && Number.isFinite(item.average) && item.average >= 1 && item.average <= 10) ||
      (item.count === 0 ? item.average !== null || item.ownVote !== null : item.average === null)) return null;
  return {recordingKey:item.recordingKey,average:item.average as number | null,count:item.count as number,ownVote:item.ownVote};
}

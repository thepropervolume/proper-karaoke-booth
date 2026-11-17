/** Recording identity is immutable: never join ratings by artist, title, path or filename. */
export type RecordingRating = { recordingKey: string; average: number | null; count: number; ownVote: number | null };
export const MAX_RATING_LOOKUP_KEYS = 100;
export function isRecordingKey(value: unknown): value is string {
  return typeof value === 'string' && /^(?:youtube:[A-Za-z0-9_-]{11}|karafun:(?:catalog|community):[1-9]\d{0,11}|partytyme:consumer:[1-9]\d{0,11}|sha256:[a-f0-9]{64})$/.test(value);
}
export function isVoterId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isRatingValue(value: unknown): value is number | null {
  return value === null || Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10;
}
export function parseRecordingKeys(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_RATING_LOOKUP_KEYS || !value.every(isRecordingKey) || new Set(value).size !== value.length) return null;
  return [...value];
}
export class RatingsError extends Error {
  constructor(readonly status: 400 | 401 | 503, readonly code: string) { super(code); this.name = 'RatingsError'; }
}

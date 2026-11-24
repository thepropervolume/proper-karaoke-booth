import { SOURCE_IDS, type SourceId } from './settings';
import { isLocalRecordingKey, isRecordingKey, type LocalRecordingKey, type RecordingKey } from './song-rating';

export const GUEST_CATALOG_HEADER = 'x-tpv-guest-catalog';
export const GUEST_CATALOG_WITH_SOURCES = 'sources';
export const GUEST_ROTATION_HEADER = 'x-tpv-guest-rotation';

export function isGuestSource(value: unknown): value is SourceId {
  return typeof value === 'string' && (SOURCE_IDS as readonly string[]).includes(value);
}

export function isGuestSourceList(value: unknown): value is SourceId[] {
  return Array.isArray(value) && value.length <= SOURCE_IDS.length && new Set(value).size === value.length && [...value].every(isGuestSource);
}

export function isGuestRecordingId(value: unknown, source: unknown): value is Exclude<RecordingKey, LocalRecordingKey> {
  // A host-local media fingerprint is private and has no meaning across rooms.
  if (!isRecordingKey(value) || isLocalRecordingKey(value)) return false;
  if (source === 'karaokenerds' || source === 'youtube') return value.startsWith('youtube:');
  return (source === 'karafun' || source === 'partytyme') && value.startsWith(source + ':');
}

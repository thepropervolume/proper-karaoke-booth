export const LIBRARY_RESULT_FIELDS = {
  title: 'Name / Title', artist: 'Artist', duration: 'Duration', source: 'Service / Location',
  code: 'DJ Code', bpm: 'BPM', key: 'Key', date: 'Date Added', filename: 'Filename',
} as const;
export type LibraryResultField = keyof typeof LIBRARY_RESULT_FIELDS;
export const DEFAULT_LIBRARY_RESULT_FIELDS: readonly LibraryResultField[] =
  ['title', 'artist', 'duration', 'source', 'code', 'bpm', 'key', 'date'];

export type LibraryResultMetadata = {
  durationSeconds?: number | null;
  bpm?: number;
  musicalKey?: string;
  dateAdded?: string;
};

export function isLibraryResultField(value: unknown): value is LibraryResultField {
  return typeof value === 'string' && Object.hasOwn(LIBRARY_RESULT_FIELDS, value);
}

export function parseLibraryResultFields(value: unknown): LibraryResultField[] {
  if (!Array.isArray(value) || value.length > Object.keys(LIBRARY_RESULT_FIELDS).length ||
      !value.every(isLibraryResultField) || !value.includes('title') || new Set(value).size !== value.length)
    throw new Error('Invalid library result fields. Keep the title field and list each field once.');
  return (Object.keys(LIBRARY_RESULT_FIELDS) as LibraryResultField[]).filter(field => value.includes(field));
}

/** Calendar-day metadata is displayed as supplied rather than shifted to the host's time zone. */
export function libraryDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-?\d{2}-?\d{2}(?:$|T)/.test(value)) return undefined;
  const day = value.slice(0, value.indexOf('T') < 0 ? 10 : value.indexOf('T')).replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3');
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) return undefined;
  const time = new Date(day + 'T00:00:00Z');
  return Number.isFinite(time.valueOf()) && time.toISOString().slice(0, 10) === day ? day : undefined;
}

export function libraryBpm(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  return number > 0 && number <= 1000 ? number : undefined;
}

export function libraryMusicalKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  return /^(?:[A-G](?:#|♯|b|♭)?(?:\s*(?:major|minor|maj|min|m))?|\d{1,2}[AB])$/i.test(key) ? key : undefined;
}

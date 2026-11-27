export const LIBRARY_RESULT_FIELDS = {
  title: 'Name / Title', artist: 'Artist', duration: 'Duration', source: 'Source',
  code: 'DJ Code', bpm: 'BPM', key: 'Key', date: 'Date Added', filename: 'Filename',
} as const;
export type LibraryResultField = keyof typeof LIBRARY_RESULT_FIELDS;
export type LibraryResultSort = 'import-oldest' | 'import-newest' | `${LibraryResultField}-${'asc' | 'desc'}`;
export const DEFAULT_LIBRARY_RESULT_FIELDS: readonly LibraryResultField[] =
  ['title', 'artist', 'duration', 'source', 'code', 'bpm', 'key', 'date'];

export type LibraryResultMetadata = {
  durationSeconds?: number | null;
  bpm?: number;
  musicalKey?: string;
  dateAdded?: string;
  djCatalogNumber?: string;
  filenameDjCode?: string;
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

export function activeLibrarySort(sort: LibraryResultSort): { field: LibraryResultField; direction: 'asc' | 'desc' } | null {
  const [field, direction] = sort.split('-');
  return isLibraryResultField(field) && (direction === 'asc' || direction === 'desc') ? { field, direction } : null;
}

export function cycleLibrarySort(sort: LibraryResultSort, field: LibraryResultField): LibraryResultSort {
  if (sort === `${field}-asc`) return `${field}-desc`;
  return sort === `${field}-desc` ? 'import-oldest' : `${field}-asc`;
}

const sortText = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Sort display values without moving unavailable values to the top or changing equal-value order. */
export function compareLibrarySortValues(left: string | number | null | undefined, right: string | number | null | undefined,
  direction: 'asc' | 'desc'): number {
  const known = (value: typeof left): value is string | number => typeof value === 'number' ? Number.isFinite(value) : !!value?.trim();
  if (!known(left)) return known(right) ? 1 : 0;
  if (!known(right)) return -1;
  const order = typeof left === 'number' && typeof right === 'number' ? left - right : sortText.compare(String(left), String(right));
  return direction === 'asc' ? order : -order;
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

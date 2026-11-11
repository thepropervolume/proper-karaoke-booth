export type MediaRange = { start: number; end: number; partial: boolean };

/** Parse one HTTP byte range. A null result is unsatisfiable or malformed. */
export function mediaRange(value: string | null, size: number): MediaRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (value === null) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1, partial: true };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return null;
  return { start, end, partial: true };
}

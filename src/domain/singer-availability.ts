// A reserved safe integer keeps the persisted field and existing guest wire
// format stable. Timed absences cannot reach this value.
export const SINGER_ON_HOLD = Number.MAX_SAFE_INTEGER;

export function timedSingerReturnAt(unavailableUntilMs: number | undefined): number {
  return unavailableUntilMs === SINGER_ON_HOLD ? 0 : unavailableUntilMs ?? 0;
}

export function nextSingerReturnAt(singers: readonly { unavailableUntilMs?: number }[], now: number): number | null {
  let next = Infinity;
  for (const singer of singers) {
    const at = timedSingerReturnAt(singer.unavailableUntilMs);
    if (at > now) next = Math.min(next, at);
  }
  return Number.isFinite(next) ? next : null;
}

export type Rectangle = { x: number; y: number; width: number; height: number };
export type DisplayLike = { id: number; bounds: Rectangle; workArea: Rectangle };

function overlap(first: Rectangle, second: Rectangle): number {
  return Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)) *
    Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
}

function centerDistance(bounds: Rectangle, host: Rectangle): number {
  const x = bounds.x + bounds.width / 2 - (host.x + host.width / 2);
  const y = bounds.y + bounds.height / 2 - (host.y + host.height / 2);
  return x * x + y * y;
}

/** Prefer the last singer monitor while connected, then the nearest other
 * monitor to the host window. Coordinates may be negative on extended desktops.
 * The host monitor is the one containing most of the window, or nearest if the
 * window is currently offscreen. Display IDs settle all distance/overlap ties. */
export function selectSingerDisplay<T extends DisplayLike>(displays: readonly T[], hostBounds: Rectangle, lastDisplayId?: number | null): T | undefined {
  const saved = displays.find(display => display.id === lastDisplayId);
  if (saved) return saved;
  const byDistance = (first: T, second: T) => centerDistance(first.bounds, hostBounds) - centerDistance(second.bounds, hostBounds) || first.id - second.id;
  const host = [...displays].sort((first, second) => overlap(second.bounds, hostBounds) - overlap(first.bounds, hostBounds) || byDistance(first, second))[0];
  if (!host) return undefined;
  return displays.filter(display => display.id !== host.id).sort(byDistance)[0] ?? host;
}

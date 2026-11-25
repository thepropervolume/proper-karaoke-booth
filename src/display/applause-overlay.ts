const DISPLAY_TIME_MS = 2400;

/** A single short cue leaves the lyrics, photo overlay and audio player alone. */
export function createApplauseOverlay(container: HTMLElement | null) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clear(): void {
    clearTimeout(timer);
    timer = undefined;
    container?.replaceChildren();
  }

  function show(): void {
    if (!container) return;
    const badge = document.createElement('div');
    badge.className = 'applause-badge';
    badge.textContent = '👏 Applause';
    clearTimeout(timer);
    // Replace the existing badge to restart its entrance without stacking.
    container.replaceChildren(badge);
    timer = setTimeout(clear, DISPLAY_TIME_MS);
  }
  return { show, clear };
}

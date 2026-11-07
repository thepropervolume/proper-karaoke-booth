import { DEFAULT_SHORTCUTS, matchesShortcut, type Shortcuts } from '../domain/shortcuts';
type PlaybackState = { generation: string; src: string; status: 'playing' | 'paused'; singer: string; title: string; position: number; volume: number };
type DisplayState = { playback: PlaybackState | null; next: string[]; logo: string | null; shortcuts: Shortcuts };
declare global { interface Window { tpvDisplay: { ready(): void; shortcut(action: 'search' | 'playPause'): void; event(event: unknown): void; subscribe(callback: (state: DisplayState) => void): () => void } } }
let video = document.querySelector<HTMLVideoElement>('#video')!;
const waiting = document.querySelector<HTMLElement>('#waiting')!;
const caption = document.querySelector<HTMLElement>('#caption')!;
const next = document.querySelector<HTMLElement>('#next')!;
const logos = document.querySelectorAll<HTMLImageElement>('#idle-logo, #header-logo');
let current: PlaybackState | null = null;
let updateSequence = 0;
let shortcuts = DEFAULT_SHORTCUTS;
window.addEventListener('keydown', event => {
  if (event.repeat) return;
  const input = { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
  const action = matchesShortcut(shortcuts, 'search', input) ? 'search' : matchesShortcut(shortcuts, 'playPause', input) ? 'playPause' : null;
  if (action) { event.preventDefault(); window.tpvDisplay.shortcut(action); }
});

// A fresh element and generation-bound listeners prevent delayed events from an
// old decoder from being attributed to a newly started performance.
function playerFor(state: PlaybackState): HTMLVideoElement {
  const player = document.createElement('video');
  player.id = 'video';
  player.playsInline = true;
  const generation = state.generation;
  let lastCheckpoint = 0;
  const report = (type: string) => {
    if (video !== player || current?.generation !== generation) return;
    window.tpvDisplay.event({ type, generation, position: player.currentTime || 0 });
  };
  player.addEventListener('ended', () => report('ended'));
  player.addEventListener('error', () => report('error'));
  player.addEventListener('pause', () => report('checkpoint'));
  player.addEventListener('timeupdate', () => {
    if (Date.now() - lastCheckpoint > 5000) { lastCheckpoint = Date.now(); report('checkpoint'); }
  });
  video.pause();
  video.replaceWith(player);
  video = player;
  player.src = state.src;
  player.load();
  if (state.position > 0) {
    player.addEventListener('loadedmetadata', () => {
      if (video === player && current?.generation === generation && Number.isFinite(player.duration)) player.currentTime = Math.min(state.position, player.duration);
    }, { once: true });
  }
  return player;
}
window.tpvDisplay.subscribe(async (view) => {
  const sequence = ++updateSequence;
  shortcuts = view.shortcuts;
  const state = view.playback;
  document.body.classList.toggle('idle', !state);
  next.textContent = view.next.length ? `Coming up: ${view.next.join(' · ')}` : '';
  logos.forEach(logo => {
    logo.hidden = !view.logo;
    if (view.logo) logo.src = view.logo; else logo.removeAttribute('src');
  });
  if (!state) {
    current = null;
    video.pause(); video.removeAttribute('src'); video.load();
    waiting.hidden = false; caption.textContent = '';
    return;
  }
  const changed = !current || current.generation !== state.generation;
  current = state;
  waiting.hidden = true; caption.textContent = `${state.singer} · ${state.title}`;
  const player = changed ? playerFor(state) : video;
  player.volume = state.volume;
  if (state.status === 'playing') {
    try { await player.play(); } catch {
      if (sequence === updateSequence && video === player && current?.generation === state.generation)
        window.tpvDisplay.event({ type: 'error', generation: state.generation, position: player.currentTime || 0 });
    }
  } else player.pause();
});
window.tpvDisplay.ready();
export {};

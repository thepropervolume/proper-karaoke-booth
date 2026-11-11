import { DEFAULT_SHORTCUTS, matchesShortcut, type Shortcuts } from '../domain/shortcuts';
import { AudioOutputRouter } from './audio-output';
import { createBumperPlayer, type BumperRequest } from './bumper-player';
import { mediaFailure, playFailure, type MediaFailure } from './media-error';
type PlaybackState = { generation: string; src: string; status: 'playing' | 'paused'; singer: string; title: string; position: number; volume: number; outputId: string };
type DisplayState = { playback: PlaybackState | null; next: string[]; logo: string | null; shortcuts: Shortcuts; bumperVolume: number };
declare global { interface Window { tpvDisplay: { onSeek(callback: (value: unknown) => void): () => void; ready(): void; shortcut(action: 'search' | 'playPause'): void; event(event: unknown): void; bumperAck(value: unknown): void; bumperEvent(value: unknown): void; bumperDeviceChange(): void; onBumperCommand(callback: (request: BumperRequest) => void): () => void; subscribe(callback: (state: DisplayState) => void): () => void } } }
let video = document.querySelector<HTMLVideoElement>('#video')!;
const waiting = document.querySelector<HTMLElement>('#waiting')!;
const caption = document.querySelector<HTMLElement>('#caption')!;
const next = document.querySelector<HTMLElement>('#next')!;
const logos = document.querySelectorAll<HTMLImageElement>('#idle-logo, #header-logo');
let current: PlaybackState | null = null;
let updateSequence = 0;
let shortcuts = DEFAULT_SHORTCUTS;
let lastTimelineReport = 0;
function reportTimeline(force = false): void {
  if (!current || (!force && Date.now() - lastTimelineReport < 350)) return;
  lastTimelineReport = Date.now();
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  window.tpvDisplay.event({ type: 'timeline', generation: current.generation, position: video.currentTime || 0, duration,
    seekable: video.seekable.length > 0 });
}
window.tpvDisplay.onSeek((value) => {
  if (!value || typeof value !== 'object') return;
  const request = value as { id?: unknown; generation?: unknown; position?: unknown };
  const player = video, generation = current?.generation;
  if (!generation || request.generation !== generation || typeof request.id !== 'string' || typeof request.position !== 'number' ||
      !Number.isFinite(request.position) || request.position < 0 || !Number.isFinite(player.duration) || request.position >= player.duration) return;
  const target = request.position;
  let withinRange = false;
  for (let i = 0; i < player.seekable.length; i++) if (target >= player.seekable.start(i) && target <= player.seekable.end(i)) withinRange = true;
  const reply = (ok: boolean) => {
    if (video === player && current?.generation === generation)
      window.tpvDisplay.event({ type: 'seek-result', id: request.id, generation, position: player.currentTime || 0, ok });
  };
  if (!withinRange) { reply(false); return; }
  if (Math.abs(player.currentTime - target) < 0.001) { reply(true); return; }
  const done = (ok: boolean) => { clearTimeout(timer); player.removeEventListener('seeked', seeked); player.removeEventListener('error', failed); reply(ok); reportTimeline(true); };
  const seeked = () => done(true), failed = () => done(false);
  const timer = setTimeout(failed, 4500);
  player.addEventListener('seeked', seeked, { once: true });
  player.addEventListener('error', failed, { once: true });
  try { player.currentTime = target; } catch { done(false); }
});
const bumperPlayer = createBumperPlayer(value => window.tpvDisplay.bumperAck(value), value => window.tpvDisplay.bumperEvent(value));
window.tpvDisplay.onBumperCommand(request => bumperPlayer.handle(request));
const output = new AudioOutputRouter(async () => {
  if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Audio output enumeration is unavailable.');
  return navigator.mediaDevices.enumerateDevices();
});
navigator.mediaDevices?.addEventListener('devicechange', () => {
  bumperPlayer.muteForOutputChange();
  window.tpvDisplay.bumperDeviceChange();
  if (!current || current.status !== 'playing') return;
  const generation = current.generation;
  ++updateSequence;
  output.invalidate(video);
  window.tpvDisplay.event({ type: 'output-error', generation, position: video.currentTime || 0, message: 'Audio devices changed. Check the output in Preferences, then resume when ready.' });
});
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
  const report = (type: string, code?: MediaFailure) => {
    if (video !== player || current?.generation !== generation) return;
    window.tpvDisplay.event({ type, generation, position: player.currentTime || 0, ...(code ? { code } : {}) });
  };
  player.addEventListener('ended', () => report('ended'));
  player.addEventListener('error', () => report('error', mediaFailure(player.error?.code)));
  player.addEventListener('pause', () => { report('checkpoint'); reportTimeline(true); });
  for (const event of ['loadedmetadata', 'durationchange', 'progress', 'canplay', 'seeked']) player.addEventListener(event, () => {
    if (video === player && current?.generation === generation) reportTimeline(true);
  });
  player.addEventListener('timeupdate', () => {
    if (video === player && current?.generation === generation) reportTimeline();
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
  bumperPlayer.setVolume(view.bumperVolume);
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
    output.invalidate(video); video.removeAttribute('src'); video.load();
    waiting.hidden = false; caption.textContent = '';
    return;
  }
  const changed = !current || current.generation !== state.generation;
  current = state;
  waiting.hidden = true; caption.textContent = `${state.singer} · ${state.title}`;
  const player = changed ? playerFor(state) : video;
  player.volume = state.volume;
  if (state.status === 'playing') {
    let ready = false;
    try {
      ready = await output.prepare(player, state.outputId, () => sequence === updateSequence && video === player && current?.generation === state.generation && current.status === 'playing');
    } catch (error) {
      if (sequence === updateSequence && video === player && current?.generation === state.generation) {
        player.pause();
        window.tpvDisplay.event({ type: 'output-error', generation: state.generation, position: player.currentTime || 0, message: error instanceof Error ? error.message : 'Could not use the selected output.' });
      }
    }
    if (ready) {
      try { await player.play(); }
      catch (reason) { if (sequence === updateSequence && video === player && current?.generation === state.generation) window.tpvDisplay.event({ type: 'error', code: playFailure(reason), generation: state.generation, position: player.currentTime || 0 }); }
    }
  } else output.invalidate(player);
});
window.tpvDisplay.ready();
export {};

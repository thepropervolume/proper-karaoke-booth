import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, matchesShortcut, type ShortcutAction, type Shortcuts } from '../domain/shortcuts';
import { AudioOutputRouter } from './audio-output';
import { createBumperPlayer, type BumperRequest } from './bumper-player';
import { createApplausePlayer, type ApplauseRequest } from './applause-player';
import { createApplauseOverlay } from './applause-overlay';
import { createPhotoOverlay } from './photo-overlay';
import { mediaFailure, playFailure, type MediaFailure } from './media-error';
import { KaraFunPlayer, type KaraFunPlayerEvent, type KaraFunStemSource } from './karafun-player';
import { paintKaraFunLyrics } from './karafun-lyrics';
import type { KaraFunTiming } from '../domain/karafun-kit-timing';
import type { KaraFunStemVolumes } from '../domain/karafun-mix';
import { createSingerDisplayBranding, type SingerDisplayBranding } from './branding';
import { appearanceFontStack, type AppearanceFont } from '../domain/appearance-font';
type PlaybackCommon = { generation: string; src: string; status: 'playing' | 'paused'; singer: string; title: string; position: number; volume: number; outputId: string };
type NativePlayback = PlaybackCommon & { kind: 'karafun'; karaFun: { timing: KaraFunTiming; durationSeconds: number; stems: KaraFunStemSource[]; stemVolumes: KaraFunStemVolumes }; backdropSrc: string | null };
type PlaybackState = PlaybackCommon & { kind?: 'video' } | NativePlayback;
const isNative = (state: PlaybackState | null): state is NativePlayback => state?.kind === 'karafun';
type DisplayState = { playback: PlaybackState | null; next: string[]; logo: string | null; branding?: SingerDisplayBranding; shortcuts: Shortcuts; bumperVolume: number; fontFamily?: AppearanceFont };
declare global { interface Window { tpvDisplay: { onSeek(callback: (value: unknown) => void): () => void; onOutputRecovery?(callback: (value: unknown) => void): () => void; ready(): void; shortcut(action: ShortcutAction): void; event(event: unknown): void; bumperAck(value: unknown): void; bumperEvent(value: unknown): void; bumperDeviceChange(): void; applauseResult?(value: unknown): void; onApplause?(callback: (request: ApplauseRequest) => void): () => void; onApplauseCommitted?(callback: () => void): () => void; onBumperCommand(callback: (request: BumperRequest) => void): () => void; subscribe(callback: (state: DisplayState) => void): () => void } } }
let video = document.querySelector<HTMLVideoElement>('#video')!;
let failedVideo: HTMLVideoElement | null = null;
const waiting = document.querySelector<HTMLElement>('#waiting')!;
const caption = document.querySelector<HTMLElement>('#caption')!;
const next = document.querySelector<HTMLElement>('#next')!;
const branding = createSingerDisplayBranding({ root: document.documentElement,
  names: document.querySelectorAll<HTMLElement>('[data-booth-name]'), logos: document.querySelectorAll<HTMLImageElement>('#idle-logo, #header-logo'),
  banner: document.querySelector<HTMLElement>('#booth-banner'), bannerText: document.querySelector<HTMLElement>('#booth-banner-text'),
});
window.addEventListener('beforeunload', () => branding.dispose());
const lyrics = document.querySelector<HTMLCanvasElement>('#karafun-lyrics');
const backdrop = document.querySelector<HTMLVideoElement>('#karafun-backdrop');
let current: PlaybackState | null = null;
let updateSequence = 0;
let outputRecoveryGeneration: string | null = null;
let outputRevision = 0;
let rerouteRequested = false;
let shortcuts = DEFAULT_SHORTCUTS;
let fontFamily: string | undefined;
let lastTimelineReport = 0;
let lastNativeCheckpoint = 0;
let nativeAnimation: number | null = null;
let nativeLoading: { generation: string; promise: Promise<void> } | null = null;
let nativeRecovery: { generation: string; revision: number; promise: Promise<boolean> } | null = null;
const nativePlayer = new KaraFunPlayer({ onEvent: nativeEvent });
function nativeEvent(event: KaraFunPlayerEvent): void {
  if (!isNative(current) || current.generation !== event.generation) return;
  if (event.type === 'output-error') {
    outputRecoveryGeneration = event.generation; outputRevision = event.revision;
    rerouteRequested = false; ++updateSequence;
  }
  window.tpvDisplay.event(event);
  if (event.type === 'timeline' && Date.now() - lastNativeCheckpoint > 5000) {
    lastNativeCheckpoint = Date.now();
    window.tpvDisplay.event({ type: 'checkpoint', generation: event.generation, position: event.position });
  }
}
function stopNativeVisuals(): void {
  if (nativeAnimation !== null) window.cancelAnimationFrame(nativeAnimation);
  nativeAnimation = null;
  if (backdrop) { backdrop.muted = true; backdrop.pause(); backdrop.removeAttribute('src'); backdrop.load(); }
  if (lyrics) lyrics.getContext('2d')?.clearRect(0, 0, lyrics.width, lyrics.height);
}
function animateNativeLyrics(): void {
  if (!isNative(current) || !lyrics) { nativeAnimation = null; return; }
  paintKaraFunLyrics(lyrics, current.karaFun.timing, nativePlayer.snapshot()?.position ?? current.position, { fontFamily });
  nativeAnimation = window.requestAnimationFrame(animateNativeLyrics);
}
function nativeVisuals(state: NativePlayback): void {
  if (backdrop) {
    backdrop.muted = true; backdrop.volume = 0; backdrop.loop = true;
    if (state.backdropSrc && backdrop.getAttribute('src') !== state.backdropSrc) {
      backdrop.src = state.backdropSrc; backdrop.load();
      void backdrop.play().catch(() => { /* A silent optional backdrop must not interrupt the song. */ });
    } else if (!state.backdropSrc && backdrop.hasAttribute('src')) { backdrop.pause(); backdrop.removeAttribute('src'); backdrop.load(); }
  }
  if (lyrics && nativeAnimation === null) animateNativeLyrics();
}
function reportTimeline(force = false): void {
  if (!current || isNative(current) || (!force && Date.now() - lastTimelineReport < 350)) return;
  lastTimelineReport = Date.now();
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  window.tpvDisplay.event({ type: 'timeline', generation: current.generation, position: video.currentTime || 0, duration,
    seekable: video.seekable.length > 0 });
}
window.tpvDisplay.onSeek((value) => {
  if (!value || typeof value !== 'object') return;
  const request = value as { id?: unknown; generation?: unknown; position?: unknown };
  if (isNative(current)) {
    const generation = current.generation;
    if (request.generation !== generation || typeof request.id !== 'string' || typeof request.position !== 'number' || !Number.isFinite(request.position)) return;
    void nativePlayer.seek(generation, request.position).then(ok => {
      if (isNative(current) && current.generation === generation)
        window.tpvDisplay.event({ type: 'seek-result', id: request.id, generation, position: nativePlayer.snapshot()?.position ?? 0, ok });
    });
    return;
  }
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
// The browser entry supplies bundled recordings; keeping asset imports there
// also lets the display controller run independently in native-display tests.
let applausePlayer: ReturnType<typeof createApplausePlayer> | null = null;
export function setApplauseRecordings(recordings: readonly string[]): void {
  applausePlayer?.stop();
  applausePlayer = createApplausePlayer(recordings);
}
window.tpvDisplay.onApplause?.(request => {
  if (!applausePlayer) { window.tpvDisplay.applauseResult?.({ id: request.id, ok: false, error: 'Applause recordings are unavailable.' }); return; }
  void applausePlayer.play(request).then(result => window.tpvDisplay.applauseResult?.(result));
});
const applauseOverlay = createApplauseOverlay(document.querySelector('#applause-overlay'));
const stopApplauseEvents = window.tpvDisplay.onApplauseCommitted?.(applauseOverlay.show);
window.addEventListener('beforeunload', () => {
  stopApplauseEvents?.();
  applauseOverlay.clear();
});
const photoDisplay = window.tpvDisplay as typeof window.tpvDisplay & { onPhoto?: (callback: (request: { id: string; dataUrl: string }) => void) => () => void; photoResult?: (value: unknown) => void };
const photoOverlay = createPhotoOverlay(result => photoDisplay.photoResult?.(result));
photoDisplay.onPhoto?.(request => photoOverlay.show(request));
window.addEventListener('beforeunload', () => photoOverlay.clear());
const output = new AudioOutputRouter(async () => {
  if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Audio output enumeration is unavailable.');
  return navigator.mediaDevices.enumerateDevices();
});
// Only a deliberate, verified main-process Resume authorizes recovery after a
// device change. A routine state publication must never silently select a new sink.
window.tpvDisplay.onOutputRecovery?.(value => {
  if (!value || typeof value !== 'object') return;
  const recovery = value as { generation?: unknown; revision?: unknown };
  if (recovery.generation !== current?.generation || recovery.generation !== outputRecoveryGeneration ||
    !Number.isSafeInteger(recovery.revision) || recovery.revision !== outputRevision) return;
  if (isNative(current)) {
    const generation = current.generation, revision = outputRevision, outputId = current.outputId;
    rerouteRequested = true;
    const promise = nativePlayer.recoverOutput(generation, revision, outputId).then(ok => {
      if (!isNative(current) || current.generation !== generation || outputRevision !== revision) return false;
      if (ok) { outputRecoveryGeneration = null; rerouteRequested = true; }
      else nativePlayer.invalidateOutput('Could not use the chosen audio output. Check Preferences and press Play again.');
      return ok;
    });
    nativeRecovery = { generation, revision, promise };
    return;
  }
  outputRecoveryGeneration = null;
  rerouteRequested = true;
});
function reportOutputFailure(generation: string, message: string): void {
  if (isNative(current)) { nativePlayer.invalidateOutput(message); return; }
  outputRecoveryGeneration = generation;
  ++outputRevision;
  rerouteRequested = false;
  ++updateSequence;
  output.invalidate(video);
  window.tpvDisplay.event({ type: 'output-error', generation, revision: outputRevision, position: video.currentTime || 0, message });
}
navigator.mediaDevices?.addEventListener('devicechange', () => {
  applausePlayer?.stop();
  applauseOverlay.clear();
  bumperPlayer.muteForOutputChange();
  window.tpvDisplay.bumperDeviceChange();
  if (!current) return;
  const generation = current.generation;
  reportOutputFailure(generation, 'Audio devices changed. Check the output in Preferences, then resume when ready.');
});
window.addEventListener('keydown', event => {
  if (event.repeat || event.defaultPrevented || event.isComposing || (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])')) return;
  const input = { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
  const action = SHORTCUT_ACTIONS.find(action => (action.scope === 'application' || action.scope === 'player') && matchesShortcut(shortcuts, action.id, input))?.id;
  if (action) { event.preventDefault(); window.tpvDisplay.shortcut(action); }
});

// A fresh element and generation-bound listeners prevent delayed events from an
// old decoder from being attributed to a newly started performance.
function reportVideoFailure(player: HTMLVideoElement, generation: string, code: MediaFailure): void {
  if (video !== player || current?.generation !== generation || isNative(current) || failedVideo === player) return;
  failedVideo = player;
  ++updateSequence;
  const position = player.currentTime || 0;
  output.invalidate(player);
  window.tpvDisplay.event({ type: 'error', generation, code, position });
}
function playerFor(state: PlaybackState): HTMLVideoElement {
  const player = document.createElement('video');
  player.id = 'video';
  player.playsInline = true;
  const generation = state.generation;
  let lastCheckpoint = 0;
  const report = (type: string) => {
    if (video !== player || current?.generation !== generation || isNative(current) || failedVideo === player) return;
    window.tpvDisplay.event({ type, generation, position: player.currentTime || 0 });
  };
  player.addEventListener('ended', () => report('ended'));
  player.addEventListener('error', () => reportVideoFailure(player, generation, mediaFailure(player.error?.code)));
  player.addEventListener('pause', () => { report('checkpoint'); reportTimeline(true); });
  for (const event of ['loadedmetadata', 'durationchange', 'progress', 'canplay', 'seeked']) player.addEventListener(event, () => {
    if (video === player && current?.generation === generation && !isNative(current)) reportTimeline(true);
  });
  player.addEventListener('timeupdate', () => {
    if (video === player && current?.generation === generation && !isNative(current)) reportTimeline();
    if (Date.now() - lastCheckpoint > 5000) { lastCheckpoint = Date.now(); report('checkpoint'); }
  });
  video.pause();
  video.replaceWith(player);
  video = player;
  failedVideo = null;
  player.src = state.src;
  player.load();
  if (state.position > 0) {
    player.addEventListener('loadedmetadata', () => {
      if (video === player && current?.generation === generation && !isNative(current) && Number.isFinite(player.duration)) player.currentTime = Math.min(state.position, player.duration);
    }, { once: true });
  }
  return player;
}
// Caption, logo and volume updates reuse the current player. Only a transport
// change may start/pause it; this renderer also stays alive for the host preview
// when its native window is hidden.
window.tpvDisplay.subscribe(async (view) => {
  bumperPlayer.setVolume(view.bumperVolume);
  applausePlayer?.setVolume(view.bumperVolume);
  shortcuts = view.shortcuts;
  const nextFont = appearanceFontStack(view.fontFamily);
  if (fontFamily !== nextFont) {
    fontFamily = nextFont;
    document.documentElement.style.setProperty('--booth-font-family', fontFamily ?? '');
  }
  const state = view.playback;
  document.body.classList.toggle('idle', !state);
  document.body.classList.toggle('native-karafun', isNative(state));
  next.textContent = view.next.length ? `Coming up: ${view.next.join(' · ')}` : '';
  branding.update(view.branding, view.logo);
  if (!state) {
    ++updateSequence;
    const previousGeneration = current?.generation;
    current = null;
    failedVideo = null;
    outputRecoveryGeneration = null; rerouteRequested = false;
    nativeRecovery = null; nativeLoading = null; nativePlayer.stop(); stopNativeVisuals();
    output.invalidate(video); video.removeAttribute('src'); video.load();
    waiting.hidden = false; caption.textContent = '';
    // invalidate() mutes and pauses synchronously before this acknowledgement.
    if (previousGeneration) window.tpvDisplay.event({ type: 'silenced', generation: previousGeneration });
    return;
  }
  const changed = !current || current.generation !== state.generation || current.src !== state.src || current.kind !== state.kind;
  // Media errors poison an HTML media element. Only a later authorized Resume
  // can create a fresh decoder for the same performance and checkpoint.
  const retry = !changed && current?.status === 'paused' && state.status === 'playing' && failedVideo === video;
  const transportChanged = changed || current?.status !== state.status || current.outputId !== state.outputId;
  const previousOutput = current?.outputId;
  if (changed) { outputRecoveryGeneration = null; rerouteRequested = false; }
  current = state;
  waiting.hidden = true; caption.textContent = [state.singer, state.title].filter(Boolean).join(' · ');
  if (isNative(state)) {
    if (changed) {
      nativeRecovery = null; lastNativeCheckpoint = 0;
      output.invalidate(video); video.removeAttribute('src'); video.load();
      nativeLoading = { generation: state.generation, promise: nativePlayer.load({ generation: state.generation,
        stems: state.karaFun.stems, durationSeconds: state.karaFun.durationSeconds, position: state.position,
        volume: state.volume, outputId: state.outputId, stemVolumes: state.karaFun.stemVolumes }) };
    } else {
      nativePlayer.setVolume(state.generation, state.volume);
      nativePlayer.setStemVolumes(state.generation, state.karaFun.stemVolumes);
      if (previousOutput !== state.outputId)
        nativePlayer.invalidateOutput('The audio output changed. Check Preferences and press Play again.');
    }
    nativeVisuals(state);
    // Decode and routing can finish after Pause, Stop or another song. Only the
    // newest transport publication may start its prepared generation.
    if (!transportChanged && !rerouteRequested) return;
    const sequence = ++updateSequence;
    try { await nativeLoading?.promise; }
    catch { return; /* The player already emitted a generation-bound error. */ }
    if (nativeRecovery?.generation === state.generation) await nativeRecovery.promise;
    if (sequence !== updateSequence || !isNative(current) || current.generation !== state.generation) return;
    if (outputRecoveryGeneration === state.generation || nativePlayer.snapshot()?.outputBlocked) { nativePlayer.pause(state.generation); return; }
    if (current.status === 'playing') { rerouteRequested = false; await nativePlayer.play(state.generation); }
    else {
      nativePlayer.pause(state.generation);
      window.tpvDisplay.event({ type: 'checkpoint', generation: state.generation, position: nativePlayer.snapshot()?.position ?? 0 });
    }
    return;
  }
  if (nativePlayer.snapshot()) { nativePlayer.stop(); nativeLoading = null; nativeRecovery = null; stopNativeVisuals(); }
  const player = changed || retry ? playerFor(state) : video;
  player.volume = state.volume;
  // Queue, caption, branding, shortcut and volume refreshes do not affect the
  // current route, including one which is still being prepared asynchronously.
  if (!transportChanged && !rerouteRequested) return;
  const sequence = ++updateSequence;
  if (outputRecoveryGeneration === state.generation) {
    output.invalidate(player);
    return;
  }
  if (state.status === 'playing') {
    rerouteRequested = false;
    let ready = false;
    try {
      ready = await output.prepare(player, state.outputId, () => sequence === updateSequence && video === player && current?.generation === state.generation && current.status === 'playing');
    } catch (error) {
      if (sequence === updateSequence && video === player && current?.generation === state.generation) {
        reportOutputFailure(state.generation, error instanceof Error ? error.message : 'Could not use the selected output.');
      }
    }
    if (ready && sequence === updateSequence && video === player && current?.status === 'playing') {
      try { await player.play(); }
      catch (reason) { if (sequence === updateSequence) reportVideoFailure(player, state.generation, playFailure(reason)); }
    }
  } else output.invalidate(player);
});
window.tpvDisplay.ready();
export {};

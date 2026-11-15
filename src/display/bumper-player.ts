type AudioWithSink = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
type Start = { id: string; action: 'start'; generation: string; src: string; volume: number; deviceId: string; fadeMs?: number };
export type BumperRequest = Start | { id: string; action: 'stop' };
export type BumperFadeClock = { now(): number; every(callback: () => void): () => void };
const fadeClock: BumperFadeClock = { now: () => performance.now(), every(callback) { const timer = setInterval(callback, 16); return () => clearInterval(timer); } };

/** One active audio element; host must serialize karaoke start behind the stop acknowledgement. */
export function createBumperPlayer(ack: (value: { id: string; ok: boolean; error?: string }) => void,
  event: (value: { type: 'ended' | 'error'; generation: string }) => void, clock: BumperFadeClock = fadeClock) {
  let active: { audio: AudioWithSink; generation: string | null; targetVolume: number; fraction: number } | null = null;
  let cancelFade: (() => void) | null = null;
  let cancellation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const silence = () => {
    cancelFade?.(); cancelFade = null;
    const previous = active;
    active = null;
    if (previous) {
      previous.audio.muted = true;
      previous.audio.pause();
      previous.audio.removeAttribute('src');
      previous.audio.load();
    }
  };
  const handle = (request: BumperRequest) => {
    // Silence immediately on stop even when an asynchronous start is in flight.
    if (request.action === 'stop') {
      cancellation++;
      cancelFade?.(); cancelFade = null;
      if (active) { active.audio.muted = true; active.generation = null; }
    }
    const startToken = cancellation;
    const next = tail.then(async () => {
      try {
        if (request.action === 'stop') { silence(); }
        else {
          silence();
          const audio = new Audio() as AudioWithSink;
          const player = { audio, generation: null as string | null, targetVolume: Math.max(0, Math.min(1, request.volume)), fraction: 1 };
          active = player;
          // Native media events can arrive after replacing a track. Bind the
          // callback to this element instead of reading a newer generation.
          for (const type of ['ended', 'error'] as const) audio.addEventListener(type, () => {
            if (active === player && player.generation === request.generation) event({ type, generation: request.generation });
          });
          const deviceId = request.deviceId === 'default' ? '' : request.deviceId;
          if (deviceId && !audio.setSinkId) throw new Error('This audio output cannot be selected on this device.');
          if (audio.setSinkId) await audio.setSinkId(deviceId);
          if (startToken !== cancellation) throw new Error('Bumper playback was cancelled.');
          player.generation = request.generation;
          const fadeMs = Number.isFinite(request.fadeMs) ? Math.max(0, Math.min(1700, request.fadeMs!)) : 0;
          player.fraction = fadeMs ? 0 : 1;
          audio.volume = player.targetVolume * player.fraction;
          audio.src = request.src;
          audio.muted = false;
          await audio.play();
          if (startToken !== cancellation) throw new Error('Bumper playback was cancelled.');
          if (fadeMs) {
            const started = clock.now();
            cancelFade = clock.every(() => {
              if (active !== player || startToken !== cancellation) { cancelFade?.(); cancelFade = null; return; }
              player.fraction = Math.min(1, Math.max(0, (clock.now() - started) / fadeMs));
              audio.volume = player.targetVolume * player.fraction;
              if (player.fraction === 1) { cancelFade?.(); cancelFade = null; }
            });
          }
        }
        ack({ id: request.id, ok: true });
      } catch (reason) {
        silence();
        ack({ id: request.id, ok: false, error: reason instanceof Error ? reason.message : String(reason) });
      }
    });
    tail = next.catch(() => {});
  };
  return {
    handle,
    setVolume(value: number) { if (active && Number.isFinite(value)) { active.targetVolume = Math.max(0, Math.min(1, value)); active.audio.volume = active.targetVolume * active.fraction; } },
    // Call on devicechange immediately, before asynchronously validating the output.
    muteForOutputChange() {
      cancellation++;
      cancelFade?.(); cancelFade = null;
      if (active) {
        active.audio.muted = true;
        const generation = active.generation;
        active.generation = null;
        if (generation) event({ type: 'error', generation });
      }
    },
  };
}

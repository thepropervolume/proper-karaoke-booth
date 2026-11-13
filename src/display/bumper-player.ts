type AudioWithSink = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
type Start = { id: string; action: 'start'; generation: string; src: string; volume: number; deviceId: string };
export type BumperRequest = Start | { id: string; action: 'stop' };

/** One active audio element; host must serialize karaoke start behind the stop acknowledgement. */
export function createBumperPlayer(ack: (value: { id: string; ok: boolean; error?: string }) => void,
  event: (value: { type: 'ended' | 'error'; generation: string }) => void) {
  let active: { audio: AudioWithSink; generation: string | null } | null = null;
  let cancellation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const silence = () => {
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
      if (active) { active.audio.muted = true; active.generation = null; }
    }
    const startToken = cancellation;
    const next = tail.then(async () => {
      try {
        if (request.action === 'stop') { silence(); }
        else {
          silence();
          const audio = new Audio() as AudioWithSink;
          const player = { audio, generation: null as string | null };
          active = player;
          // Native media events can arrive after replacing a track. Bind the
          // callback to this element instead of reading a newer generation.
          for (const type of ['ended', 'error'] as const) audio.addEventListener(type, () => {
            if (active === player && player.generation === request.generation) event({ type, generation: request.generation });
          });
          if (!request.deviceId || request.deviceId === 'default' || !audio.setSinkId) throw new Error('An explicit audio output is required.');
          await audio.setSinkId(request.deviceId);
          if (startToken !== cancellation) throw new Error('Bumper playback was cancelled.');
          player.generation = request.generation;
          audio.volume = Math.max(0, Math.min(1, request.volume));
          audio.src = request.src;
          audio.muted = false;
          await audio.play();
          if (startToken !== cancellation) throw new Error('Bumper playback was cancelled.');
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
    setVolume(value: number) { if (active && Number.isFinite(value)) active.audio.volume = Math.max(0, Math.min(1, value)); },
    // Call on devicechange immediately, before asynchronously validating the output.
    muteForOutputChange() {
      cancellation++;
      if (active) {
        active.audio.muted = true;
        const generation = active.generation;
        active.generation = null;
        if (generation) event({ type: 'error', generation });
      }
    },
  };
}

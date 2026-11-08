type AudioWithSink = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
type Start = { id: string; action: 'start'; generation: string; src: string; volume: number; deviceId: string };
export type BumperRequest = Start | { id: string; action: 'stop' };

/** A single audio element; host must serialize karaoke start behind the stop acknowledgement. */
export function createBumperPlayer(ack: (value: { id: string; ok: boolean; error?: string }) => void,
  event: (value: { type: 'ended' | 'error'; generation: string }) => void) {
  const audio = new Audio() as AudioWithSink;
  let generation: string | null = null;
  let cancellation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  audio.addEventListener('ended', () => { if (generation) event({ type: 'ended', generation }); });
  audio.addEventListener('error', () => { if (generation) event({ type: 'error', generation }); });
  const silence = () => { audio.muted = true; audio.pause(); audio.removeAttribute('src'); audio.load(); generation = null; };
  const handle = (request: BumperRequest) => {
    // Silence immediately on stop even when an asynchronous start is in flight.
    if (request.action === 'stop') { cancellation++; audio.muted = true; }
    const startToken = cancellation;
    const next = tail.then(async () => {
      try {
        if (request.action === 'stop') { silence(); }
        else {
          if (!request.deviceId || request.deviceId === 'default' || !audio.setSinkId) throw new Error('An explicit audio output is required.');
          silence();
          await audio.setSinkId(request.deviceId);
          if (startToken !== cancellation) throw new Error('Bumper playback was cancelled.');
          generation = request.generation;
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
    setVolume(value: number) { if (Number.isFinite(value)) audio.volume = Math.max(0, Math.min(1, value)); },
    // Call on devicechange immediately, before asynchronously validating the output.
    muteForOutputChange() { cancellation++; audio.muted = true; if (generation) event({ type: 'error', generation }); },
  };
}

/** A small independent mixer so applause can overlap the karaoke player. */
export type ApplauseRequest = { id: string; volume: number; outputId: string };
export type ApplauseResult = { id: string; ok: boolean; durationMs?: number; error?: string };

const MAX_VOICES = 3;
const LEVEL = 0.45;
// Peak-calibrated for the supplied recordings. Even three maximum-volume
// clips sum below full scale, while quieter recordings remain audible.
const CLIP_GAINS = [2.3, 0.82, 1.35, 0.77, 0.75, 1.07] as const;

type RoutedContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type Voice = { source?: AudioBufferSourceNode; gain?: GainNode; clipGain?: number };

function decodeBase64(dataUrl: string): ArrayBuffer {
  const prefix = 'data:audio/mpeg;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('The applause recording is invalid.');
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function createApplausePlayer(recordings: readonly string[], createContext: () => RoutedContext = () => new AudioContext() as RoutedContext) {
  if (recordings.length !== CLIP_GAINS.length) throw new Error('Six applause recordings are required.');
  let context: RoutedContext | null = null;
  const clips = new Map<number, Promise<AudioBuffer>>();
  const voices = new Set<Voice>();
  let next = 0, revision = 0, sink = '';
  let routing: Promise<void> = Promise.resolve();

  function stop(): void {
    revision++;
    for (const voice of voices) {
      if (voice.gain) voice.gain.gain.value = 0;
      try { voice.source?.stop(); } catch { /* Already stopped. */ }
      voice.source?.disconnect();
      voice.gain?.disconnect();
    }
    voices.clear();
  }

  async function play(request: ApplauseRequest): Promise<ApplauseResult> {
    if (!request || typeof request.id !== 'string' || !request.id || typeof request.outputId !== 'string' ||
      !Number.isFinite(request.volume) || request.volume < 0 || request.volume > 1)
      return { id: request?.id ?? '', ok: false, error: 'Invalid applause request.' };
    if (voices.size >= MAX_VOICES) return { id: request.id, ok: false, error: 'Three applause tracks are already playing.' };
    const voice: Voice = {};
    voices.add(voice);
    const generation = revision;
    try {
      context ??= createContext();
      const player = context;
      const output = request.outputId === 'default' ? '' : request.outputId;
      // Serialize routing. A concurrent request may not reroute existing audio.
      const route = routing.then(async () => {
        if (generation !== revision) throw new Error('Applause was cancelled.');
        if (sink !== output) {
          if ([...voices].some(active => !!active.source)) throw new Error('Wait for applause to finish before changing the audio output.');
          if (!player.setSinkId && output) throw new Error('This platform cannot select the chosen audio output.');
          if (player.setSinkId) await player.setSinkId(output);
          sink = output;
        }
        if (player.state === 'suspended') await player.resume();
      });
      routing = route.catch(() => {});
      await route;
      if (generation !== revision || !voices.has(voice)) throw new Error('Applause was cancelled.');
      const variant = next;
      next = (next + 1) % recordings.length;
      let pendingClip = clips.get(variant);
      if (!pendingClip) {
        pendingClip = player.decodeAudioData(decodeBase64(recordings[variant]));
        clips.set(variant, pendingClip);
        void pendingClip.catch(() => { if (clips.get(variant) === pendingClip) clips.delete(variant); });
      }
      const clip = await pendingClip;
      if (generation !== revision || !voices.has(voice)) throw new Error('Applause was cancelled.');
      if (!Number.isFinite(clip.duration) || clip.duration < 3 || clip.duration > 15) throw new Error('The applause recording has an invalid duration.');
      const source = player.createBufferSource();
      const gain = player.createGain();
      voice.source = source; voice.gain = gain; voice.clipGain = CLIP_GAINS[variant];
      source.buffer = clip;
      gain.gain.value = request.volume * LEVEL * voice.clipGain;
      source.connect(gain); gain.connect(player.destination);
      source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); };
      source.start();
      return { id: request.id, ok: true, durationMs: Math.round(clip.duration * 1000) };
    } catch (error) {
      voices.delete(voice);
      voice.source?.disconnect();
      voice.gain?.disconnect();
      return { id: request.id, ok: false, error: error instanceof Error ? error.message : 'Applause could not play.' };
    }
  }

  function setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const target = Math.max(0, Math.min(1, volume)) * LEVEL;
    for (const voice of voices) if (voice.gain) voice.gain.gain.value = target * (voice.clipGain ?? 1);
  }

  return { play, stop, setVolume };
}

/** A small independent mixer so applause can overlap the karaoke player. */
export type ApplauseRequest = { id: string; volume: number; outputId: string };
export type ApplauseResult = { id: string; ok: boolean; durationMs?: number; error?: string };

const DURATIONS = [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8];
const MAX_VOICES = 3;
const LEVEL = 0.16;

type RoutedContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type Voice = { source?: AudioBufferSourceNode; gain?: GainNode };

// Each synthetic clap is a short burst with a second palm-contact transient.
// Distinct seeded timing and stereo placement create ten reproducible crowds.
function crowdClip(context: AudioContext, variant: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * DURATIONS[variant]);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  let seed = (variant + 1) * 0x2345ab;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const clapLength = Math.floor(context.sampleRate * 0.105);
  const count = Math.round(DURATIONS[variant] * (22 + variant % 4));
  for (let clap = 0; clap < count; clap++) {
    const position = Math.floor(random() * (length - clapLength));
    const pan = random(), loudness = 0.35 + random() * 0.65;
    let filtered = 0;
    for (let i = 0; i < clapLength; i++) {
      const seconds = i / context.sampleRate;
      const noise = random() * 2 - 1;
      filtered += 0.32 * (noise - filtered);
      const attack = Math.min(1, seconds / 0.0015);
      const envelope = Math.exp(-seconds * 44) + (seconds > 0.014 ? 0.48 * Math.exp(-(seconds - 0.014) * 62) : 0);
      const value = filtered * envelope * attack * loudness;
      left[position + i] += value * (0.45 + 0.55 * (1 - pan));
      right[position + i] += value * (0.45 + 0.55 * pan);
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak ? 0.85 / peak : 1;
  for (let i = 0; i < length; i++) {
    // Fade the crowd at the edges so buffers do not click.
    const edge = Math.min(1, i / (context.sampleRate * 0.035), (length - i - 1) / (context.sampleRate * 0.16));
    left[i] *= gain * edge;
    right[i] *= gain * edge;
  }
  return buffer;
}

export function createApplausePlayer(createContext: () => RoutedContext = () => new AudioContext() as RoutedContext) {
  let context: RoutedContext | null = null;
  const clips = new Map<number, AudioBuffer>();
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
      next = (next + 1) % DURATIONS.length;
      let clip = clips.get(variant);
      if (!clip) { clip = crowdClip(player, variant); clips.set(variant, clip); }
      const source = player.createBufferSource();
      const gain = player.createGain();
      voice.source = source; voice.gain = gain;
      source.buffer = clip;
      gain.gain.value = request.volume * LEVEL;
      source.connect(gain); gain.connect(player.destination);
      source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); };
      source.start();
      return { id: request.id, ok: true, durationMs: Math.round(DURATIONS[variant] * 1000) };
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
    for (const voice of voices) if (voice.gain) voice.gain.gain.value = target;
  }

  return { play, stop, setVolume };
}

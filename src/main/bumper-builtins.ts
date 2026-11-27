import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_BUMPER_TRACK, LEGACY_DEFAULT_BUMPER_TRACK } from '../domain/bumper-settings';
import type { BumperTrack } from './bumper-controller';

const tone = (frequency: number, time: number) => Math.sin(2 * Math.PI * frequency * time);
const pitch = (notes: readonly number[], time: number, beat: number) => notes[Math.floor(time / beat) % notes.length];
const ambientNotes = [220, 277.18, 329.63, 277.18];
const sunsetNotes = [392, 493.88, 587.33, 493.88, 440, 523.25, 659.25, 523.25];
const loungeNotes = [98, 98, 110, 123.47, 130.81, 130.81, 110, 123.47];

// The original alternatives have different playing styles as well as notes.
const themes = [
  { id: LEGACY_DEFAULT_BUMPER_TRACK, name: 'Soft Ambient', sound(time: number) {
    const frequency = pitch(ambientNotes, time, 2), step = time % 2;
    return Math.sin(Math.PI * step / 2) * (tone(frequency, time) * .075 + tone(frequency / 2, time) * .033);
  } },
  { id: 'builtin-sunset', name: 'Sunset Keys', sound(time: number) {
    const frequency = pitch(sunsetNotes, time, .5), step = time % .5;
    const pluck = Math.min(1, step * 60, (.5 - step) * 100) * Math.exp(-step * 6);
    return pluck * (tone(frequency, step) * .16 + tone(frequency * 2, step) * .04 + tone(frequency * 3, step) * .02);
  } },
  { id: 'builtin-lounge', name: 'Gentle Lounge', sound(time: number) {
    const frequency = pitch(loungeNotes, time, .5), beat = time % .5;
    const bass = Math.min(1, beat * 50) * Math.exp(-beat * 8) * (tone(frequency, beat) * .20 + tone(frequency * 2, beat) * .04);
    const offbeat = Math.max(0, beat - .25);
    const chord = Math.min(1, offbeat * 40) * Math.exp(-offbeat * 14) *
      (tone(frequency * 4, offbeat) + tone(frequency * 6, offbeat)) * .06;
    return (bass + chord) * Math.min(1, (.5 - beat) * 100);
  } },
];

function wave(sound: (time: number) => number): Buffer {
  const rate = 16000, seconds = 16, count = rate * seconds;
  const out = Buffer.alloc(44 + count * 2);
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const time = i / rate, envelope = Math.min(1, time * 10, (seconds - time) * 10);
    out.writeInt16LE(Math.round(sound(time) * envelope * 32767), 44 + i * 2);
  }
  return out;
}

/** Install only app-generated assets in its private directory; never overwrite an existing file. */
export function builtInBumperTracks(directory: string, zenPath?: string): BumperTrack[] {
  mkdirSync(directory, { recursive: true });
  const originals = themes.map(theme => {
    const path = join(directory, `${theme.id}-v2.wav`);
    if (existsSync(path)) return { id: theme.id, name: theme.name, path };
    try { writeFileSync(path, wave(theme.sound), { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return { id: theme.id, name: theme.name, path };
  });
  return zenPath && existsSync(zenPath) ? [{ id: DEFAULT_BUMPER_TRACK, name: 'Zen', path: zenPath }, ...originals] : originals;
}

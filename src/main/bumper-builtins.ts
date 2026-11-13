import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BumperTrack } from './bumper-controller';

// Original synthesised music, generated locally; no downloaded or third-party audio.
const themes = [
  { id: 'builtin-ambient', name: 'Soft Ambient', notes: [220, 277.18, 329.63, 277.18] },
  { id: 'builtin-sunset', name: 'Sunset Keys', notes: [196, 246.94, 293.66, 369.99] },
  { id: 'builtin-lounge', name: 'Gentle Lounge', notes: [164.81, 220, 261.63, 329.63] },
];

function wave(notes: number[]): Buffer {
  const rate = 16000, seconds = 16, count = rate * seconds;
  const out = Buffer.alloc(44 + count * 2);
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const time = i / rate, step = Math.floor(time / 2), local = time % 2;
    const envelope = Math.min(1, local * 3, (2 - local) * 2, time, seconds - time);
    const frequency = notes[step % notes.length];
    const sound = Math.sin(2 * Math.PI * frequency * time) * .10 +
      Math.sin(2 * Math.PI * frequency * .5 * time) * .045;
    out.writeInt16LE(Math.round(sound * envelope * 32767), 44 + i * 2);
  }
  return out;
}

/** Install only app-generated assets in its private directory; never overwrite an existing file. */
export function builtInBumperTracks(directory: string): BumperTrack[] {
  mkdirSync(directory, { recursive: true });
  return themes.map(theme => {
    const path = join(directory, `${theme.id}-v1.wav`);
    try { writeFileSync(path, wave(theme.notes), { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return { id: theme.id, name: theme.name, path };
  });
}

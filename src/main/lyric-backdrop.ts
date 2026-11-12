import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../domain/settings';

export const DEFAULT_LYRIC_BACKDROP_FILE = 'tpv-karaoke-v3.mp4';

/** FFmpeg needs a real file; packaged backdrops live outside app.asar. */
export function lyricBackdropPath(settings: Pick<Settings, 'lyricBackdrop' | 'lyricBackdropFile'>,
  location: { packaged: boolean; appPath: string; resourcesPath: string }): string | undefined {
  if (settings.lyricBackdrop === 'none') return undefined;
  if (settings.lyricBackdrop === 'custom') return settings.lyricBackdropFile;
  return location.packaged
    ? join(location.resourcesPath, 'backdrops', DEFAULT_LYRIC_BACKDROP_FILE)
    : join(location.appPath, 'assets', 'backdrops', DEFAULT_LYRIC_BACKDROP_FILE);
}

export async function validateLyricBackdropFile(path: string): Promise<void> {
  try {
    const file = await open(path, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size === 0) throw new Error('Not a nonempty regular file.');
    } finally { await file.close(); }
  } catch {
    throw new Error('The lyric backdrop video cannot be read. Choose another MP4 in Preferences → Singer Display, restore the bundled backdrop, or select Solid CDG Background.');
  }
}

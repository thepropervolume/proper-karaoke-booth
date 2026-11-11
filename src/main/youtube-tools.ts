import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

/** Resolve a host-selected executable or a normal absolute PATH entry; never a shell. */
export async function resolveYtDlpExecutable(selected = '', searchPath = process.env.PATH ?? ''): Promise<string> {
  const candidates = selected ? [selected] : searchPath.split(delimiter).filter(isAbsolute).map(directory => join(directory, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'));
  for (const candidate of candidates) {
    if (!isAbsolute(candidate) || /[\x00-\x1f\x7f]/.test(candidate)) continue;
    try {
      const resolved = await realpath(candidate), info = await stat(resolved);
      if (!info.isFile() || (process.platform === 'win32' && !/\.exe$/i.test(resolved))) continue;
      await access(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return resolved;
    } catch { /* Try the next normal PATH entry. */ }
  }
  throw new Error('yt-dlp was not found. Install yt-dlp and FFmpeg, add them to PATH, or choose the yt-dlp executable in Preferences.');
}

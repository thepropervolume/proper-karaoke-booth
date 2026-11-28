import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

export async function findExecutable(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (!isAbsolute(candidate) || /[\x00-\x1f\x7f]/.test(candidate)) continue;
    try {
      const resolved = await realpath(candidate);
      if (!(await stat(resolved)).isFile() || (process.platform === 'win32' && !/\.exe$/i.test(resolved))) continue;
      await access(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return resolved;
    } catch { /* Try the next absolute path. */ }
  }
  return null;
}

export function pathExecutables(name: string, searchPath = process.env.PATH ?? ''): string[] {
  const executable = process.platform === 'win32' ? name + '.exe' : name;
  return searchPath.split(delimiter).filter(isAbsolute).map(directory => join(directory, executable));
}

/** Finder does not inherit shell setup. WinGet's portable links may be added
 * after Electron starts, so also look in the known user and system locations. */
export async function findFfmpegTool(name: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
  const extra: string[] = [];
  if (process.platform === 'darwin') extra.push(join('/opt/homebrew/bin', name), join('/usr/local/bin', name));
  if (process.platform === 'win32') {
    for (const root of [process.env.LOCALAPPDATA, process.env.ProgramFiles]) {
      if (root && isAbsolute(root)) extra.push(join(root, 'Microsoft', 'WinGet', 'Links', name + '.exe'));
    }
  }
  return findExecutable([...extra, ...pathExecutables(name)]);
}

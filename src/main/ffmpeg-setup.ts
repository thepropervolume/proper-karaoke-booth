import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { findExecutable, findFfmpegTool } from './media-tool-paths';

const run = promisify(execFile);

type Installer = { name: 'Homebrew' | 'WinGet'; path: string; args: string[]; env?: NodeJS.ProcessEnv };

async function ffmpegInstaller(): Promise<Installer | null> {
  if (process.platform === 'darwin') {
    const path = await findExecutable(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
    if (path) return { name: 'Homebrew', path, args: ['install', 'ffmpeg'], env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } };
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA && isAbsolute(process.env.LOCALAPPDATA)) {
    const path = join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winget.exe');
    // The App Installer alias is a reparse point and cannot go through realpath.
    if (await access(path).then(() => true, () => false)) return { name: 'WinGet', path,
      args: ['install', '--id', 'Gyan.FFmpeg', '--exact', '--source', 'winget', '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements', '--scope', 'user'] };
  }
  return null;
}

export async function ffmpegStatus() {
  const [ffmpeg, ffprobe] = await Promise.all([findFfmpegTool('ffmpeg'), findFfmpegTool('ffprobe')]);
  return { ffmpeg: !!ffmpeg, ffprobe: !!ffprobe, installWith: ffmpeg && ffprobe ? null : (await ffmpegInstaller())?.name ?? null };
}

let pendingInstallation: Promise<void> | null = null;
/** Only a host settings action can launch the user's package manager. */
export async function installMissingFfmpeg(): Promise<void> {
  if (pendingInstallation) return pendingInstallation;
  const task = (async () => {
    const status = await ffmpegStatus();
    if (status.ffmpeg && status.ffprobe) return;
    const installer = await ffmpegInstaller();
    if (!installer) throw new Error('Install FFmpeg with your system package manager, then check again.');
    try {
      await run(installer.path, installer.args, {
        cwd: dirname(installer.path), env: installer.env, windowsHide: true,
        timeout: 10 * 60_000, maxBuffer: 1024 * 1024,
      });
    } catch { /* A package manager may report a nonzero exit if it already installed the package. */ }
    const installed = await ffmpegStatus();
    if (!installed.ffmpeg || !installed.ffprobe) throw new Error(`FFmpeg is still unavailable. Open ${installer.name} to check the installation and try again.`);
  })();
  pendingInstallation = task;
  try { await task; } finally { if (pendingInstallation === task) pendingInstallation = null; }
}

/** Permanent exact-recording downloads. Private paths and child output stay in main. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rmdir, unlink, link, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { hashImportFile } from './import-hash';
import { findFfmpegTool } from './media-tool-paths';
import { managedYtDlpOptions, ytDlpEnvironment } from './youtube-tools';

export type YouTubeDownloadInput = { versionId: string; videoId: string; title: string; artist: string; brandSlug?: string };
export type DownloadedYouTubeAsset = { versionId: string; videoId: string; path: string; fingerprint: string };
export type YouTubeDownloadProgress = { id: string; versionId: string; videoId: string;
  phase: 'preparing' | 'downloading' | 'verifying' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
  percent: number | null; message: string; cleanupNeeded: boolean };
type RunOptions = { cwd: string; signal: AbortSignal; onLine(line: string): void; managedRuntime?: boolean };
export type YouTubeDownloadRunner = (executable: string, args: string[], options: RunOptions) => Promise<void>;
export class YouTubeDownloadRunError extends Error {
  constructor(readonly cleanupSafe: boolean) { super('Download process failed.'); }
}
type Directory = { path: string; dev: number; ino: number };
class DownloadFailure extends Error {}
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const abortIfNeeded = (signal: AbortSignal) => { if (signal.aborted) throw new DownloadFailure('Download cancelled.'); };

function safeComponent(raw: string, fallback: string, max = 80): string {
  let value = raw.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').trim().replace(/[. ]+$/g, '') || fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = '_' + value;
  let result = '';
  for (const character of value) { if (result.length + character.length > max || Buffer.byteLength(result + character) > max) break; result += character; }
  return result.replace(/[. ]+$/g, '') || fallback;
}
const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
async function directoryInfo(path: string): Promise<Directory> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(path), path)) throw new DownloadFailure('Unsafe download directory.');
  return { path, dev: info.dev, ino: info.ino };
}
async function verifyDirectories(expected: Directory[]): Promise<void> {
  for (const value of expected) { const current = await directoryInfo(value.path); if (current.dev !== value.dev || current.ino !== value.ino) throw new DownloadFailure('Download directory changed.'); }
}
async function targetDirectory(base: string, input: YouTubeDownloadInput): Promise<{ parents: Directory[]; file: string }> {
  await mkdir(base, { recursive: true });
  const before = await lstat(base);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new DownloadFailure('Unsafe download directory.');
  const root = await realpath(base), parents = [await directoryInfo(root)];
  if (parents[0].dev !== before.dev || parents[0].ino !== before.ino) throw new DownloadFailure('Download directory changed.');
  const artist = safeComponent(input.artist, 'Unknown Artist'), title = safeComponent(input.title, 'Untitled');
  const components = input.brandSlug ? ['karaokenerds', 'Brands', safeComponent(input.brandSlug, 'Unknown Brand'), artist] : ['youtube', artist];
  let current = root;
  for (const component of components) {
    await verifyDirectories(parents); current = join(current, component);
    try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    parents.push(await directoryInfo(current));
  }
  return { parents, file: join(current, `${artist} - ${title}.mp4`) };
}
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function mp4Identity(path: string): Promise<void> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 12 || before.size > MAX_VIDEO_BYTES) throw new DownloadFailure('Invalid downloaded video.');
  const file = await open(path, 'r');
  try {
    const current = await file.stat(), header = Buffer.alloc(12);
    const read = await file.read(header, 0, header.length, 0);
    if (current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs || read.bytesRead !== 12 || header.toString('ascii', 4, 8) !== 'ftyp') throw new DownloadFailure('Invalid downloaded video.');
  } finally { await file.close(); }
}
async function reusable(path: string, videoId: string, signal: AbortSignal): Promise<string | null> {
  try {
    const name = `${path}.tpv.json`, info = await lstat(name);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4096) return null;
    const file = await open(name, 'r'); let text: string;
    try {
      const opened = await file.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size || opened.mtimeMs !== info.mtimeMs) return null;
      const bytes = Buffer.alloc(4097); let count = 0;
      while (count < bytes.length) { const read = await file.read(bytes, count, bytes.length - count, null); if (!read.bytesRead) break; count += read.bytesRead; }
      const after = await file.stat(), named = await lstat(name);
      if (count !== opened.size || count > 4096 || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs ||
          named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino || named.size !== opened.size || named.mtimeMs !== opened.mtimeMs) return null;
      text = new TextDecoder('utf8', { fatal: true }).decode(bytes.subarray(0, count));
    } finally { await file.close(); }
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const marker = value as Record<string, unknown>;
    if (marker.format !== 1 || marker.provider !== 'youtube' || marker.videoId !== videoId || typeof marker.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(marker.fingerprint)) return null;
    await mp4Identity(path);
    const actual = await hashImportFile(path, signal);
    return marker.fingerprint === actual ? actual : null;
  } catch { abortIfNeeded(signal); return null; }
}
async function cleanupStage(stage: Directory, parents: Directory[]): Promise<void> {
  await verifyDirectories([...parents, stage]);
  const parent = parents.at(-1)!.path;
  if (dirname(stage.path) !== parent || !basename(stage.path).startsWith('.tpv-youtube-') || relative(parents[0].path, stage.path).startsWith(`..${sep}`)) throw new DownloadFailure('Unsafe cleanup directory.');
  for (const entry of await readdir(stage.path, { withFileTypes: true })) {
    if (entry.isDirectory()) throw new DownloadFailure('Unexpected staging directory.');
    await verifyDirectories([...parents, stage]); await unlink(join(stage.path, entry.name));
  }
  await verifyDirectories([...parents, stage]); await rmdir(stage.path);
}

/** Wait for descendant termination before declaring failed/cancelled staging removable. */
export const runYouTubeDownload: YouTubeDownloadRunner = (executable, args, options) => {
  abortIfNeeded(options.signal);
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const child = spawn(executable, args, { cwd: options.cwd, windowsHide: true, detached: !windows, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      env: ytDlpEnvironment(!!options.managedRuntime) });
    let spawnFailed = false, stopping: Promise<boolean> | null = null, buffer = '', finished = false;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: YouTubeDownloadRunError) => {
      if (finished) return; finished = true;
      if (abortTimer) clearTimeout(abortTimer);
      options.signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const stopTree = (): Promise<boolean> => {
      if (stopping) return stopping;
      if (!child.pid) return stopping = Promise.resolve(true);
      if (windows) {
        stopping = new Promise<boolean>(done => {
          const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
          const timer = setTimeout(() => { killer.kill(); done(false); }, 5000);
          killer.once('error', () => { clearTimeout(timer); done(false); }); killer.once('close', code => { clearTimeout(timer); done(code === 0); });
        });
      } else {
        stopping = new Promise<boolean>(done => {
          try { process.kill(-child.pid!, 'SIGKILL'); done(true); }
          catch (error) { done((error as NodeJS.ErrnoException).code === 'ESRCH'); }
        });
      }
      return stopping;
    };
    const abort = () => {
      void stopTree().then(safe => { if (!safe) child.kill(); });
      abortTimer ??= setTimeout(() => { child.kill(); finish(new YouTubeDownloadRunError(false)); }, 7000);
    };
    options.signal.addEventListener('abort', abort, { once: true }); if (options.signal.aborted) abort();
    child.stdout.on('data', data => {
      buffer = (buffer + String(data)).slice(-8192);
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); try { options.onLine(line); } catch {} }
    });
    child.once('error', () => { spawnFailed = true; });
    child.once('close', code => {
      void (async () => {
        if (code === 0 && !options.signal.aborted) { finish(); return; }
        const safe = spawnFailed && !child.pid ? true : await stopTree();
        finish(new YouTubeDownloadRunError(safe));
      })().catch(() => finish(new YouTubeDownloadRunError(false)));
    });
  });
};

export class YouTubeDownloads {
  private progress: YouTubeDownloadProgress | null = null;
  private controller: AbortController | null = null;
  private completion: Promise<YouTubeDownloadProgress | null> | null = null;
  constructor(private readonly baseDirectory: string, private readonly executable: string,
    private readonly commit: (asset: DownloadedYouTubeAsset) => void,
    private readonly options: { run?: YouTubeDownloadRunner; timeoutMs?: number; nodeExecutable?: string } = {}) {
    if (!isAbsolute(baseDirectory) || !isAbsolute(executable)) throw new DownloadFailure('Choose absolute video-cache and yt-dlp paths.');
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30 * 60 * 1000)) throw new DownloadFailure('Invalid download timeout.');
  }
  snapshot(): YouTubeDownloadProgress | null { return this.progress && { ...this.progress }; }
  active(): boolean { return !!this.controller; }
  start(input: YouTubeDownloadInput): YouTubeDownloadProgress {
    if (this.controller) throw new DownloadFailure('A YouTube download is already in progress.');
    if (!input || typeof input.versionId !== 'string' || !input.versionId.trim() || input.versionId.length > 500 || typeof input.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(input.videoId) ||
        typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500 || typeof input.artist !== 'string' || input.artist.length > 500 || (input.brandSlug !== undefined && (typeof input.brandSlug !== 'string' || input.brandSlug.length > 200))) throw new DownloadFailure('Invalid YouTube download.');
    this.controller = new AbortController();
    this.progress = { id: randomUUID(), versionId: input.versionId, videoId: input.videoId, phase: 'preparing', percent: null, message: 'Preparing permanent video download.', cleanupNeeded: false };
    this.completion = this.run({ ...input }, this.controller); return this.snapshot()!;
  }
  cancel(id: string): boolean {
    if (!this.controller || this.progress?.id !== id || ['completed', 'failed', 'cancelled'].includes(this.progress.phase)) return false;
    this.progress.phase = 'cancelling'; this.progress.message = 'Stopping the download.'; this.controller.abort(); return true;
  }
  async wait(): Promise<YouTubeDownloadProgress | null> { return this.completion ? this.completion : this.snapshot(); }
  async shutdown(): Promise<void> { if (this.controller && this.progress) this.cancel(this.progress.id); await this.completion; }
  private async run(input: YouTubeDownloadInput, controller: AbortController): Promise<YouTubeDownloadProgress | null> {
    const progress = this.progress!; let stage: Directory | null = null, parents: Directory[] = [], cleanupSafe = true, timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 30 * 60 * 1000);
    try {
      abortIfNeeded(controller.signal);
      const destination = await targetDirectory(this.baseDirectory, input); parents = destination.parents;
      let target = destination.file;
      for (let choice = 0; choice < 2; choice++) {
        await verifyDirectories(parents); abortIfNeeded(controller.signal);
        if (await exists(target) || await exists(`${target}.tpv.json`)) {
          const fingerprint = await reusable(target, input.videoId, controller.signal);
          if (fingerprint) {
            await verifyDirectories(parents); abortIfNeeded(controller.signal);
            this.commit({ versionId: input.versionId, videoId: input.videoId, path: target, fingerprint });
            progress.phase = 'completed'; progress.percent = 100; progress.message = 'Using the saved video from the host drive.'; return this.snapshot();
          }
          if (choice === 1) throw new DownloadFailure('Both cache filenames are occupied. Choose another cache folder or review the existing files.');
          target = destination.file.slice(0, -4) + ` [${input.videoId}].mp4`; continue;
        }
        break;
      }
      await verifyDirectories(parents);
      stage = await directoryInfo(await mkdtemp(join(dirname(target), '.tpv-youtube-')));
      progress.phase = 'downloading'; progress.message = 'Downloading video to the host drive.';
      let identityConfirmed = false, wrongIdentity = false;
      const ffmpeg = await findFfmpegTool('ffmpeg');
      abortIfNeeded(controller.signal);
      const args = ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-simulate', '--no-overwrites', '--no-write-info-json', '--no-write-thumbnail', '--no-write-subs', '--no-write-auto-subs',
        ...managedYtDlpOptions(this.options.nodeExecutable), ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
        '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2', '--max-filesize', '2G', '--newline', '--quiet', '--no-warnings', '--progress', '--progress-delta', '0.5',
        '--print', 'before_dl:TPV_ID:%(id)s', '--progress-template', 'download:TPV_PROGRESS:%(progress._percent_str)s',
        '--format', (ffmpeg ? 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec^=mp4a]/' : '') + 'best[ext=mp4][vcodec^=avc1][acodec^=mp4a]',
        '--merge-output-format', 'mp4', '--output', 'video.%(ext)s', '--', `https://www.youtube.com/watch?v=${input.videoId}`];
      cleanupSafe = false;
      try {
        await (this.options.run ?? runYouTubeDownload)(this.executable, args, { cwd: stage.path, signal: controller.signal, managedRuntime: !!this.options.nodeExecutable, onLine: line => {
          if (line.startsWith('TPV_ID:')) { if (line === `TPV_ID:${input.videoId}`) identityConfirmed = true; else wrongIdentity = true; }
          const match = /^TPV_PROGRESS:\s*(\d+(?:\.\d+)?)%$/.exec(line);
          if (match && !controller.signal.aborted) progress.percent = Math.max(0, Math.min(100, Number(match[1])));
        } });
        cleanupSafe = true;
      } catch (error) { if (error instanceof YouTubeDownloadRunError) cleanupSafe = error.cleanupSafe; throw new DownloadFailure('yt-dlp could not download this video. Check yt-dlp/FFmpeg installation, the connection and video availability, then retry.'); }
      abortIfNeeded(controller.signal);
      if (!identityConfirmed || wrongIdentity) throw new DownloadFailure('The download did not confirm the selected YouTube recording.');
      progress.phase = 'verifying'; progress.message = 'Verifying the saved video.';
      await verifyDirectories([...parents, stage]); const video = join(stage.path, 'video.mp4'); await mp4Identity(video);
      const fingerprint = await hashImportFile(video, controller.signal); abortIfNeeded(controller.signal);
      await writeFile(join(stage.path, 'ownership.json'), JSON.stringify({ format: 1, provider: 'youtube', videoId: input.videoId, fingerprint }) + '\n', { flag: 'wx', mode: 0o600 });
      await verifyDirectories([...parents, stage]); abortIfNeeded(controller.signal);
      // Exclusive links never replace existing files. If second publication or
      // persistence fails, retain completed bytes for operator recovery.
      await link(video, target);
      await link(join(stage.path, 'ownership.json'), `${target}.tpv.json`);
      abortIfNeeded(controller.signal);
      this.commit({ versionId: input.versionId, videoId: input.videoId, path: target, fingerprint });
      progress.phase = 'completed'; progress.percent = 100; progress.message = 'Video saved permanently on the host drive.';
    } catch (error) {
      progress.phase = controller.signal.aborted && !timedOut ? 'cancelled' : 'failed';
      progress.message = timedOut ? 'Video download exceeded 30 minutes. Retry when the connection is available.' : controller.signal.aborted ? 'Video download cancelled.' :
        error instanceof DownloadFailure ? error.message : 'Video download failed. Check the destination and available disk space, then retry.';
    } finally {
      clearTimeout(timeout);
      if (stage && cleanupSafe) { try { await cleanupStage(stage, parents); } catch { progress.cleanupNeeded = true; } }
      else if (stage) progress.cleanupNeeded = true;
      if (progress.cleanupNeeded) progress.message += ' Temporary files were preserved because cleanup needs attention.';
      this.controller = null;
    }
    return this.snapshot();
  }
}

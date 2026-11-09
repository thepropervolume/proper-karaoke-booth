/** Host-only yt-dlp adapter. Never invoke a shell or expose yt-dlp output to renderers. */
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rmdir, unlink, link } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { youtubeVideoId } from '../catalog/karaokenerds-brand-map';
import { cachedVideoPath, type CacheVideo } from './karaokenerds-cache-plan';

type RunOptions = { cwd?: string; signal?: AbortSignal; timeout: number };
export type YtDlpRunner = (executable: string, args: string[], options: RunOptions) => Promise<{ stdout: string }>;
const execFileAsync = promisify(execFile);
const runDefault: YtDlpRunner = async (executable, args, options) => {
  const output = await execFileAsync(executable, args, { ...options, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return { stdout: output.stdout };
};
const COMMON = ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-progress'];
const DEFAULT_TIMEOUT = 10 * 60 * 1000;

function request(executable: string, watchUrl: string, timeout = DEFAULT_TIMEOUT): { id: string; url: string; timeout: number } {
  const id = youtubeVideoId(watchUrl);
  if (!path.isAbsolute(executable) || !id || !Number.isInteger(timeout) || timeout < 1000 || timeout > DEFAULT_TIMEOUT)
    throw new Error('Invalid yt-dlp request.');
  return { id, url: `https://www.youtube.com/watch?v=${id}`, timeout };
}

function dateField(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null;
  const formatted = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${formatted}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === formatted ? formatted : null;
}

export type YtDlpMetadata = { youtubeId: string; uploadDate: string | null; releaseDate: string | null; provenance: 'yt-dlp' };
/** yt-dlp's upload/release fields are not treated as confirmed publication dates. */
export async function inspectYtDlpVideo(executable: string, watchUrl: string,
  options: { signal?: AbortSignal; timeoutMs?: number; run?: YtDlpRunner } = {}): Promise<YtDlpMetadata> {
  const { id, url, timeout } = request(executable, watchUrl, options.timeoutMs);
  if (options.signal?.aborted) throw new Error('Video inspection cancelled.');
  try {
    const { stdout } = await (options.run ?? runDefault)(executable,
      [...COMMON, '--skip-download', '--dump-single-json', '--', url], { timeout, signal: options.signal });
    const value: unknown = JSON.parse(stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (record.id !== id || record._type === 'playlist' || record._type === 'multi_video') throw new Error();
    return { youtubeId: id, uploadDate: dateField(record.upload_date), releaseDate: dateField(record.release_date), provenance: 'yt-dlp' };
  } catch { throw new Error(options.signal?.aborted ? 'Video inspection cancelled.' : 'Video inspection failed.'); }
}

type Directory = { path: string; dev: number; ino: number };
function samePath(a: string, b: string): boolean { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
async function inspectDirectory(directory: string): Promise<Directory> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(directory), directory)) throw new Error('Unsafe cache directory.');
  return { path: directory, dev: info.dev, ino: info.ino };
}
async function verifyDirectories(directories: readonly Directory[]): Promise<void> {
  for (const expected of directories) {
    const actual = await inspectDirectory(expected.path);
    if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error('Cache directory changed.');
  }
}
async function ensureDestination(base: string, video: CacheVideo): Promise<{ target: string; directories: Directory[] }> {
  if (!path.isAbsolute(base)) throw new Error('Invalid cache directory.');
  const baseInfo = await lstat(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new Error('Unsafe cache directory.');
  const root = await realpath(base);
  const directories: Directory[] = [await inspectDirectory(root)];
  if (baseInfo.dev !== directories[0].dev || baseInfo.ino !== directories[0].ino) throw new Error('Cache directory changed.');
  const target = cachedVideoPath(root, video);
  let current = root;
  const relativeParent = path.relative(root, path.dirname(target));
  if (!relativeParent || path.isAbsolute(relativeParent) || relativeParent.split(path.sep).includes('..')) throw new Error('Invalid cache directory.');
  for (const name of relativeParent.split(path.sep)) {
    await verifyDirectories(directories);
    current = path.join(current, name);
    try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    directories.push(await inspectDirectory(current));
  }
  await verifyDirectories(directories);
  return { target, directories };
}

async function cleanupStage(stage: Directory, parents: Directory[]): Promise<void> {
  await verifyDirectories([...parents, stage]);
  // Do not recurse into directories or follow a substituted staging path.
  for (const entry of await readdir(stage.path, { withFileTypes: true })) {
    if (entry.isDirectory()) throw new Error('Unexpected staging directory.');
    await verifyDirectories([...parents, stage]);
    await unlink(path.join(stage.path, entry.name));
  }
  await verifyDirectories([...parents, stage]);
  await rmdir(stage.path);
}

export type VideoDownloadResult = { status: 'downloaded' | 'exists' | 'cancelled'; path: string; cleanupNeeded: boolean };
/** Downloads to an isolated sibling directory and publishes with an exclusive hard link. */
export async function downloadYtDlpVideo(input: { executable: string; watchUrl: string; baseDirectory: string; video: CacheVideo },
  options: { signal?: AbortSignal; timeoutMs?: number; run?: YtDlpRunner } = {}): Promise<VideoDownloadResult> {
  const { id, url, timeout } = request(input.executable, input.watchUrl, options.timeoutMs);
  if (input.video.id !== id || input.video.extension.replace(/^\./, '').toLowerCase() !== 'mp4') throw new Error('Invalid yt-dlp request.');
  if (options.signal?.aborted) return { status: 'cancelled', path: '', cleanupNeeded: false };
  let target = '', directories: Directory[] = [], stage: Directory | undefined, status: VideoDownloadResult['status'] = 'cancelled', failed = false;
  let commandStarted = false, commandCompleted = false;
  try {
    ({ target, directories } = await ensureDestination(input.baseDirectory, input.video));
    try { await lstat(target); return { status: 'exists', path: target, cleanupNeeded: false }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await verifyDirectories(directories);
    const stagePath = await mkdtemp(path.join(path.dirname(target), '.tpv-yt-'));
    stage = await inspectDirectory(stagePath);
    commandStarted = true;
    await (options.run ?? runDefault)(input.executable, [...COMMON, '--no-overwrites', '--no-write-info-json',
      '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]', '--merge-output-format', 'mp4',
      '--output', 'video.%(ext)s', '--', url], { cwd: stage.path, signal: options.signal, timeout });
    commandCompleted = true;
    if (options.signal?.aborted) { status = 'cancelled'; }
    else {
      await verifyDirectories([...directories, stage]);
      const stagedFile = path.join(stage.path, 'video.mp4');
      const before = await lstat(stagedFile);
      if (!before.isFile() || before.isSymbolicLink() || before.size < 12) throw new Error('Invalid video.');
      const handle = await open(stagedFile, 'r');
      try {
        const info = await handle.stat(); const header = Buffer.alloc(12);
        const read = await handle.read(header, 0, header.length, 0);
        if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || read.bytesRead !== 12 || header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Invalid video.');
      } finally { await handle.close(); }
      await verifyDirectories([...directories, stage]);
      try { await link(stagedFile, target); status = 'downloaded'; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') status = 'exists'; else throw error; }
    }
  } catch { if (options.signal?.aborted) status = 'cancelled'; else failed = true; }
  // A rejected or aborted yt-dlp may have left a descendant ffmpeg process
  // running. Preserve the stage until an operator can confirm it is idle.
  let cleanupNeeded = Boolean(stage && commandStarted && !commandCompleted);
  if (stage && !cleanupNeeded) { try { await cleanupStage(stage, directories); } catch { cleanupNeeded = true; } }
  if (failed) throw new Error(cleanupNeeded ? 'Video download failed; temporary cleanup needs attention.' : 'Video download failed.');
  return { status, path: target, cleanupNeeded };
}

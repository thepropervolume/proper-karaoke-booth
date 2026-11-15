/** Experimental MP3/LRC rendering proof. This is not connected to the importer. */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { link, lstat, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { parseLrc } from '../domain/lrc';
import { exportLrcWebVtt } from '../domain/lrc-vtt';

const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
const MAX_LRC_BYTES = 1024 * 1024;
const MAX_BACKDROP_BYTES = 512 * 1024 * 1024;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('LRC conversion cancelled.');
}

async function run(program: string, args: string[], cwd: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
  checkAbort(signal);
  return new Promise((resolveRun, reject) => {
    const child = spawn(program, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', failure: Error | undefined;
    const stop = () => child.kill('SIGKILL');
    const abort = () => { failure = new Error('LRC conversion cancelled.'); stop(); };
    const timer = setTimeout(() => { failure = new Error(`${program} timed out.`); stop(); }, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 65536) { failure = new Error(`${program} output exceeds limit.`); stop(); }
    });
    child.stderr.resume();
    child.on('error', error => { failure = new Error(`Could not start ${program}: ${error.message}`); });
    child.on('close', code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${program} could not process the input (exit ${code}).`));
      else resolveRun(output);
    });
  });
}

async function stage(source: string, destination: string, maxBytes: number, signal: AbortSignal): Promise<void> {
  const initial = await lstat(source);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size < 1 || initial.size > maxBytes)
    throw new Error('Input must be a nonempty regular file within the size limit.');
  const file = await open(source, 'r');
  try {
    const opened = await file.stat();
    if (opened.dev !== initial.dev || opened.ino !== initial.ino || opened.size !== initial.size || opened.mtimeMs !== initial.mtimeMs)
      throw new Error('Input changed before staging.');
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new Error('Input exceeds size limit.') : null, chunk);
    } });
    await pipeline(file.createReadStream({ autoClose: false }), bounded, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
    const [after, named] = await Promise.all([file.stat(), lstat(source)]);
    if (bytes !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs ||
        !named.isFile() || named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino || named.size !== opened.size || named.mtimeMs !== opened.mtimeMs)
      throw new Error('Input changed during staging.');
  } finally { await file.close(); }
}

export type LrcConversionProof = { audio: string; lyrics: string; backdrop: string; output: string; signal: AbortSignal };
type Hooks = { beforeCleanup?: () => void };

/** A cleanup error must not hide whether the final output was published. */
export class LrcConversionCleanupError extends Error {
  constructor(readonly published: boolean, readonly operationError: unknown, cause: unknown) {
    super('LRC conversion temporary-file cleanup failed.', { cause });
  }
}

/**
 * Produce a line-timed, burned-in-lyrics MP4 for experiments. Input originals
 * remain unchanged. Enhanced word markers are ignored and reported; this is
 * not word highlighting. FFmpeg must provide libass, H.264 and AAC support.
 * Files are staged under the output directory and output is installed using an
 * exclusive hard link so an existing file is never replaced.
 */
export async function convertLrcProof(options: LrcConversionProof, hooks: Hooks = {}): Promise<{ durationMs: number; enhancedTimingOmitted: boolean }> {
  const { signal } = options;
  checkAbort(signal);
  const output = resolve(options.output);
  const directory = await mkdtemp(join(dirname(output), '.tpv-lrc-proof-'));
  let published = false, operationError: unknown;
  try {
    await stage(resolve(options.audio), join(directory, 'audio.mp3'), MAX_AUDIO_BYTES, signal);
    await stage(resolve(options.lyrics), join(directory, 'lyrics.lrc'), MAX_LRC_BYTES, signal);
    await stage(resolve(options.backdrop), join(directory, 'backdrop.mp4'), MAX_BACKDROP_BYTES, signal);
    checkAbort(signal);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(join(directory, 'lyrics.lrc')));
    const parsed = parseLrc(source);
    const info = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', 'audio.mp3'], directory, signal, 20000);
    const probe: { streams?: { codec_name?: string }[]; format?: { duration?: string } } = JSON.parse(info);
    const durationMs = Math.floor(Number(probe.format?.duration) * 1000);
    if (probe.streams?.[0]?.codec_name !== 'mp3' || !Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS)
      throw new Error('The audio must be an MP3 with a bounded duration.');
    const vtt = exportLrcWebVtt(parsed, durationMs);
    await writeFile(join(directory, 'lyrics.vtt'), vtt.text, { flag: 'wx', mode: 0o600 });
    // All filter names and paths are fixed, so lyric text never becomes filter syntax.
    await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-n',
      '-protocol_whitelist', 'file,pipe', '-stream_loop', '-1', '-i', 'backdrop.mp4',
      '-protocol_whitelist', 'file,pipe', '-i', 'audio.mp3',
      '-filter_complex', '[0:v]fps=25,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,subtitles=lyrics.vtt,format=yuv420p[video]',
      '-map', '[video]', '-map', '1:a:0', '-t', String(durationMs / 1000), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'rendered.mp4'], directory, signal, 30 * 60 * 1000);
    checkAbort(signal);
    await link(join(directory, 'rendered.mp4'), output);
    published = true;
    return { durationMs, enhancedTimingOmitted: vtt.enhancedTimingOmitted };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try { hooks.beforeCleanup?.(); await rm(directory, { recursive: true, force: true }); }
    catch (error) { throw new LrcConversionCleanupError(published, operationError, error); }
  }
}

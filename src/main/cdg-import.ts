import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, rename, rm, copyFile, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, sep } from 'node:path';
import { crc32 } from 'node:zlib';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import { hashImportFile } from './import-hash';

export type CdgProgress = { id: string; phase: 'preparing' | 'converting' | 'importing' | 'completed' | 'cancelled' | 'failed'; name: string; seconds: number; message: string };
const AUDIO_LIMIT = 256 * 1024 * 1024, CDG_LIMIT = 32 * 1024 * 1024;
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new Error('Import cancelled.'); };

/** Select exactly one sibling pair. Case-insensitive duplicates are ambiguous. */
export async function resolveCdgPair(selected: string): Promise<{ audio: string; graphics: string }> {
  const extension = extname(selected).toLowerCase();
  if (extension !== '.mp3' && extension !== '.cdg') throw new Error('Choose a CDG, MP3 or ZIP file.');
  const stem = basename(selected, extname(selected)).toLowerCase();
  const siblings = await readdir(dirname(selected));
  const find = (suffix: string) => {
    const matches = siblings.filter(name => name.toLowerCase() === stem + suffix);
    if (matches.length !== 1) throw new Error('A unique MP3 and CDG with the same name must be in the same folder.');
    return join(dirname(selected), matches[0]);
  };
  const pair = { audio: find('.mp3'), graphics: find('.cdg') };
  for (const [path, limit] of [[pair.audio, AUDIO_LIMIT], [pair.graphics, CDG_LIMIT]] as const) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > limit) throw new Error('The pair must contain regular files within the import size limits.');
  }
  return pair;
}

/** ZIP paths are never extracted as paths: only two validated entries get fixed names. */
export async function extractCdgZip(selected: string, directory: string, signal: AbortSignal): Promise<{ audio: string; graphics: string; metadataName: string }> {
  const info = await lstat(selected);
  if (!info.isFile() || info.isSymbolicLink() || info.size > AUDIO_LIMIT + CDG_LIMIT) throw new Error('Choose a regular ZIP smaller than 288 MiB.');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(selected, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, file) => error ? reject(error) : resolve(file)));
  try {
    const entries = await new Promise<yauzl.Entry[]>((resolve, reject) => {
      const found: yauzl.Entry[] = []; let count = 0;
      const failed = (error: Error) => { zip.removeAllListeners('entry'); reject(error); };
      zip.once('error', failed);
      zip.once('end', () => { zip.removeListener('error', failed); resolve(found); });
      zip.on('entry', entry => {
        if (++count > 1000 || signal.aborted) { failed(new Error('ZIP has too many entries or import was cancelled.')); return; }
        const name: string = entry.fileName;
        if (name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(part => part === '..') || (entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000) {
          failed(new Error('ZIP contains an unsafe path or symbolic link.')); return;
        }
        if (/\.(mp3|cdg)$/i.test(name)) found.push(entry);
        zip.readEntry();
      });
      zip.readEntry();
    });
    checkAbort(signal);
    const audioEntry = entries.filter(entry => /\.mp3$/i.test(entry.fileName));
    const graphicEntry = entries.filter(entry => /\.cdg$/i.test(entry.fileName));
    if (audioEntry.length !== 1 || graphicEntry.length !== 1 || audioEntry[0].fileName.slice(0, -4).toLowerCase() !== graphicEntry[0].fileName.slice(0, -4).toLowerCase()) throw new Error('ZIP must contain exactly one matching MP3/CDG pair in the same directory.');
    const extract = async (entry: yauzl.Entry, path: string, limit: number) => {
      if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod) || !entry.uncompressedSize || entry.uncompressedSize > limit) throw new Error('ZIP uses encryption, unsupported compression or exceeds import size limits.');
      const input = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
      let bytes = 0, checksum = 0;
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; checksum = crc32(chunk, checksum); callback(bytes > limit ? new Error('ZIP entry exceeds size limit.') : null, chunk); } });
      await pipeline(input, bound, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
      if (checksum !== entry.crc32) throw new Error('ZIP entry failed its integrity check.');
    };
    const audio = join(directory, 'audio.mp3'), graphics = join(directory, 'lyrics.cdg');
    await extract(audioEntry[0], audio, AUDIO_LIMIT); await extract(graphicEntry[0], graphics, CDG_LIMIT);
    return { audio, graphics, metadataName: audioEntry[0].fileName };
  } finally { zip.close(); }
}

/** A child process, never a shell. Cancellation waits for exit before deleting its files. */
export function convertCdg(audio: string, graphics: string, output: string, signal: AbortSignal, progress: (seconds: number) => void): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-f', 'cdg', '-i', graphics, '-protocol_whitelist', 'file,pipe', '-f', 'mp3', '-i', audio,
      '-map', '0:v:0', '-map', '1:a:0', '-vf', 'fps=25,scale=600:432:flags=neighbor,format=yuv420p,tpad=stop_mode=clone:stop_duration=7200',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let spawnError = false, timedOut = false, buffer = '';
    const abort = () => { child.kill('SIGKILL'); };
    const timer = setTimeout(() => { timedOut = true; abort(); }, 30 * 60 * 1000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', chunk => {
      buffer = (buffer + String(chunk)).slice(-4096);
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line.startsWith('out_time_us=')) { const seconds = Number(line.slice(12)) / 1e6; if (Number.isFinite(seconds) && seconds >= 0) progress(seconds); }
      }
    });
    child.stderr.resume();
    child.on('error', () => { spawnError = true; });
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(new Error('Import cancelled.'));
      else if (spawnError) reject(new Error('FFmpeg was not found. Install an FFmpeg build with CD Graphics, H.264 and AAC support and add it to PATH.'));
      else if (timedOut) reject(new Error('Conversion exceeded 30 minutes.'));
      else if (code !== 0) reject(new Error('FFmpeg could not decode this pair. Check that the audio and CDG are valid and matching.'));
      else resolve();
    });
  });
}

export class CdgImport {
  private progress: CdgProgress | null = null;
  private controller: AbortController | null = null;
  private completion: Promise<void> | null = null;
  constructor(private readonly root: string, private readonly commit: (path: string, fingerprint: string, metadataPath: string) => 'imported' | 'duplicate') {}
  snapshot(): CdgProgress | null { return this.progress && { ...this.progress }; }
  active(): boolean { return !!this.controller; }
  start(selected: string): CdgProgress {
    if (this.controller) throw new Error('A CD+G import is already in progress.');
    this.controller = new AbortController();
    this.progress = { id: randomUUID(), phase: 'preparing', name: basename(selected), seconds: 0, message: '' };
    this.completion = this.run(selected, this.controller);
    return this.snapshot()!;
  }
  cancel(id: string): boolean { if (!this.controller || this.progress?.id !== id) return false; this.controller.abort(); return true; }
  async shutdown(): Promise<void> { this.controller?.abort(); await this.completion; }
  private async run(selected: string, controller: AbortController): Promise<void> {
    const progress = this.progress!; let directory: string | null = null, retain = false;
    try {
      await mkdir(this.root, { recursive: true }); checkAbort(controller.signal);
      directory = await mkdtemp(join(this.root, 'track-'));
      let audio: string, graphics: string, metadataPath = selected;
      if (extname(selected).toLowerCase() === '.zip') {
        const pair = await extractCdgZip(selected, directory, controller.signal);
        ({ audio, graphics } = pair); metadataPath = join(dirname(selected), pair.metadataName);
      } else {
        const pair = await resolveCdgPair(selected); checkAbort(controller.signal);
        audio = join(directory, 'audio.mp3'); graphics = join(directory, 'lyrics.cdg');
        await copyFile(pair.audio, audio); checkAbort(controller.signal); await copyFile(pair.graphics, graphics);
      }
      const info = await lstat(graphics);
      if (!info.size || info.size % 24 !== 0) throw new Error('CDG data must contain complete 24-byte packets.');
      checkAbort(controller.signal); progress.phase = 'converting';
      const temporary = join(directory, 'converting.mp4');
      await convertCdg(audio, graphics, temporary, controller.signal, seconds => { progress.seconds = seconds; });
      checkAbort(controller.signal); progress.phase = 'importing';
      const path = join(directory, 'track.mp4'); await rename(temporary, path);
      const fingerprint = await hashImportFile(path, controller.signal); checkAbort(controller.signal);
      // Once persistence starts the commit outcome may be uncertain. Retain the
      // complete asset if it throws so a durable row never points at deleted bytes.
      retain = true;
      const outcome = this.commit(path, fingerprint, metadataPath);
      if (outcome === 'duplicate') retain = false;
      progress.phase = 'completed'; progress.message = outcome === 'duplicate' ? 'Already in the library.' : 'Imported into Song Library. Sources were left unchanged.';
    } catch (error) {
      progress.phase = controller.signal.aborted ? 'cancelled' : 'failed';
      progress.message = controller.signal.aborted ? 'Import cancelled.' : error instanceof Error ? error.message : 'CD+G import failed.';
    } finally {
      // This directory is created exclusively by this job; archive paths are never used for cleanup.
      if (directory && !retain) {
        try {
          const root = await realpath(this.root), target = await realpath(directory);
          const identity = await lstat(directory);
          if (!target.startsWith(root + sep) || dirname(target) !== root || identity.isSymbolicLink()) throw new Error('Unsafe cleanup path.');
          await rm(directory, { recursive: true, force: true });
        } catch { progress.message += ' Temporary files could not be removed.'; }
      }
      else if (directory) await Promise.all(['audio.mp3', 'lyrics.cdg'].map(name => rm(join(directory!, name), { force: true }).catch(() => {})));
      this.controller = null;
    }
  }
}

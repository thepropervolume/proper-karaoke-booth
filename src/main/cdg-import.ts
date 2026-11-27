import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, rename, rm, open, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, sep } from 'node:path';
import { crc32 } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import { hashImportFile } from './import-hash';
import { runFfmpegConversion } from './ffmpeg-conversion';
import { convertLrc, LRC_BYTE_LIMIT, resolveLrcPair, useLrcPair } from './lrc-import';

export type CdgProgress = { id: string; phase: 'preparing' | 'converting' | 'importing' | 'completed' | 'cancelled' | 'failed'; name: string; seconds: number; message: string; outcome?: 'imported' | 'duplicate' };
const AUDIO_LIMIT = 256 * 1024 * 1024, CDG_LIMIT = 32 * 1024 * 1024;
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new Error('Import cancelled.'); };

/** Bound copied bytes and refuse source replacement during asynchronous staging. */
async function copyAsset(source: string, destination: string, limit: number, signal: AbortSignal): Promise<void> {
  const named = await lstat(source);
  if (!named.isFile() || named.isSymbolicLink() || !named.size || named.size > limit) throw new Error('Source pair is invalid or exceeds size limits.');
  const file = await open(source, 'r');
  try {
    const start = await file.stat();
    if (start.dev !== named.dev || start.ino !== named.ino || start.size !== named.size || start.mtimeMs !== named.mtimeMs) throw new Error('Source changed before import.');
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > limit ? new Error('Source exceeds size limits.') : null, chunk); } });
    await pipeline(file.createReadStream({ autoClose: false }), bounded, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
    const end = await file.stat(), stillNamed = await lstat(source);
    if (bytes !== start.size || end.size !== start.size || end.mtimeMs !== start.mtimeMs || end.ctimeMs !== start.ctimeMs ||
        stillNamed.isSymbolicLink() || stillNamed.dev !== start.dev || stillNamed.ino !== start.ino || stillNamed.size !== start.size || stillNamed.mtimeMs !== start.mtimeMs) throw new Error('Source changed during import.');
  } finally { await file.close(); }
}

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

/**
 * Derive an indexed alpha mask, never a chroma key. Three mask packets represent
 * each original packet: two grayscale palettes then the unchanged drawing opcode.
 * FFmpeg owns tile/XOR/scroll decoding for both streams, so colors and mask share
 * the same pixel-index semantics. Mask timestamps are compressed by three later.
 */
async function writeCdgAlphaMask(source: string, destination: string, signal: AbortSignal, created: (identity: { dev: number; ino: number }) => void): Promise<void> {
  const input = await open(source, 'r');
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const info = await input.stat();
    if (!info.isFile() || !info.size || info.size > CDG_LIMIT || info.size % 24) throw new Error('CDG data must contain complete 24-byte packets within the import limit.');
    output = await open(destination, 'wx', 0o600);
    const identity = await output.stat(); created({ dev: identity.dev, ino: identity.ino });
    const pendingAlpha = Array<number>(16).fill(255), activeAlpha = Array<number>(16).fill(0);
    let background = 0;
    const sourceBuffer = Buffer.alloc(24 * 1024), expanded = Buffer.alloc(24 * 1024 * 3);
    let consumed = 0;
    while (consumed < info.size) {
      checkAbort(signal);
      const { bytesRead } = await input.read(sourceBuffer, 0, Math.min(sourceBuffer.length, info.size - consumed), consumed);
      if (!bytesRead || bytesRead % 24) throw new Error('CDG data changed while preparing the backdrop.');
      for (let offset = 0; offset < bytesRead; offset += 24) {
        const packet = sourceBuffer.subarray(offset, offset + 24), instruction = packet[1] & 63;
        const recognized = (packet[0] & 63) === 9;
        if (recognized && instruction === 1 && !(packet[5] & 15)) background = packet[4] & 15;
        if (recognized && instruction === 28) for (let i = 0; i < 16; i++) pendingAlpha[i] = 255 - ((packet[4 + i] & 63) << 2);
        if (recognized && (instruction === 30 || instruction === 31)) {
          const first = instruction === 30 ? 0 : 8;
          for (let i = first; i < first + 8; i++) activeAlpha[i] = pendingAlpha[i];
        }
        const base = offset * 3;
        expanded.fill(0, base, base + 72);
        for (let half = 0; half < 2; half++) {
          const mask = expanded.subarray(base + half * 24, base + (half + 1) * 24);
          mask[0] = 9; mask[1] = 30 + half;
          for (let i = 0; i < 8; i++) {
            const index = half * 8 + i, level = index === background ? 0 : Math.round(activeAlpha[index] / 17);
            const color = level * 0x111;
            mask[4 + 2 * i] = color >> 6; mask[5 + 2 * i] = color & 63;
          }
        }
        if (recognized && ![28, 30, 31].includes(instruction)) packet.copy(expanded, base + 48);
        else expanded[base + 48] = 9; // Command 9 / instruction 0 emits an unchanged frame.
      }
      const length = bytesRead * 3;
      let written = 0;
      while (written < length) { checkAbort(signal); written += (await output.write(expanded, written, length - written)).bytesWritten; }
      consumed += bytesRead;
    }
    const after = await input.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('CDG data changed while preparing the backdrop.');
  } finally { await output?.close(); await input.close(); }
}

/** A child process, never a shell. Cancellation waits for exit before deleting its files. */
export async function convertCdg(audio: string, graphics: string, output: string, signal: AbortSignal, progress: (seconds: number) => void, backdropPath?: string): Promise<void> {
  checkAbort(signal);
  const maskPath = `${output}.alpha.cdg`;
  let maskIdentity: { dev: number; ino: number } | undefined;
  try {
    if (backdropPath) {
      try { const backdrop = await lstat(backdropPath); if (!backdrop.isFile() || !backdrop.size) throw new Error(); }
      catch { throw new Error('The selected lyric backdrop is unavailable. Choose another backdrop or disable it in Preferences, then retry the import.'); }
      await writeCdgAlphaMask(graphics, maskPath, signal, identity => { maskIdentity = identity; });
    }
    checkAbort(signal);
    const inputs = ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-f', 'cdg', '-i', graphics, '-protocol_whitelist', 'file,pipe', '-f', 'mp3', '-i', audio];
    const plain = ['-map', '0:v:0', '-map', '1:a:0', '-vf', 'fps=25,scale=600:432:flags=neighbor,format=yuv420p,tpad=stop_mode=clone:stop_duration=7200'];
    const composite = [
      '-protocol_whitelist', 'file,pipe', '-f', 'cdg', '-i', maskPath,
      '-protocol_whitelist', 'file,pipe', '-stream_loop', '-1', '-f', 'mov', '-i', backdropPath ?? '',
      '-filter_complex',
      '[0:v]fps=25:start_time=0,format=rgb24,scale=1000:720:flags=neighbor,setsar=1,tpad=stop_mode=clone:stop_duration=7200[colors];' +
      "[2:v]select='eq(mod(n,3),2)',setpts=PTS/3-2/(900*TB),fps=25:start_time=0,format=gray," +
      'drawbox=x=0:y=0:w=iw:h=12:color=black:t=fill,drawbox=x=0:y=ih-12:w=iw:h=12:color=black:t=fill,' +
      'drawbox=x=0:y=0:w=6:h=ih:color=black:t=fill,drawbox=x=iw-6:y=0:w=6:h=ih:color=black:t=fill,' +
      'scale=1000:720:flags=neighbor,setsar=1,tpad=stop_mode=clone:stop_duration=7200[mask];' +
      '[colors][mask]alphamerge[lyrics];' +
      '[3:v]setpts=PTS-STARTPTS,fps=25,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1[backdrop];' +
      '[backdrop][lyrics]overlay=x=(W-w)/2:y=(H-h)/2:format=auto,format=yuv420p[video]',
      '-map', '[video]', '-map', '1:a:0',
    ];
    await runFfmpegConversion([
      ...inputs, ...(backdropPath ? composite : plain),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
    ], output, signal, progress, {
      installMessage: 'FFmpeg was not found. Install an FFmpeg build with CD Graphics, H.264 and AAC support and add it to PATH.',
      decodeMessage: backdropPath
        ? 'FFmpeg could not render this CDG pair with the selected backdrop. Check the pair and backdrop video, or disable the backdrop in Preferences and retry.'
        : 'FFmpeg could not decode this pair. Check that the audio and CDG are valid and matching.',
    });
  } finally {
    if (maskIdentity) {
      const current = await lstat(maskPath).catch(() => null);
      if (current?.isFile() && !current.isSymbolicLink() && current.dev === maskIdentity.dev && current.ino === maskIdentity.ino) await rm(maskPath, { force: true });
    }
  }
}

export class CdgImport {
  private progress: CdgProgress | null = null;
  private controller: AbortController | null = null;
  private completion: Promise<void> | null = null;
  constructor(private readonly root: string, private readonly commit: (path: string, fingerprint: string, metadataPath: string) => 'imported' | 'duplicate') {}
  snapshot(): CdgProgress | null { return this.progress && { ...this.progress }; }
  active(): boolean { return !!this.controller; }
  start(selected: string, backdropPath?: string): CdgProgress {
    if (this.controller) throw new Error('A karaoke pair import is already in progress.');
    this.controller = new AbortController();
    this.progress = { id: randomUUID(), phase: 'preparing', name: basename(selected), seconds: 0, message: '' };
    this.completion = this.run(selected, this.controller, backdropPath);
    return this.snapshot()!;
  }
  cancel(id: string): boolean { if (!this.controller || this.progress?.id !== id) return false; this.controller.abort(); return true; }
  async wait(): Promise<CdgProgress | null> { await this.completion; return this.snapshot(); }
  async shutdown(): Promise<void> { this.controller?.abort(); await this.completion; }
  private async run(selected: string, controller: AbortController, backdropPath?: string): Promise<void> {
    const progress = this.progress!; let directory: string | null = null, retain = false;
    let stages: string[] = [];
    let directoryIdentity: { dev: number; ino: number } | null = null;
    let canonicalRoot = '';
    try {
      await mkdir(this.root, { recursive: true }); checkAbort(controller.signal);
      canonicalRoot = await realpath(this.root);
      directory = await mkdtemp(join(this.root, 'track-'));
      const created = await lstat(directory); directoryIdentity = { dev: created.dev, ino: created.ino };
      let audio: string, lyrics: string, metadataPath = selected;
      const isLrc = await useLrcPair(selected);
      if (isLrc) {
        const pair = await resolveLrcPair(selected);
        audio = join(directory, `audio${extname(pair.audio).toLowerCase()}`); lyrics = join(directory, 'lyrics.lrc');
        stages = [basename(audio), 'lyrics.lrc', 'lyrics.vtt'];
        await copyAsset(pair.audio, audio, AUDIO_LIMIT, controller.signal);
        await copyAsset(pair.lyrics, lyrics, LRC_BYTE_LIMIT, controller.signal);
      } else if (extname(selected).toLowerCase() === '.zip') {
        const pair = await extractCdgZip(selected, directory, controller.signal);
        ({ audio, graphics: lyrics } = pair); metadataPath = join(dirname(selected), pair.metadataName);
        stages = ['audio.mp3', 'lyrics.cdg'];
      } else {
        const pair = await resolveCdgPair(selected); checkAbort(controller.signal);
        audio = join(directory, 'audio.mp3'); lyrics = join(directory, 'lyrics.cdg');
        stages = ['audio.mp3', 'lyrics.cdg'];
        await copyAsset(pair.audio, audio, AUDIO_LIMIT, controller.signal);
        await copyAsset(pair.graphics, lyrics, CDG_LIMIT, controller.signal);
      }
      if (!isLrc) {
        const info = await lstat(lyrics);
        if (!info.size || info.size % 24 !== 0) throw new Error('CDG data must contain complete 24-byte packets.');
      }
      checkAbort(controller.signal); progress.phase = 'converting';
      const temporary = join(directory, 'converting.mp4');
      const convert = isLrc ? convertLrc : convertCdg;
      await convert(audio, lyrics, temporary, controller.signal, seconds => { progress.seconds = seconds; }, backdropPath);
      checkAbort(controller.signal); progress.phase = 'importing';
      const path = join(directory, 'track.mp4'); await rename(temporary, path);
      const fingerprint = await hashImportFile(path, controller.signal); checkAbort(controller.signal);
      // Once persistence starts the commit outcome may be uncertain. Retain the
      // complete asset if it throws so a durable row never points at deleted bytes.
      retain = true;
      const outcome = this.commit(path, fingerprint, metadataPath);
      if (outcome === 'duplicate') retain = false;
      progress.outcome = outcome;
      progress.phase = 'completed'; progress.message = outcome === 'duplicate' ? 'Already in the library.' : 'Imported into Song Library. Sources were left unchanged.';
    } catch (error) {
      progress.phase = controller.signal.aborted ? 'cancelled' : 'failed';
      progress.message = controller.signal.aborted ? 'Import cancelled.' : error instanceof Error ? error.message : 'Karaoke pair import failed.';
    } finally {
      // This directory is created exclusively by this job; archive paths are never used for cleanup.
      if (directory) {
        try {
          const target = await realpath(directory);
          const identity = await lstat(directory);
          if (!directoryIdentity || !target.startsWith(canonicalRoot + sep) || dirname(target) !== canonicalRoot ||
              !identity.isDirectory() || identity.isSymbolicLink() || identity.dev !== directoryIdentity.dev || identity.ino !== directoryIdentity.ino) throw new Error('Unsafe cleanup path.');
          if (!retain) await rm(directory, { recursive: true, force: true });
          else await Promise.all(stages.map(name => rm(join(target, name), { force: true })));
        } catch { progress.message += ' Temporary files could not be removed.'; }
      }
      this.controller = null;
    }
  }
}

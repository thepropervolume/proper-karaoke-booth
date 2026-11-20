import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import {
  MAX_PLAYLIST_FILE_BYTES, matchPlaylist, parsePlaylistDestination, parsePlaylistFile,
  type PlaylistApplyResult, type PlaylistCandidate, type PlaylistDestination, type PlaylistExportResult,
  type PlaylistFile, type PlaylistMatch, type PlaylistPreviewResult,
} from '../domain/playlist-transfer';
import { NewFileExportCleanupError, writeNewTextExport } from './new-file-export';

class InvalidPlaylistFile extends Error {}
function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** Native picker paths stay private. Read only the bounded, checked regular file. */
export async function readPlaylistFile(path: string): Promise<PlaylistFile> {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.json') throw new InvalidPlaylistFile();
  const named = await lstat(path);
  if (!named.isFile() || named.isSymbolicLink() || named.size < 1 || named.size > MAX_PLAYLIST_FILE_BYTES) throw new InvalidPlaylistFile();
  const file = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || !sameFile(opened, named)) throw new InvalidPlaylistFile();
    const bytes = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat(), stillNamed = await lstat(path);
    if (offset !== opened.size || !sameFile(opened, after) || !sameFile(opened, stillNamed)) throw new InvalidPlaylistFile();
    let parsed: PlaylistFile | null;
    try { parsed = parsePlaylistFile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)))); }
    catch { throw new InvalidPlaylistFile(); }
    if (!parsed) throw new InvalidPlaylistFile();
    return parsed;
  } finally { await file.close(); }
}

type TransferOptions = {
  pickExport(): Promise<string | null>;
  pickImport(): Promise<string | null>;
  snapshot(playlistId: string): { file: PlaylistFile; omitted: number } | null;
  candidates(): PlaylistCandidate[];
  apply(destination: PlaylistDestination, versionIds: string[]): { playlistId: string; added: number };
  save?: typeof writeNewTextExport;
  now?: () => number;
};

/** Review receipts are in memory, one-use, and tied to the exact mapping shown in Preview. */
export class PlaylistTransfer {
  private running: Promise<unknown> | null = null;
  private stopping = false;
  private review: { token: string; expires: number; file: PlaylistFile; matches: PlaylistMatch[] } | null = null;
  private recovery: { error: NewFileExportCleanupError; count: number; omitted: number } | null = null;

  constructor(private readonly options: TransferOptions) {}

  private track<T>(operation: () => Promise<T>): Promise<T | { status: 'busy' }> {
    if (this.running || this.stopping) return Promise.resolve({ status: 'busy' });
    const running = Promise.resolve().then(operation).finally(() => { this.running = null; });
    this.running = running;
    return running;
  }

  export(input: unknown): Promise<PlaylistExportResult> {
    return this.track<PlaylistExportResult>(async () => {
      if (this.recovery) return { status: 'cleanup-needed', published: this.recovery.error.published };
      if (typeof input !== 'string' || !input.length || input.length > 500) return { status: 'invalid' };
      let count = 0, omitted = 0;
      try {
        const snapshot = this.options.snapshot(input);
        if (!snapshot) return { status: 'invalid' };
        count = snapshot.file.songs.length;
        omitted = snapshot.omitted;
        const file = parsePlaylistFile(snapshot.file);
        if (!file) return { status: 'too-large' };
        const text = `${JSON.stringify(file, null, 2)}\n`;
        if (Buffer.byteLength(text, 'utf8') > MAX_PLAYLIST_FILE_BYTES) return { status: 'too-large' };
        const path = await this.options.pickExport();
        if (!path || this.stopping) return { status: 'cancelled' };
        if (extname(path).toLowerCase() !== '.json') return { status: 'invalid' };
        await (this.options.save ?? writeNewTextExport)(path, text);
        return { status: 'saved', count, omitted };
      } catch (error) {
        if (error instanceof NewFileExportCleanupError) {
          this.recovery = { error, count, omitted };
          return { status: 'cleanup-needed', published: error.published };
        }
        return { status: (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'already-exists' : 'failed' };
      }
    });
  }

  preview(): Promise<PlaylistPreviewResult> {
    return this.track<PlaylistPreviewResult>(async () => {
      this.review = null;
      try {
        const path = await this.options.pickImport();
        if (!path || this.stopping) return { status: 'cancelled' };
        const file = await readPlaylistFile(path);
        if (this.stopping) return { status: 'cancelled' };
        const matches = matchPlaylist(file.songs, this.options.candidates());
        const token = randomUUID();
        this.review = { token, expires: (this.options.now ?? Date.now)() + 10 * 60_000, file, matches };
        return { status: 'ready', token, name: file.name,
          songs: file.songs.map(({ title, artist }, index) => ({ title, artist, status: matches[index].status })) };
      } catch (error) { return { status: error instanceof InvalidPlaylistFile ? 'invalid' : 'failed' }; }
    });
  }

  discard(token: unknown): void {
    if (this.review?.token === token) this.review = null;
  }

  apply(token: unknown, choice: unknown): PlaylistApplyResult {
    if (this.running || this.stopping) return { status: 'busy' };
    const review = this.review;
    if (!review || token !== review.token) return { status: 'stale' };
    if ((this.options.now ?? Date.now)() >= review.expires) { this.review = null; return { status: 'stale' }; }
    const destination = parsePlaylistDestination(choice);
    if (!destination) return { status: 'invalid' };
    try {
      const current = matchPlaylist(review.file.songs, this.options.candidates());
      if (current.some((row, index) => row.versionId !== review.matches[index].versionId || row.status !== review.matches[index].status)) {
        this.review = null;
        return { status: 'stale' };
      }
      const versionIds = current.flatMap(row => row.versionId ? [row.versionId] : []);
      if (!versionIds.length && (current.length || destination.kind === 'kj')) return { status: 'no-matches' };
      // Consume before writing. If persistence fails after an uncertain commit, a
      // second click cannot repeat the mutation using this preview ticket.
      this.review = null;
      const { playlistId, added } = this.options.apply(destination, versionIds);
      return { status: 'imported', playlistId, added, skipped: current.length - added };
    } catch { return { status: 'failed' }; }
  }

  private async cleanup(): Promise<PlaylistExportResult> {
    const recovery = this.recovery;
    if (!recovery) return { status: 'cancelled' };
    try {
      await recovery.error.retryCleanup();
      this.recovery = null;
      return recovery.error.published ? { status: 'saved', count: recovery.count, omitted: recovery.omitted } : { status: 'failed' };
    } catch { return { status: 'cleanup-needed', published: recovery.error.published }; }
  }

  retryCleanup(): Promise<PlaylistExportResult> { return this.track(() => this.cleanup()); }
  needsShutdownWait(): boolean { return !!this.running || !!this.recovery; }
  async shutdown(): Promise<boolean> {
    this.stopping = true;
    this.review = null;
    await this.running;
    return (await this.cleanup()).status !== 'cleanup-needed';
  }
}

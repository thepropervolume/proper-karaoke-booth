import { randomUUID } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import type { ImportProgress, ImportResult, ImportResultsPage } from '../domain/import-job';
import { hashImportFile, ImportCancelled, ImportFileError } from './import-hash';

type Candidate = { path: string; name: string; kind: 'file' | 'directory'; error?: true };
/** Commit synchronously on the authority thread, persisting before returning. */
export type ImportCommit = (path: string, fingerprint: string) => { outcome: 'imported' | 'duplicate'; needsReview?: boolean };
type Hash = typeof hashImportFile;
const changedRetryDelays = [100, 250] as const;
function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ImportCancelled()); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new ImportCancelled()); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
function failureMessage(error: unknown): string {
  if (!(error instanceof ImportFileError)) return 'The song could not be saved. Check available space and try again.';
  switch (error.reason) {
    case 'missing': return 'The file is no longer available. Check its location or cloud sync.';
    case 'permission': return 'The file could not be read. Check file permissions and cloud sync.';
    case 'unavailable': return 'The file is unavailable. Check the drive or cloud connection and try again.';
    case 'empty': return 'The file is empty and cannot be imported.';
    case 'not-file': return 'The source is not a regular file.';
    case 'changed': return 'The file changed while being imported. Wait for sync to finish and retry.';
    default: return 'The file could not be read. Check its drive, permissions, and cloud availability.';
  }
}

/** One import at a time. The injected commit remains the sole show authority. */
export class ImportJob {
  private controller: AbortController | null = null;
  private progress: ImportProgress | null = null;
  private results: ImportResult[] = [];
  private completion: Promise<ImportProgress> | null = null;
  constructor(private readonly commit: ImportCommit, private readonly publish: (progress: ImportProgress) => void = () => {},
    private readonly hash: Hash = hashImportFile) {}

  snapshot(): ImportProgress | null {
    if (!this.progress) return null;
    return { ...this.progress, current: this.progress.current && { ...this.progress.current } };
  }
  private changed(): void { const value = this.snapshot(); if (value) try { this.publish(value); } catch { /* UI notifications must not affect persistence. */ } }
  /** Paths must come from the main-process native picker, never from renderer input. */
  start(kind: 'files' | 'folder', paths: string[]): ImportProgress {
    if (this.controller) throw new Error('An import is already in progress.');
    if (!['files', 'folder'].includes(kind) || !Array.isArray(paths) || !paths.length || !paths.every(path => typeof path === 'string' && isAbsolute(path))) throw new Error('Invalid import selection.');
    const signal = new AbortController();
    this.controller = signal; this.results = [];
    this.progress = { jobId: randomUUID(), phase: 'scanning', discovered: 0, processed: 0, imported: 0, duplicates: 0, failed: 0, cancelled: 0, needsReview: 0, directoriesScanned: 0, skippedUnsupported: 0, current: null };
    this.changed();
    this.completion = this.run(kind, [...paths], signal);
    return this.snapshot()!;
  }
  cancel(jobId: string): boolean {
    if (!this.controller || !this.progress || this.progress.jobId !== jobId) return false;
    if (!this.controller.signal.aborted) { this.progress.phase = 'cancelling'; this.controller.abort(); this.changed(); }
    return true;
  }
  page(jobId: string, offset = 0, limit = 50): ImportResultsPage {
    if (!this.progress || this.progress.jobId !== jobId || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid import results request.');
    const items = this.results.slice(offset, offset + limit).map(item => ({ ...item }));
    return { items, offset, nextOffset: offset + items.length < this.results.length ? offset + items.length : null, total: this.results.length };
  }
  /** The app can await this during shutdown; renderer IPC need not block on it. */
  async wait(): Promise<ImportProgress | null> { return this.completion ? this.completion : this.snapshot(); }
  private add(result: ImportResult): void {
    const current = this.progress!;
    this.results.push(result); current.processed++;
    if (result.outcome === 'imported') current.imported++;
    else if (result.outcome === 'duplicate') current.duplicates++;
    else if (result.outcome === 'failed') current.failed++;
    else current.cancelled++;
    if (result.needsReview) current.needsReview++;
  }
  private async run(kind: 'files' | 'folder', paths: string[], controller: AbortController): Promise<ImportProgress> {
    const state = this.progress!;
    let lastScanUpdate = 0;
    const onScan = (event: 'directory' | 'unsupported', name: string) => {
      if (event === 'directory') { state.directoriesScanned = (state.directoriesScanned ?? 0) + 1; state.current = { name, bytesRead: 0, bytesTotal: 0 }; }
      else state.skippedUnsupported = (state.skippedUnsupported ?? 0) + 1;
      const now = Date.now();
      if (now - lastScanUpdate >= 200) { lastScanUpdate = now; this.changed(); }
    };
    try {
      for await (const candidate of candidates(kind, paths, controller.signal, onScan)) {
        if (controller.signal.aborted) throw new ImportCancelled();
        state.discovered++;
        if (candidate.error) {
          this.add({ name: candidate.name, kind: candidate.kind, outcome: 'failed', needsReview: false, message: candidate.kind === 'directory' ? 'The directory could not be read.' : 'Choose an MP4 video file.' });
          this.changed(); continue;
        }
        state.phase = 'hashing'; state.current = { name: candidate.name, bytesRead: 0, bytesTotal: 0 }; this.changed();
        try {
          let fingerprint: string;
          let retries = 0;
          while (true) {
            try {
              fingerprint = await this.hash(candidate.path, controller.signal, (bytesRead, bytesTotal) => {
                if (!controller.signal.aborted && state.current) { state.current = { ...state.current, bytesRead, bytesTotal }; this.changed(); }
              });
              break;
            } catch (error) {
              if (controller.signal.aborted || !(error instanceof ImportFileError) || error.reason !== 'changed' || retries >= changedRetryDelays.length) throw error;
              const delay = changedRetryDelays[retries++];
              state.current = { name: candidate.name, bytesRead: 0, bytesTotal: 0, retry: retries }; this.changed();
              await waitForRetry(delay, controller.signal);
            }
          }
          if (controller.signal.aborted) throw new ImportCancelled();
          // Once an atomic commit begins, finish recording its actual result even if cancellation arrives.
          const committed = this.commit(candidate.path, fingerprint);
          this.add({ name: candidate.name, kind: 'file', outcome: committed.outcome, needsReview: committed.outcome === 'imported' && !!committed.needsReview });
        } catch (error) {
          if (controller.signal.aborted || error instanceof ImportCancelled) {
            this.add({ name: candidate.name, kind: 'file', outcome: 'cancelled', needsReview: false, message: 'Import was cancelled before this file was committed.' });
            throw new ImportCancelled();
          }
          this.add({ name: candidate.name, kind: 'file', outcome: 'failed', needsReview: false, message: failureMessage(error) });
        }
        state.current = null;
        if (controller.signal.aborted) throw new ImportCancelled();
        state.phase = 'scanning'; this.changed();
      }
      state.phase = controller.signal.aborted ? 'cancelled' : 'completed';
    } catch (error) { state.phase = controller.signal.aborted || error instanceof ImportCancelled ? 'cancelled' : 'failed'; }
    finally { state.current = null; this.controller = null; this.changed(); }
    return { ...state, current: null };
  }
}

async function* candidates(kind: 'files' | 'folder', paths: string[], signal: AbortSignal, onScan: (event: 'directory' | 'unsupported', name: string) => void): AsyncGenerator<Candidate> {
  if (kind === 'files') {
    for (const path of paths) { if (signal.aborted) throw new ImportCancelled(); yield { path, name: basename(path), kind: 'file', ...(extname(path).toLowerCase() === '.mp4' ? {} : { error: true as const }) }; }
    return;
  }
  const stack = paths.map(path => ({ path, root: path })).reverse();
  while (stack.length) {
    if (signal.aborted) throw new ImportCancelled();
    const directory = stack.pop()!;
    const label = (path: string) => { const part = relative(directory.root, path); return (part ? join(basename(directory.root), part) : basename(directory.root)).slice(0, 1024); };
    let dir;
    try {
      const info = await lstat(directory.path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Not a regular directory.');
      dir = await opendir(directory.path, { bufferSize: 32 });
      onScan('directory', label(directory.path));
    }
    catch { if (signal.aborted) throw new ImportCancelled(); yield { path: directory.path, name: label(directory.path), kind: 'directory', error: true }; continue; }
    try {
      while (!signal.aborted) {
        const entry = await dir.read();
        if (!entry) break;
        const path = join(directory.path, entry.name);
        if (entry.isDirectory()) stack.push({ path, root: directory.root });
        else if (entry.isFile() && extname(entry.name).toLowerCase() === '.mp4') yield { path, name: label(path), kind: 'file' };
        else if (entry.isFile()) onScan('unsupported', label(path));
      }
      if (signal.aborted) throw new ImportCancelled();
    } catch (error) {
      if (signal.aborted || error instanceof ImportCancelled) throw new ImportCancelled();
      yield { path: directory.path, name: label(directory.path), kind: 'directory', error: true };
    } finally { await dir.close().catch(() => {}); }
  }
}

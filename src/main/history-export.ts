import { link, lstat, mkdtemp, open, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { HistoryEntry } from '../domain/collections';
import { historyView } from '../domain/history-view';

export type HistoryExportResult =
  | { status: 'saved'; count: number }
  | { status: 'cleanup-needed'; published: boolean }
  | { status: 'cancelled' | 'busy' | 'no-results' | 'invalid-filter' | 'already-exists' | 'failed' };

/** Protect spreadsheet readers from interpreting names or titles as formulas. */
function csvCell(value: string): string {
  const dangerous = /^[\s\x00-\x1f\x7f\uFEFF]*[=+\-@＝＋－＠]/u.test(value) || /^[ \u00A0\uFEFF]*[\x00-\x1f\x7f]/u.test(value);
  const safe = (dangerous ? "'" : '') + value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** UTF-8 with BOM, CRLF, quoted fields, and only the public history columns. */
export function historyCsv(entries: readonly HistoryEntry[]): string {
  const header = ['Performed at', 'Singer', 'Artist', 'Title', 'Outcome'];
  const rows = entries.map(entry => [entry.at, entry.singer, entry.artist, entry.title, entry.outcome]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

type Hooks = { beforePublish?: () => void; beforeCleanup?: () => void };
/** Sensitive recovery details remain in the host process. */
export class HistoryExportCleanupError extends Error {
  constructor(readonly published: boolean, readonly retryCleanup: () => Promise<void>) {
    super(published ? 'History saved but temporary cleanup needs attention.' : 'Temporary history cleanup needs attention.');
  }
}

/** Publish complete bytes atomically at a new destination without overwriting. */
export async function writeHistoryCsv(destination: string, csv: string, hooks: Hooks = {}): Promise<void> {
  if (!isAbsolute(destination) || !basename(destination) || ['.', '..'].includes(basename(destination))) throw new Error('Choose an absolute filename.');
  const parent = await realpath(dirname(destination));
  const target = join(parent, basename(destination));
  const directory = await mkdtemp(join(parent, '.tpv-history-'));
  const directoryIdentity = await lstat(directory);
  const temporary = join(directory, 'history.csv');
  let fileIdentity: { dev: number; ino: number } | null = null;
  let published = false;
  const cleanup = async () => {
    let currentDirectory;
    try { currentDirectory = await lstat(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!currentDirectory.isDirectory() || currentDirectory.isSymbolicLink() ||
        currentDirectory.dev !== directoryIdentity.dev || currentDirectory.ino !== directoryIdentity.ino ||
        dirname(await realpath(directory)) !== parent) throw new Error('Export cleanup needs attention.');
    let currentFile;
    try { currentFile = await lstat(temporary); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (currentFile) {
      if (!fileIdentity || !currentFile.isFile() || currentFile.isSymbolicLink() ||
          currentFile.dev !== fileIdentity.dev || currentFile.ino !== fileIdentity.ino) throw new Error('Export cleanup needs attention.');
      await unlink(temporary);
    }
    await rmdir(directory);
  };
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      const identity = await file.stat(); fileIdentity = { dev: identity.dev, ino: identity.ino };
      await file.writeFile(csv, { encoding: 'utf8' }); await file.sync();
    } finally { await file.close(); }
    hooks.beforePublish?.();
    // Same-directory link publishes the complete file, and fails if the target exists.
    await link(temporary, target);
    published = true;
  } finally {
    try { hooks.beforeCleanup?.(); await cleanup(); }
    catch { throw new HistoryExportCleanupError(published, cleanup); }
  }
}

/** One host-initiated export at a time; never overwrites an existing file. */
export class HistoryExport {
  private active: Promise<HistoryExportResult> | null = null;
  private recovery: { error: HistoryExportCleanupError; count: number } | null = null;
  private stopping = false;
  constructor(
    private readonly snapshot: () => readonly HistoryEntry[],
    private readonly choose: () => Promise<string | null>,
    private readonly save: (path: string, csv: string) => Promise<void> = writeHistoryCsv,
  ) {}

  private track(work: () => Promise<HistoryExportResult>): Promise<HistoryExportResult> {
    if (this.stopping || this.active) return Promise.resolve({ status: 'busy' });
    const operation = Promise.resolve().then(work);
    this.active = operation;
    void operation.finally(() => { if (this.active === operation) this.active = null; });
    return operation;
  }
  start(input: unknown): Promise<HistoryExportResult> {
    return this.track(async () => {
      if (this.recovery) return { status: 'cleanup-needed', published: this.recovery.error.published };
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { status: 'invalid-filter' };
      const filter = input as Record<string, unknown>;
      if (Object.keys(filter).some(key => key !== 'query' && key !== 'singerId') ||
          typeof filter.query !== 'string' || filter.query.length > 200 ||
          typeof filter.singerId !== 'string' || filter.singerId.length > 500) return { status: 'invalid-filter' };
      let count = 0;
      try {
        // Capture before the dialog opens: later show changes cannot alter the export.
        const rows = historyView(this.snapshot(), filter.query, filter.singerId).map(row => ({ ...row }));
        count = rows.length;
        if (!rows.length) return { status: 'no-results' };
        const path = await this.choose();
        if (this.stopping || !path) return { status: 'cancelled' };
        if (!isAbsolute(path)) return { status: 'failed' };
        await this.save(path, historyCsv(rows));
        return { status: 'saved', count: rows.length };
      } catch (error) {
        if (error instanceof HistoryExportCleanupError) {
          this.recovery = { error, count };
          return { status: 'cleanup-needed', published: error.published };
        }
        return { status: (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'already-exists' : 'failed' };
      }
    });
  }
  private async clean(): Promise<HistoryExportResult> {
    const recovery = this.recovery;
    if (!recovery) return { status: 'cancelled' };
    try { await recovery.error.retryCleanup(); this.recovery = null; return recovery.error.published ? { status: 'saved', count: recovery.count } : { status: 'failed' }; }
    catch { return { status: 'cleanup-needed', published: recovery.error.published }; }
  }
  retryCleanup(): Promise<HistoryExportResult> { return this.track(() => this.clean()); }
  status(): { cleanupNeeded: boolean; published: boolean } {
    return { cleanupNeeded: !!this.recovery, published: this.recovery?.error.published ?? false };
  }
  needsShutdownWait(): boolean { return !!this.active || !!this.recovery; }
  async shutdown(): Promise<boolean> {
    this.stopping = true;
    if (this.active) await this.active;
    if (this.recovery) return (await this.clean()).status !== 'cleanup-needed';
    return true;
  }
}

import { link, lstat, mkdtemp, open, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

export type ExportHooks = { beforePublish?: () => void; beforeCleanup?: () => void };
/** The retry function and original paths remain in the main process. */
export class NewFileExportCleanupError extends Error {
  constructor(readonly published: boolean, readonly retryCleanup: () => Promise<void>) {
    super(published ? 'Export saved but temporary cleanup needs attention.' : 'Temporary export cleanup needs attention.');
  }
}

/** Flush complete UTF-8 bytes, then publish at a new destination without overwriting. */
export async function writeNewTextExport(destination: string, contents: string, hooks: ExportHooks = {}): Promise<void> {
  if (!isAbsolute(destination) || !basename(destination) || ['.', '..'].includes(basename(destination))) throw new Error('Choose an absolute filename.');
  const parent = await realpath(dirname(destination));
  const target = join(parent, basename(destination));
  const directory = await mkdtemp(join(parent, '.tpv-export-'));
  const directoryIdentity = await lstat(directory);
  const temporary = join(directory, 'export.tmp');
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
      await file.writeFile(contents, { encoding: 'utf8' }); await file.sync();
    } finally { await file.close(); }
    hooks.beforePublish?.();
    // Same-directory link exposes complete bytes and fails if the target exists.
    await link(temporary, target);
    published = true;
  } finally {
    try { hooks.beforeCleanup?.(); await cleanup(); }
    catch { throw new NewFileExportCleanupError(published, cleanup); }
  }
}

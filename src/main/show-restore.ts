import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateShowSchema } from './schema-migrations';
import { assertStandaloneShowFile, inspectShowSnapshot, restoreShowSnapshotToNewFile, SnapshotCleanupError, type SnapshotSummary } from './show-snapshots';

export type RestoreResult = { status: 'cancelled' | 'busy' | 'unavailable' | 'invalid-backup' | 'failed' | 'restarting' };

export type PreparedShowRestore = {
  summary: SnapshotSummary;
  install: (protectCurrent: (backup: string) => Promise<void>, closeCurrent: () => void) => Promise<void>;
  discard: () => Promise<void>;
};

export class InvalidShowBackupError extends Error {}

function validateBackupSchema(db: DatabaseSync): void {
  db.exec('PRAGMA trusted_schema = OFF');
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type IN ('trigger', 'view') LIMIT 1").get() ||
      db.prepare("SELECT 1 FROM pragma_table_list WHERE type IN ('virtual', 'shadow') LIMIT 1").get())
    throw new InvalidShowBackupError('The backup has definitions that are not part of the Booth schema.');
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function checkSelectedBackup(snapshot: string, live: string): Promise<void> {
  await assertStandaloneShowFile(snapshot);
  const selected = await open(snapshot, 'r');
  try {
    const [sourceInfo, liveInfo] = await Promise.all([selected.stat({ bigint: true }), lstat(live, { bigint: true })]);
    if (sourceInfo.dev === liveInfo.dev && sourceInfo.ino === liveInfo.ino)
      throw new InvalidShowBackupError('Choose a backup instead of the open show database.');
    const header = Buffer.alloc(20);
    await selected.read(header, 0, header.length, 0);
    // The snapshot writer emits standalone rollback-mode databases. A copied
    // WAL-mode header cannot prove that its latest committed pages are present.
    if (!header.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) || header[18] !== 1 || header[19] !== 1)
      throw new InvalidShowBackupError('Choose a standalone SQLite backup.');
  } finally { await selected.close(); }
}

/** Keep the reviewed, migrated copy private until the host confirms and shuts down. */
export async function prepareShowRestore(snapshot: string, profileDirectory: string): Promise<PreparedShowRestore> {
  const root = await realpath(profileDirectory);
  const live = join(root, 'show.sqlite');
  const directory = await mkdtemp(join(root, '.tpv-restore-'));
  const directoryIdentity = await lstat(directory);
  const staged = join(directory, 'show.sqlite');
  let closed = false;
  const verifyDirectory = async () => {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.dev !== directoryIdentity.dev || info.ino !== directoryIdentity.ino)
      throw new Error('The restore working directory changed.');
  };
  const discard = async () => {
    await verifyDirectory();
    try { await unlink(staged); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rmdir(directory);
  };
  try {
    try {
      await checkSelectedBackup(snapshot, live);
      await restoreShowSnapshotToNewFile(snapshot, staged, { validateSource: validateBackupSchema });
    } catch (error) {
      if (error instanceof SnapshotCleanupError) { await error.retryCleanup(); if (!error.published) throw error; }
      else if (['EACCES', 'EBUSY', 'ENOSPC', 'EPERM', 'EIO'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      else throw new InvalidShowBackupError('The selected backup is incompatible or incomplete.', { cause: error });
    }
    const db = new DatabaseSync(staged);
    let summary: SnapshotSummary;
    try {
      validateBackupSchema(db);
      migrateShowSchema(db);
      summary = inspectShowSnapshot(db);
    } catch (error) { throw new InvalidShowBackupError('The backup could not be prepared for this version.', { cause: error }); }
    finally { db.close(); }
    if (process.platform !== 'win32') await chmod(staged, 0o600);
    const file = await open(staged, 'r+');
    try { await file.sync(); } finally { await file.close(); }
    const reviewed = await digest(staged);
    return { summary, discard, install: async (protectCurrent, closeCurrent) => {
      if (closed) throw new Error('The restore has already been attempted.');
      closed = true;
      const directory = join(root, 'show-restore-backups');
      await mkdir(directory, { mode: 0o700, recursive: true });
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077) !== 0)
        throw new Error('The show restore backup directory must be private.');

      await verifyDirectory();
      await assertStandaloneShowFile(staged);
      if (await digest(staged) !== reviewed) throw new Error('The staged backup changed after review.');
      await protectCurrent(join(directory, `show-before-restore-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`));
      closeCurrent();

      // The old Store is closed and the app still owns the instance lock.
      // Never move a live WAL, or attempt to splice stale sidecars onto the replacement.
      await assertStandaloneShowFile(live);
      await verifyDirectory();
      await assertStandaloneShowFile(staged);
      if (await digest(staged) !== reviewed) throw new Error('The staged backup changed after review.');
      await rename(staged, live);
    } };
  } catch (error) { await discard().catch(() => {}); throw error; }
}

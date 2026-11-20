import { randomUUID } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectShowUpgrade, migrateReservedShowSchema, SHOW_SCHEMA_VERSION } from './schema-migrations';
import { createShowSnapshot } from './show-snapshots';

async function saveUpgradeSnapshot(filename: string, version: number): Promise<void> {
  const directory = join(dirname(filename), 'show-upgrade-backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    throw new Error('The show upgrade backup directory must be private.');
  const destination = join(directory, `show-v${version}-before-v${SHOW_SCHEMA_VERSION}-${randomUUID()}.sqlite`);
  // The writer reservation is on a different connection. The read-only connection
  // can include committed WAL pages while other writers remain blocked.
  const source = new DatabaseSync(filename, { readOnly: true });
  try { await createShowSnapshot(source, destination); }
  finally { source.close(); }
}

/** Open the host database and protect the exact pre-migration state before changing it. */
export async function openHostShowDatabase(filename: string): Promise<DatabaseSync> {
  const db = new DatabaseSync(filename);
  try {
    db.exec('BEGIN IMMEDIATE');
    const { current, hasShow } = inspectShowUpgrade(db);
    if (hasShow && current < SHOW_SCHEMA_VERSION) {
      try { await saveUpgradeSnapshot(filename, current); }
      catch (cause) {
        throw new Error('The show upgrade stopped because its backup could not be saved and verified. Check space and write access to the show-upgrade-backups folder in your app data, then reopen the app.', { cause });
      }
    }
    migrateReservedShowSchema(db, current);
    db.exec('COMMIT');
    return db;
  } catch (error) {
    try { if (db.isTransaction) db.exec('ROLLBACK'); }
    finally { db.close(); }
    throw error;
  }
}

/** Offline restore staging and transactional database selection. Not connected to app startup or UI. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, lstatSync, linkSync, openSync, closeSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectShowSnapshot, restoreShowSnapshotToNewFile, SnapshotCleanupError, type SnapshotSummary } from './show-snapshots';

const CONTROL = 'show-selection.sqlite';
const APPLICATION_ID = 0x54505653;
const SCHEMA_VERSION = 1;
export type ShowSelection = { activeName: string; previousName: string | null; revision: number };
export type StagedRestore = { name: string; sha256: string; summary: SnapshotSummary };
export class RestoreStageError extends Error {
  constructor(readonly candidateName: string, readonly published: boolean, readonly retryCleanup?: () => Promise<void>) { super('Restore staging needs attention.'); }
}
type Hooks = { beforeCommit?: () => void; afterCommit?: () => void };
const validName = (name: unknown): name is string => typeof name === 'string' && (name === 'show.sqlite' || /^show-restored-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.sqlite$/.test(name));

function rootPath(directory: string): string {
  if (!isAbsolute(directory)) throw new Error('Show directory must be absolute.');
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Show directory must not be a link.');
  const root = realpathSync(directory), info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Show directory is unavailable.');
  return root;
}
function safeFile(root: string, name: string, allowMissing = false): string {
  if (!validName(name)) throw new Error('Invalid show database name.');
  const path = join(root, name);
  let info;
  try { info = lstatSync(path); } catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return path; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || dirname(realpathSync(path)) !== root) throw new Error('Show database is unavailable.');
  return path;
}
function readControl(db: DatabaseSync): ShowSelection {
  const app = (db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id;
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (app !== APPLICATION_ID || version !== SCHEMA_VERSION) throw new Error('Show selection is invalid or unsupported.');
  const rows = db.prepare('SELECT id, active_name AS activeName, previous_name AS previousName, revision FROM show_selection').all() as unknown as (ShowSelection & { id: number })[];
  if (rows.length !== 1 || rows[0].id !== 1 || !validName(rows[0].activeName) ||
      !(rows[0].previousName === null || validName(rows[0].previousName)) || !Number.isSafeInteger(rows[0].revision) || rows[0].revision < 0)
    throw new Error('Show selection is invalid or unsupported.');
  const { activeName, previousName, revision } = rows[0]; return { activeName, previousName, revision };
}
function controlPath(root: string): string { return join(root, CONTROL); }
function present(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function openControl(root: string, readOnly: boolean): DatabaseSync {
  const path = controlPath(root), info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || dirname(realpathSync(path)) !== root) throw new Error('Show selection is unavailable.');
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const sidecar = `${path}${suffix}`;
    if (present(sidecar)) {
      const stat = lstatSync(sidecar);
      if (!stat.isFile() || stat.isSymbolicLink() || dirname(realpathSync(sidecar)) !== root) throw new Error('Show selection sidecar is unavailable.');
    }
  }
  return new DatabaseSync(path, { readOnly });
}
function ensureControl(root: string): void {
  if (present(controlPath(root))) return;
  const temporary = join(root, `.tpv-selection-${randomUUID()}.sqlite`);
  const fd = openSync(temporary, 'wx', 0o600); closeSync(fd);
  try {
    const db = new DatabaseSync(temporary);
    try {
      db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE show_selection (id INTEGER PRIMARY KEY CHECK (id = 1), active_name TEXT NOT NULL, previous_name TEXT, revision INTEGER NOT NULL CHECK (revision >= 0));
        INSERT INTO show_selection VALUES (1, 'show.sqlite', NULL, 0);
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};`);
    } finally { db.close(); }
    try { linkSync(temporary, controlPath(root)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  } finally { unlinkSync(temporary); }
}

/** Call only while holding the app instance lock and before opening the show Store. */
export function readShowSelection(directory: string): ShowSelection {
  const root = rootPath(directory);
  if (!present(controlPath(root))) { safeFile(root, 'show.sqlite', true); return { activeName: 'show.sqlite', previousName: null, revision: 0 }; }
  // A read-write open permits SQLite to recover a hot rollback journal after an
  // interrupted cutover. The caller must already hold the app instance lock.
  const db = openControl(root, false);
  try { const selection = readControl(db); safeFile(root, selection.activeName, selection.activeName === 'show.sqlite' && selection.revision === 0); return selection; }
  finally { db.close(); }
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
function inspect(path: string): SnapshotSummary {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return inspectShowSnapshot(db); } finally { db.close(); }
}
function identity(path: string): string {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Show database is unavailable.');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function assertIdentity(root: string, name: string, expected: string): void {
  if (identity(safeFile(root, name)) !== expected) throw new Error('Show database changed during verification.');
}
function rejectSidecars(path: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) if (present(`${path}${suffix}`)) throw new Error('Show database has a SQLite sidecar.');
}
/** A restore is copied to a new unique file; the current database is never replaced. */
export async function stageShowRestore(snapshot: string, directory: string): Promise<StagedRestore> {
  const root = rootPath(directory), name = `show-restored-${randomUUID()}.sqlite`;
  const destination = join(root, name);
  try { await restoreShowSnapshotToNewFile(snapshot, destination); }
  catch (error) { if (error instanceof SnapshotCleanupError) throw new RestoreStageError(name, error.published, error.retryCleanup); throw error; }
  try {
    const path = safeFile(root, name), expected = identity(path), summary = inspect(path), sha256 = await digest(path);
    assertIdentity(root, name, expected);
    return { name, sha256, summary };
  } catch { // Publication succeeded: let the caller identify the orphan rather than retry blindly.
    throw new RestoreStageError(name, true);
  }
}
function sameSelection(a: ShowSelection, b: ShowSelection): boolean {
  return a.activeName === b.activeName && a.previousName === b.previousName && a.revision === b.revision;
}
function commitSelection(root: string, name: string, expected: ShowSelection, hooks: Hooks, verify: () => void): ShowSelection {
  ensureControl(root);
  const db = openControl(root, false);
  let inTransaction = false;
  try {
    db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE'); inTransaction = true;
    const current = readControl(db);
    verify();
    if (current.activeName === name && (sameSelection(current, expected) ||
        (current.previousName === expected.activeName && current.revision === expected.revision + 1))) {
      db.exec('COMMIT'); inTransaction = false; return current;
    }
    if (!sameSelection(current, expected)) throw new Error('Show selection changed; review the restore again.');
    if (current.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Show selection revision is exhausted.');
    const next = { activeName: name, previousName: current.activeName, revision: current.revision + 1 };
    db.prepare('UPDATE show_selection SET active_name = ?, previous_name = ?, revision = ? WHERE id = 1').run(next.activeName, next.previousName, next.revision);
    hooks.beforeCommit?.(); verify(); db.exec('COMMIT'); inTransaction = false; hooks.afterCommit?.(); return next;
  } catch (error) { if (inTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
/** Call only offline, after stopping remote rooms and closing the current Store. */
export async function activateStagedShow(directory: string, candidate: StagedRestore, expected: ShowSelection, hooks: Hooks = {}): Promise<ShowSelection> {
  const root = rootPath(directory);
  if (!candidate || !validName(candidate.name) || candidate.name === 'show.sqlite' || !/^[a-f0-9]{64}$/.test(candidate.sha256)) throw new Error('Invalid staged restore.');
  const path = safeFile(root, candidate.name), expectedIdentity = identity(path);
  const checkSidecars = () => rejectSidecars(path);
  checkSidecars();
  inspect(path);
  if (await digest(path) !== candidate.sha256) throw new Error('Staged restore changed after review.');
  assertIdentity(root, candidate.name, expectedIdentity);
  return commitSelection(root, candidate.name, expected, hooks, () => { checkSidecars(); assertIdentity(root, candidate.name, expectedIdentity); });
}
/** Switch back to the previously selected intact database without overwriting either file. */
export function selectPreviousShow(directory: string, expected: ShowSelection, hooks: Hooks = {}): ShowSelection {
  const root = rootPath(directory), current = readShowSelection(root);
  if (!sameSelection(current, expected) || !current.previousName) throw new Error('No previous show is available for this selection.');
  const previous = current.previousName, path = safeFile(root, previous), expectedIdentity = identity(path);
  rejectSidecars(path); inspect(path); assertIdentity(root, previous, expectedIdentity);
  return commitSelection(root, previous, expected, hooks, () => { rejectSidecars(path); assertIdentity(root, previous, expectedIdentity); });
}

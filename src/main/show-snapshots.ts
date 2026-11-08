/** Snapshot primitives; callers must keep the source connection open until the promise settles. */
import { backup, DatabaseSync } from 'node:sqlite';
import { link, lstat, mkdtemp, open, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { inspectShowSchema } from './schema-migrations';

type Hooks = { beforePublish?: () => void; beforeCleanup?: () => void };
/** Main-process-only recovery data; publication may already have completed. */
export class SnapshotCleanupError extends Error {
  constructor(readonly published: boolean, readonly retryCleanup: () => Promise<void>) {
    super(published ? 'Snapshot saved, but temporary cleanup needs attention.' : 'Snapshot cleanup needs attention.');
  }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function id(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function whole(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
function validState(value: unknown): boolean {
  if (!record(value) || !id(value.showId) || !id(value.hostEpoch) || !whole(value.revision) ||
      !Array.isArray(value.singers) || !Array.isArray(value.versions) || !Array.isArray(value.requests) ||
      !Array.isArray(value.usedGenerationIds) || !value.usedGenerationIds.every(id) || !Array.isArray(value.receipts) ||
      !whole(value.currentRound) || (value.currentRound as number) < 1 || !whole(value.nextOrder) || (value.nextOrder as number) < 1 ||
      typeof value.finalTurnBegun !== 'boolean' || !(value.stagedRequestId === null || id(value.stagedRequestId)) ||
      (value.nextStartAtMs !== undefined && (!whole(value.nextStartAtMs)))) return false;
  if (!record(value.policy) || typeof value.policy.ageRestricted !== 'boolean' ||
      !(value.policy.includeVersionIds === null || (Array.isArray(value.policy.includeVersionIds) && value.policy.includeVersionIds.every(id))) ||
      !Array.isArray(value.policy.excludeVersionIds) || !value.policy.excludeVersionIds.every(id)) return false;
  if (!value.singers.every(singer => record(singer) && id(singer.id) && id(singer.name)) ||
      !value.versions.every(version => record(version) && id(version.id) && id(version.title) && typeof version.artist === 'string' &&
        ['clean', 'explicit', 'unrated', 'uncertain'].includes(String(version.rating)))) return false;
  const singers = new Set(value.singers.map(singer => (singer as Record<string, unknown>).id));
  const versions = new Set(value.versions.map(version => (version as Record<string, unknown>).id));
  if (singers.size !== value.singers.length || versions.size !== value.versions.length) return false;
  if (!value.requests.every(request => record(request) && id(request.id) && singers.has(request.singerId) && versions.has(request.versionId) &&
      ['pending', 'accepted', 'staged', 'playing', 'completed', 'skipped', 'removed'].includes(String(request.status)) &&
      (request.round === null || whole(request.round)) && (request.order === null || whole(request.order)))) return false;
  const requests = value.requests as Record<string, unknown>[];
  if (new Set(requests.map(request => request.id)).size !== requests.length) return false;
  if (value.stagedRequestId !== null && !requests.some(request => request.id === value.stagedRequestId && request.status === 'staged')) return false;
  if (value.playback !== null) {
    if (!record(value.playback) || !id(value.playback.requestId) || !id(value.playback.generationId) ||
        !['playing', 'paused'].includes(String(value.playback.status)) || !value.usedGenerationIds.includes(value.playback.generationId) ||
        !requests.some(request => request.id === (value.playback as Record<string, unknown>).requestId && request.status === 'playing')) return false;
  }
  return true;
}
async function absent(path: string): Promise<void> {
  try { await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('Destination or SQLite sidecar already exists.');
}
export type SnapshotSummary = { revision: number; singers: number; songs: number; requests: number };
export function inspectShowSnapshot(db: DatabaseSync): SnapshotSummary {
  const result = db.prepare('PRAGMA integrity_check').all() as Record<string, unknown>[];
  if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') throw new Error('Backup integrity check failed.');
  inspectShowSchema(db);
  const row = db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string } | undefined;
  if (!row) throw new Error('Backup show state is incomplete or incompatible.');
  const state: unknown = JSON.parse(row.value);
  if (!validState(state) || !record(state)) throw new Error('Backup show state is incomplete or incompatible.');
  return { revision: state.revision as number, singers: (state.singers as unknown[]).length, songs: (state.versions as unknown[]).length, requests: (state.requests as unknown[]).length };
}

/** Publish a fully checked standalone database at a new path; never overwrite an existing file. */
export async function createShowSnapshot(source: DatabaseSync, destination: string, hooks: Hooks = {}): Promise<void> {
  if (!isAbsolute(destination) || !basename(destination) || basename(destination) === '.' || basename(destination) === '..') throw new Error('Choose an absolute backup filename.');
  const parent = await realpath(dirname(destination));
  const target = join(parent, basename(destination));
  await absent(target); await absent(`${target}-wal`); await absent(`${target}-shm`); await absent(`${target}-journal`);
  const directory = await mkdtemp(join(parent, '.tpv-snapshot-'));
  const identity = await lstat(directory);
  const temporary = join(directory, 'show.sqlite');
  const cleanup = async () => {
    let current;
    try { current = await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const actual = await realpath(directory);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || dirname(actual) !== parent)
      throw new Error('Snapshot temporary directory changed; cleanup needs attention.');
    for (const path of [temporary, `${temporary}-wal`, `${temporary}-shm`, `${temporary}-journal`]) {
      try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await rmdir(directory);
  };
  let published = false;
  try {
    inspectShowSnapshot(source);
    await backup(source, temporary);
    const copy = new DatabaseSync(temporary, { readOnly: true });
    try { inspectShowSnapshot(copy); } finally { copy.close(); }
    const file = await open(temporary, 'r+'); try { await file.sync(); } finally { await file.close(); }
    hooks.beforePublish?.();
    await absent(`${target}-wal`); await absent(`${target}-shm`); await absent(`${target}-journal`);
    // Same-directory hard-link creation publishes complete bytes atomically and fails if target exists.
    await link(temporary, target);
    published = true;
  } finally {
    try { hooks.beforeCleanup?.(); await cleanup(); }
    catch { throw new SnapshotCleanupError(published, cleanup); }
  }
}

/** Restore to a separate, new database file; this never replaces a live show. */
export async function restoreShowSnapshotToNewFile(snapshot: string, destination: string, hooks: Hooks = {}): Promise<void> {
  if (!isAbsolute(snapshot)) throw new Error('Choose an absolute backup filename.');
  const info = await lstat(snapshot);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Backup must be a regular file.');
  await absent(`${snapshot}-wal`); await absent(`${snapshot}-shm`); await absent(`${snapshot}-journal`);
  const source = new DatabaseSync(snapshot, { readOnly: true });
  try { inspectShowSnapshot(source); await createShowSnapshot(source, destination, hooks); } finally { source.close(); }
}

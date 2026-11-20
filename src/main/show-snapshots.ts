import { validStreamingSource } from '../domain/streaming-source';
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
function validPoints(value: unknown, showId: string, singers: Set<unknown>): boolean {
  if (!record(value) || value.version !== 1 || value.showId !== showId || !Array.isArray(value.accounts) ||
      !Array.isArray(value.performances) || !Array.isArray(value.receipts)) return false;
  if (value.duetAwards !== undefined && (!Array.isArray(value.duetAwards) ||
      !value.duetAwards.every(award => record(award) && id(award.requestId) && singers.has(award.singerId)) ||
      new Set(value.duetAwards.map(award => JSON.stringify([(award as Record<string, unknown>).requestId, (award as Record<string, unknown>).singerId]))).size !== value.duetAwards.length)) return false;
  if (value.queueAwards !== undefined && (!Array.isArray(value.queueAwards) ||
      !value.queueAwards.every(award => record(award) && id(award.requestId) && singers.has(award.singerId)) ||
      new Set(value.queueAwards.map(award => JSON.stringify([(award as Record<string, unknown>).requestId, (award as Record<string, unknown>).singerId]))).size !== value.queueAwards.length)) return false;
  if (value.queueFacts !== undefined && (!Array.isArray(value.queueFacts) ||
      !value.queueFacts.every(fact => record(fact) && id(fact.requestId) && typeof fact.everQueuedOrSung === 'boolean' &&
        Array.isArray(fact.sungBy) && fact.sungBy.every(singer => singers.has(singer)) && new Set(fact.sungBy).size === fact.sungBy.length) ||
      new Set(value.queueFacts.map(fact => (fact as Record<string, unknown>).requestId)).size !== value.queueFacts.length)) return false;
  if (!value.accounts.every(account => record(account) && singers.has(account.singerId) && whole(account.points) &&
      whole(account.credits) && (account.credits as number) <= 5) ||
      new Set(value.accounts.map(account => (account as Record<string, unknown>).singerId)).size !== value.accounts.length) return false;
  if (!value.performances.every(item => record(item) && id(item.generationId) && whole(item.applauseCount) &&
      typeof item.finished === 'boolean' && (item.allListenerBonusAwarded === undefined || typeof item.allListenerBonusAwarded === 'boolean') && Array.isArray(item.performers) && item.performers.every(singer => singers.has(singer)) &&
      new Set(item.performers).size === item.performers.length && Array.isArray(item.eligibleListeners) &&
      item.eligibleListeners.every(singer => singers.has(singer) && !(item.performers as unknown[]).includes(singer)) &&
      new Set(item.eligibleListeners).size === item.eligibleListeners.length && Array.isArray(item.applauders) &&
      item.applauders.every(id) && new Set(item.applauders).size === item.applauders.length && Array.isArray(item.singerApplause) &&
      item.singerApplause.every(row => record(row) && singers.has(row.singerId) && whole(row.count)) &&
      new Set(item.singerApplause.map(row => (row as Record<string, unknown>).singerId)).size === item.singerApplause.length) ||
      new Set(value.performances.map(item => (item as Record<string, unknown>).generationId)).size !== value.performances.length) return false;
  return value.receipts.every(receipt => record(receipt) && id(receipt.id) && typeof receipt.event === 'string') &&
    new Set(value.receipts.map(receipt => (receipt as Record<string, unknown>).id)).size === value.receipts.length;
}
function validState(value: unknown, allowUnassigned: boolean): boolean {
  if (!record(value) || !id(value.showId) || !id(value.hostEpoch) || !whole(value.revision) ||
      !Array.isArray(value.singers) || !Array.isArray(value.versions) || !Array.isArray(value.requests) ||
      !Array.isArray(value.usedGenerationIds) || !value.usedGenerationIds.every(id) || !Array.isArray(value.receipts) ||
      !whole(value.currentRound) || (value.currentRound as number) < 1 || !whole(value.nextOrder) || (value.nextOrder as number) < 1 ||
      typeof value.finalTurnBegun !== 'boolean' || !(value.stagedRequestId === null || id(value.stagedRequestId)) ||
      !(value.promotedRequestId === undefined || value.promotedRequestId === null || id(value.promotedRequestId)) ||
      (value.nextStartAtMs !== undefined && (!whole(value.nextStartAtMs)))) return false;
  if (!record(value.policy) || typeof value.policy.ageRestricted !== 'boolean' ||
      !(value.policy.includeVersionIds === null || (Array.isArray(value.policy.includeVersionIds) && value.policy.includeVersionIds.every(id))) ||
      !Array.isArray(value.policy.excludeVersionIds) || !value.policy.excludeVersionIds.every(id)) return false;
  if (!value.singers.every(singer => record(singer) && id(singer.id) && id(singer.name) && (singer.archived === undefined || typeof singer.archived === 'boolean') && (singer.unavailableUntilMs === undefined || whole(singer.unavailableUntilMs))) ||
      !value.versions.every(version => record(version) && id(version.id) && id(version.title) && typeof version.artist === 'string' &&
        ['clean', 'explicit', 'unrated', 'uncertain'].includes(String(version.rating)) && (version.isDuet === undefined || typeof version.isDuet === 'boolean') &&
        (version.source === undefined || validStreamingSource(version.source)) &&
        (version.discoveryOrigin === undefined || version.discoveryOrigin === 'karaokenerds' && record(version.source) && version.source.provider === 'youtube'))) return false;
  const singers = new Set(value.singers.map(singer => (singer as Record<string, unknown>).id));
  const versions = new Set(value.versions.map(version => (version as Record<string, unknown>).id));
  if (singers.size !== value.singers.length || versions.size !== value.versions.length) return false;
  if (value.points !== undefined && !validPoints(value.points, value.showId, singers)) return false;
  if (!value.requests.every(request => record(request) && id(request.id) && (allowUnassigned && request.singerId === null || singers.has(request.singerId)) && versions.has(request.versionId) &&
      (request.coSingerId === undefined || request.coSingerId === null || (singers.has(request.coSingerId) && request.coSingerId !== request.singerId && request.singerId !== null)) &&
      ['pending', 'accepted', 'staged', 'playing', 'completed', 'skipped', 'removed', 'rejected', 'withdrawn'].includes(String(request.status)) &&
      (request.round === null || whole(request.round)) && (request.order === null || whole(request.order)))) return false;
  const requests = value.requests as Record<string, unknown>[];
  const archivedSingers = new Set(value.singers.filter(singer => (singer as Record<string, unknown>).archived === true).map(singer => (singer as Record<string, unknown>).id));
  if (requests.some(request => ['pending', 'accepted', 'staged', 'playing'].includes(String(request.status)) &&
      (archivedSingers.has(request.singerId) || archivedSingers.has(request.coSingerId)))) return false;
  if (new Set(requests.map(request => request.id)).size !== requests.length) return false;
  if (value.manualQueueOrder !== undefined && (!Array.isArray(value.manualQueueOrder) || !value.manualQueueOrder.every(id) ||
      new Set(value.manualQueueOrder).size !== value.manualQueueOrder.length ||
      !value.manualQueueOrder.every(entry => requests.some(request => request.id === entry && ['accepted', 'staged', 'playing'].includes(String(request.status)))))) return false;
  if (value.promotedRequestId !== undefined && value.promotedRequestId !== null) {
    const promoted = requests.find(request => request.id === value.promotedRequestId);
    const version = promoted && value.versions.find(item => (item as Record<string, unknown>).id === promoted.versionId) as Record<string, unknown> | undefined;
    const policy = value.policy;
    if (!promoted || !['accepted', 'staged', 'playing'].includes(String(promoted.status)) || !version ||
        (policy.excludeVersionIds as string[]).includes(String(promoted.versionId)) ||
        (policy.includeVersionIds !== null && !(policy.includeVersionIds as string[]).includes(String(promoted.versionId))) ||
        (policy.ageRestricted === true && version.rating !== 'clean')) return false;
  }
  const staged = requests.filter(request => request.status === 'staged');
  const playing = requests.filter(request => request.status === 'playing');
  // Orphaned or duplicate active rows cannot be resumed or released after a
  // restore. Reject them instead of publishing a backup with a stranded queue.
  if (value.stagedRequestId === null ? staged.length !== 0 : staged.length !== 1 || staged[0].id !== value.stagedRequestId) return false;
  if (value.playback !== null) {
    if (!record(value.playback) || !id(value.playback.requestId) || !id(value.playback.generationId) ||
        !['playing', 'paused'].includes(String(value.playback.status)) || !value.usedGenerationIds.includes(value.playback.generationId) ||
        playing.length !== 1 || playing[0].id !== value.playback.requestId) return false;
  } else if (playing.length !== 0) return false;
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
  const version = inspectShowSchema(db);
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'show_state'").get())
    throw new Error('Backup show state is incomplete or incompatible.');
  const row = db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string } | undefined;
  if (!row) throw new Error('Backup show state is incomplete or incompatible.');
  const state: unknown = JSON.parse(row.value);
  if (!validState(state, version >= 5) || !record(state)) throw new Error('Backup show state is incomplete or incompatible.');
  if (version < 6 && (state.versions as Record<string,unknown>[]).some(item=>record(item.source)&&item.source.provider==='partytyme')) throw new Error('Backup show state is incomplete or incompatible.');
  if (version < 7 && (state.points !== undefined ||
    (state.versions as Record<string, unknown>[]).some(item => item.isDuet !== undefined) ||
    (state.requests as Record<string, unknown>[]).some(item => item.coSingerId !== undefined)))
    throw new Error('Backup show state is incomplete or incompatible.');
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
    const copy = new DatabaseSync(temporary);
    try {
      // A WAL-mode source leaves that mode in the backup header. Switch the
      // private copy to a standalone file before validation and publication.
      const mode = copy.prepare('PRAGMA journal_mode = DELETE').get();
      if (mode?.journal_mode !== 'delete') throw new Error('Could not make the backup a standalone database.');
      inspectShowSnapshot(copy);
    } finally { copy.close(); }
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

export async function assertStandaloneShowFile(snapshot: string): Promise<void> {
  if (!isAbsolute(snapshot)) throw new Error('Choose an absolute backup filename.');
  const info = await lstat(snapshot);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Backup must be a regular file.');
  await absent(`${snapshot}-wal`); await absent(`${snapshot}-shm`); await absent(`${snapshot}-journal`);
}

/** Restore to a separate, new database file; this never replaces a live show. */
export async function restoreShowSnapshotToNewFile(snapshot: string, destination: string,
  hooks: Hooks & { validateSource?: (source: DatabaseSync) => void } = {}): Promise<void> {
  await assertStandaloneShowFile(snapshot);
  const source = new DatabaseSync(snapshot, { readOnly: true });
  try { hooks.validateSource?.(source); inspectShowSnapshot(source); await createShowSnapshot(source, destination, hooks); }
  finally { source.close(); }
}

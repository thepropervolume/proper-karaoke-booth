import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/main/store';
import { normalizeMissingRequest } from '../../src/domain/missing-request';
import { createInitialState, type ShowState } from '../../src/domain';
import { KJ_PICKS_ID } from '../../src/domain/collections';

test('persists show state and private media across a reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-store-'));
  try {
    const path = join(dir, 'show.sqlite');
    let db = new Store<{ revision: number }>(path);
    db.save({ revision: 3 }, [{ id: 'version-a', path: '/private/song.mp4', fingerprint: 'abc' }]);
    db.close();
    db = new Store(path);
    assert.deepEqual(db.load(), { revision: 3 });
    assert.equal(db.media('version-a')?.path, '/private/song.mp4');
    assert.equal(db.byFingerprint('abc')?.id, 'version-a');
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rolls back media if show state cannot be saved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-store-'));
  try {
    const db = new Store<Record<string, unknown>>(join(dir, 'show.sqlite'));
    db.save({ revision: 1 });
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    assert.throws(() => db.save(cycle, [{ id: 'version-b', path: '/private/song.mp4', fingerprint: 'def' }]));
    assert.deepEqual(db.load(), { revision: 1 });
    assert.equal(db.media('version-b'), undefined);
    db.checkpoint('generation-a', 42);
    assert.equal(db.position('generation-a'), 42);
    assert.equal(db.position('generation-b'), 0);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('performance history and the show state commit or roll back together', () => {
  const db = new Store<{ revision: number }>(':memory:');
  try {
    const history = { generationId: 'g1', singerId: 's1', singer: 'Singer', versionId: 'v1', title: 'Song', artist: 'Artist', outcome: 'completed' as const, at: '2026-11-07T00:00:00Z' };
    db.save({ revision: 1 }, [], history);
    assert.equal(db.collections.snapshot().history.length, 1);
    assert.throws(() => db.save({ revision: 2 }, [], { ...history, generationId: '' }));
    assert.deepEqual(db.load(), { revision: 1 });
    assert.equal(db.collections.snapshot().history.length, 1);
  } finally { db.close(); }
});

test('saving a discovered KJ pick commits the recording and star together without a request', () => {
  const db = new Store<ShowState>(':memory:');
  try {
    const before = createInitialState('show', 'host-epoch');
    db.save(before);
    const after: ShowState = { ...before, revision: before.revision + 1, versions: [
      { id: 'discovered', title: 'Amateur', artist: 'Nada Surf', rating: 'unrated', source: { provider: 'youtube', videoId: 'Abcdefghijk' } },
    ] };
    assert.throws(() => db.saveDiscoveredKjPick(after, 'invalid'));
    assert.deepEqual(db.load(), before);
    assert.deepEqual(db.collections.snapshot().items, []);
    db.saveDiscoveredKjPick(after, 'discovered');
    assert.deepEqual(db.load(), after);
    assert.deepEqual(db.load()?.requests, []);
    assert.deepEqual(db.collections.snapshot().items, [{ playlistId: KJ_PICKS_ID, versionId: 'discovered' }]);
  } finally { db.close(); }
});

test('missing-song requests are validated and persist independently of show state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-missing-'));
  let db: Store<{ revision: number }> | undefined;
  try {
    assert.equal(normalizeMissingRequest({ singer: '   ', title: 'Song', artist: '' }), null);
    assert.equal(normalizeMissingRequest({ singer: 'Singer', title: 'x'.repeat(201), artist: '' }), null);
    assert.equal(normalizeMissingRequest({ singer: 'Singer', title: 'Song', artist: 7 }), null);
    const input = normalizeMissingRequest({ singer: '  Alex ', title: ' A Song ', artist: ' An Artist ' });
    assert.deepEqual(input, { singer: 'Alex', title: 'A Song', artist: 'An Artist' });
    const file = join(dir, 'show.sqlite');
    db = new Store<{ revision: number }>(file);
    db.save({ revision: 1 });
    db.addMissingSongRequest({ ...input!, id: 'request-1', createdAt: '2026-01-01T00:00:00.000Z' });
    db.close(); db = undefined;
    db = new Store(file);
    assert.deepEqual(db.missingSongRequests(), [{ id: 'request-1', singer: 'Alex', title: 'A Song', artist: 'An Artist', createdAt: '2026-01-01T00:00:00.000Z' }]);
    assert.deepEqual(db.load(), { revision: 1 });
    assert.throws(() => db!.addMissingSongRequest({ ...input!, id: 'request-1', createdAt: '2026-01-01T00:00:00.000Z' }));
    assert.equal(db.missingSongRequests().length, 1);
    db.close(); db = undefined;
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

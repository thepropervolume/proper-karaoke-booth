import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/main/store';

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

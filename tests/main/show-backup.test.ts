import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createInitialState } from '../../src/domain';
import { ShowBackup } from '../../src/main/show-backup';
import { SnapshotCleanupError } from '../../src/main/show-snapshots';
import { Store } from '../../src/main/store';

test('backs up the live Store and never replaces an existing destination', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-store-backup-'));
  const store = new Store<ReturnType<typeof createInitialState>>(join(dir, 'live.sqlite'));
  try {
    const state = createInitialState('show-00001', 'epoch-0001'); state.revision = 7; store.save(state);
    const path = join(dir, 'snapshot.sqlite');
    const controller = new ShowBackup(async () => path, value => store.backup(value));
    assert.equal((await controller.start()).status, 'saved');
    const backup = new Store<typeof state>(path); try { assert.equal(backup.load()?.revision, 7); } finally { backup.close(); }
    const occupied = join(dir, 'occupied.sqlite'); writeFileSync(occupied, 'keep');
    assert.equal((await new ShowBackup(async () => occupied, value => store.backup(value)).start()).status, 'failed');
    assert.equal(readFileSync(occupied, 'utf8'), 'keep');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('shutdown gates a pending picker and waits for a running snapshot', async () => {
  let select!: (path: string) => void, snapshotCalls = 0;
  const picker = new ShowBackup(() => new Promise(resolve => { select = resolve; }), async () => { snapshotCalls++; });
  const result = picker.start(); await Promise.resolve(); assert.equal(picker.needsShutdownWait(), true);
  const stopped = picker.shutdown(); select('path'); assert.equal((await result).status, 'cancelled');
  assert.equal(await stopped, true); assert.equal(snapshotCalls, 0); assert.equal((await picker.start()).status, 'failed');
  let finish!: () => void;
  const backup = new ShowBackup(async () => 'path', () => new Promise(resolve => { finish = resolve; }));
  const active = backup.start(); await new Promise(resolve => setImmediate(resolve));
  let closed = false; const shutdown = backup.shutdown().then(value => { closed = true; return value; });
  await Promise.resolve(); assert.equal(closed, false); finish(); assert.equal((await active).status, 'saved'); assert.equal(await shutdown, true);
});

test('cleanup failures preserve publication state and remain retryable through shutdown', async () => {
  let attempts = 0;
  const controller = new ShowBackup(async () => 'path', async () => { throw new SnapshotCleanupError(true, async () => { if (++attempts < 2) throw Error('locked'); }); });
  assert.deepEqual(await controller.start(), { status: 'cleanup-needed', published: true });
  assert.deepEqual(await controller.retryCleanup(), { status: 'cleanup-needed', published: true });
  assert.equal(controller.needsShutdownWait(), true);
  assert.equal(await controller.shutdown(), true); assert.equal(attempts, 2);
});

test('failed cleanup keeps shutdown unclean', async () => {
  const controller = new ShowBackup(async () => 'path', async () => { throw new SnapshotCleanupError(false, async () => { throw Error('locked'); }); });
  assert.deepEqual(await controller.start(), { status: 'cleanup-needed', published: false });
  assert.equal(await controller.shutdown(), false);
});

test('host filename lookup never returns Unix or Windows directory paths', () => {
  const store = new Store<ReturnType<typeof createInitialState>>(':memory:');
  try {
    store.save(createInitialState('show-00001', 'epoch-0001'), [
      { id: 'win', path: 'C:\\Users\\Host\\Song.mp4', fingerprint: 'a' },
      { id: 'unix', path: '/private/music/Other.mp4', fingerprint: 'b' }]);
    assert.deepEqual(store.mediaFilenames(), { win: 'Song.mp4', unix: 'Other.mp4' });
  } finally { store.close(); }
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MediaReview } from '../../src/main/media-review';

test('reviews only the saved paths and reports no media bytes or private directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-media-review-'));
  try {
    const good = join(directory, 'good.mp4'), empty = join(directory, 'empty.mp4');
    await writeFile(good, 'sample file');
    await writeFile(empty, '');
    const result = await new MediaReview().scan('one', () => [
      { id: 'good', path: good }, { id: 'moved', path: join(directory, 'moving.mp4') },
      { id: 'empty', path: empty }, { id: 'directory', path: directory },
      { id: 'old-relative', path: 'library/old.mp4' },
    ]);
    assert.equal(result.status, 'completed');
    assert.equal(result.checked, 5);
    assert.deepEqual(result.issues.slice(0, 2), [
      { versionId: 'moved', filename: 'moving.mp4', reason: 'missing' },
      { versionId: 'empty', filename: 'empty.mp4', reason: 'invalid' },
    ]);
    assert.deepEqual(result.issues.slice(2).map(issue => issue.reason), ['invalid', 'invalid']);
    assert.equal(JSON.stringify(result).includes(directory), false);
    assert.equal(JSON.stringify(result).includes('sample file'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('marks network or permission failures unavailable and never claims a file is missing', async () => {
  const detector = new MediaReview(async () => { throw Object.assign(new Error('private device failure'), { code: 'EACCES' }); });
  const result = await detector.scan('one', () => [{ id: 'external', path: join(tmpdir(), 'private storage.mp4') }]);
  assert.deepEqual(result, { status: 'completed', checked: 1, issues: [{ versionId: 'external', filename: 'private storage.mp4', reason: 'unavailable' }] });
});

test('cancel fences partial results and a blocked path cannot start overlapping work', async () => {
  let open = 0;
  type Info = { isFile(): boolean; size: number };
  let resolveStorage!: (value: Info) => void;
  const storage = new Promise<Info>(resolve => { resolveStorage = resolve; });
  const detector = new MediaReview(() => { open++; return storage; });
  const location = () => [{ id: 'a', path: join(tmpdir(), 'a.mp4') }, { id: 'b', path: join(tmpdir(), 'b.mp4') }];
  const first = detector.scan('first', location);
  detector.cancel('older');
  assert.deepEqual(await detector.scan('second', location), { status: 'busy' });
  detector.cancel('first');
  assert.deepEqual(await detector.scan('third', location), { status: 'busy' });
  resolveStorage({ isFile: () => true, size: 512 });
  assert.deepEqual(await first, { status: 'cancelled' });
  assert.equal(open, 1);
  assert.deepEqual(await detector.scan('fourth', location), { status: 'completed', checked: 2, issues: [] });
});

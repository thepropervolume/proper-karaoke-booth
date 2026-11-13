import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSingerDisplayId, writeSingerDisplayId } from '../../src/main/display-placement-store';

test('singer monitor state persists atomically and an invalid update preserves the last valid value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-screen-state-'));
  try {
    const path = join(directory, 'placement.json');
    assert.equal(readSingerDisplayId(path), null);
    writeSingerDisplayId(path, 0);
    assert.equal(readSingerDisplayId(path), 0);
    writeSingerDisplayId(path, 123);
    assert.equal(readSingerDisplayId(path), 123);
    const before = await readFile(path, 'utf8');
    assert.throws(() => writeSingerDisplayId(path, NaN), /Invalid singer display/);
    assert.equal(await readFile(path, 'utf8'), before);
    assert.deepEqual(await readdir(directory), ['placement.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt, obsolete, oversized and invalid monitor states are ignored', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-screen-invalid-'));
  try {
    const path = join(directory, 'placement.json');
    for (const content of ['broken', '[]', 'null', '{"version":2,"displayId":1}', '{"version":1,"displayId":"1"}', '{"version":1,"displayId":0.5}', ' '.repeat(1025)]) {
      await writeFile(path, content);
      assert.equal(readSingerDisplayId(path), null, content.slice(0, 50));
    }
    assert.equal(readSingerDisplayId(directory), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

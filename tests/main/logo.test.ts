import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logoDataUrl, loadLogo, MAX_LOGO_BYTES, saveLogo } from '../../src/main/logo';

test('logo selection accepts bounded PNG and JPEG content and preserves prior logo on failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-logo-test-'));
  const source = join(directory, 'selected');
  const target = join(directory, 'managed-logo');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  try {
    await writeFile(source, png);
    const url = await saveLogo(source, target);
    assert.ok(url.startsWith('data:image/png;base64,'));
    assert.equal(await loadLogo(target), url);
    assert.ok(logoDataUrl(Buffer.from([255, 216, 255, 0])).startsWith('data:image/jpeg;base64,'));
    await writeFile(source, 'not an image');
    await assert.rejects(saveLogo(source, target));
    assert.deepEqual(await readFile(target), png);
    assert.throws(() => logoDataUrl(Buffer.alloc(MAX_LOGO_BYTES + 1)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

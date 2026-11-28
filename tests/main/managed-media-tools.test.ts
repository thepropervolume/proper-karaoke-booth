import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ManagedMediaTools, pinnedYtDlp, type PinnedMediaTool } from '../../src/main/managed-media-tools';
import { parseSettings } from '../../src/domain/settings';

const fixture = Buffer.from('Synthetic executable payload, never run.');
const pin: PinnedMediaTool = { name: 'yt-dlp.exe', version: 'synthetic', bytes: fixture.length,
  sha256: createHash('sha256').update(fixture).digest('hex'),
  url: 'https://github.com/yt-dlp/test/releases/download/pinned/yt-dlp.exe' };

test('yt-dlp defaults to the verified Stable pin and preserves the Nightly preference', () => {
  assert.equal(parseSettings({}).ytDlpChannel, 'stable');
  assert.equal(parseSettings({ ytDlpChannel: 'nightly' }).ytDlpChannel, 'nightly');
  assert.throws(() => parseSettings({ ytDlpChannel: 'untrusted' }), /release channel/);
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const stable = pinnedYtDlp('stable', platform, 'x64'), nightly = pinnedYtDlp('nightly', platform, 'x64');
    assert.ok(stable && nightly && stable.sha256 !== nightly.sha256);
    assert.equal(new URL(stable.url).origin, 'https://github.com');
  }
  assert.ok(pinnedYtDlp('stable', 'darwin', 'arm64'));
  assert.equal(pinnedYtDlp('stable', 'freebsd', 'x64'), null);
});

test('concurrent first use stages one verified asset and repairs a corrupted cache slot', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tpv-managed-tools-')));
  let requests = 0;
  const service = new ManagedMediaTools(dir, async input => {
    requests++;
    return String(input) === pin.url
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/synthetic' } })
      : new Response(fixture);
  }, () => pin);
  try {
    assert.deepEqual(await service.status('stable'), { version: 'synthetic', ready: false });
    const [first, second] = await Promise.all([service.prepare('stable'), service.prepare('stable')]);
    assert.equal(first, second);
    assert.deepEqual(await readFile(first), fixture);
    assert.equal(requests, 2);
    assert.deepEqual(await service.status('stable'), { version: 'synthetic', ready: true });
    assert.equal(await service.prepare('stable'), first);
    assert.equal(requests, 2);
    await writeFile(first, Buffer.alloc(fixture.length, 0));
    assert.equal((await service.status('stable')).ready, false);
    assert.equal(await service.prepare('stable'), first);
    assert.deepEqual(await readFile(first), fixture);
    assert.equal(requests, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bad digest, excessive bytes and unexpected redirects leave no executable', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tpv-managed-tools-')));
  let requests = 0;
  try {
    const extra = Buffer.concat([fixture, Buffer.from('untrusted')]);
    const bad = [
      () => new Response(Buffer.alloc(fixture.length, 0)),
      () => new Response(extra),
      () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }),
    ];
    for (const response of bad) {
      const service = new ManagedMediaTools(dir, async () => { requests++; return response(); }, () => pin);
      await assert.rejects(service.prepare('nightly'), /verified yt-dlp/);
      assert.deepEqual(await readdir(dir), []);
    }
    assert.equal(requests, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

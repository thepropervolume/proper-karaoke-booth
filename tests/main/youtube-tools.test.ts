import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, realpath, rm } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveYtDlpExecutable } from '../../src/main/youtube-tools';
import { parseSettings } from '../../src/domain/settings';
import { validStreamingSource } from '../../src/domain/streaming-source';

test('old settings get PATH discovery and explicit yt-dlp paths reject malformed values', () => {
  assert.equal(parseSettings({}).ytDlpExecutable, '');
  assert.equal(parseSettings({ ytDlpExecutable: process.execPath }).ytDlpExecutable, process.execPath);
  for (const value of ['relative.exe', 'bad\npath', null, 42]) assert.throws(() => parseSettings({ ytDlpExecutable: value }));
  assert.equal(validStreamingSource({provider:'youtube',videoId:'abcdefghijk',brandSlug:'TheProperVolume'}), true);
  assert.equal(validStreamingSource({provider:'youtube',videoId:'abcdefghijk',brandSlug:'../escape'}), false);
});
test('resolves selected or absolute PATH executable without executing or accepting shell wrappers', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'yt-tools-')));
  try {
    const path = join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    await writeFile(path, 'fixture, never executed'); await chmod(path, 0o700);
    assert.equal(await resolveYtDlpExecutable('', ['.', 'relative', dir].join(delimiter)), path);
    assert.equal(await resolveYtDlpExecutable(path, ''), path);
    await assert.rejects(resolveYtDlpExecutable('relative', dir), /yt-dlp was not found/);
    await assert.rejects(resolveYtDlpExecutable('', ''), /yt-dlp was not found/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});

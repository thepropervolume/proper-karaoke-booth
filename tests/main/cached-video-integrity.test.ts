import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedVideoIdentityMatches, inspectCachedVideo, sameStoredMedia } from '../../src/main/cached-video-integrity';

test('an explicit cache inspection distinguishes valid saved bytes from corruption without changing either file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-cache-check-')), path = join(directory, 'video.mp4');
  try {
    const original = Buffer.from('original recording bytes'), fingerprint = createHash('sha256').update(original).digest('hex'), media = { id: 'v1', path, fingerprint };
    await writeFile(path, original);
    const valid = await inspectCachedVideo(media, new AbortController().signal); assert.equal(valid.valid, true);
    await writeFile(path, 'corrupted recording');
    const corrupt = await inspectCachedVideo(media, new AbortController().signal); assert.equal(corrupt.valid, false);
    assert.equal(cachedVideoIdentityMatches(path, corrupt.identity), true);
    await rename(path, join(directory, 'old.mp4')); await writeFile(path, 'replacement recording');
    assert.equal(cachedVideoIdentityMatches(path, corrupt.identity), false);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(inspectCachedVideo(media, controller.signal), /cancelled/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('saved-media compare fences absent links and every source field without treating a relink as the same asset', () => {
  const source = { id: 'v1', path: '/original.mp4', fingerprint: 'a'.repeat(64) };
  assert.equal(sameStoredMedia(undefined, undefined), true);
  assert.equal(sameStoredMedia(undefined, source), false); assert.equal(sameStoredMedia(source, undefined), false);
  assert.equal(sameStoredMedia(source, { ...source }), true);
  for (const changed of [{ ...source, id: 'v2' }, { ...source, path: '/relinked.mp4' }, { ...source, fingerprint: 'b'.repeat(64) }])
    assert.equal(sameStoredMedia(source, changed), false);
});

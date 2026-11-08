import { strict as assert } from 'node:assert';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fingerprintMedia, mediaIdentityMatches } from '../../src/main/media-verification';
import { Store } from '../../src/main/store';
import { mediaErrorDetail } from '../../src/main/media-error-message';

test('fingerprints source bytes and detects missing, replaced or edited files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-media-verify-'));
  try {
    const path = join(directory, 'song.mp4'), replacement = join(directory, 'replacement.mp4');
    writeFileSync(path, 'original content');
    const checked = await fingerprintMedia(path);
    assert.equal(checked.fingerprint, createHash('sha256').update('original content').digest('hex'));
    assert.equal(await mediaIdentityMatches(path, checked.identity), true);
    writeFileSync(replacement, 'different bytes!'); renameSync(replacement, path);
    assert.equal(await mediaIdentityMatches(path, checked.identity), false);
    assert.notEqual((await fingerprintMedia(path)).fingerprint, checked.fingerprint);
    rmSync(path); assert.equal(await mediaIdentityMatches(path, checked.identity), false);
    await assert.rejects(fingerprintMedia(path));
    const abort = new AbortController(); abort.abort(); await assert.rejects(fingerprintMedia(path, abort.signal), /cancelled/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('playback warnings map only bounded codes and never echo arbitrary renderer text', () => {
  assert.match(mediaErrorDetail('MEDIA_ERR_NETWORK'), /relink/i);
  assert.match(mediaErrorDetail('MEDIA_ERR_DECODE'), /codec/i);
  assert.match(mediaErrorDetail('MEDIA_ERR_SRC_NOT_SUPPORTED'), /codec/i);
  assert.match(mediaErrorDetail('PLAY_BLOCKED'), /blocked/i);
  assert.doesNotMatch(mediaErrorDetail('C:\\private\\song.mp4'), /private|song\.mp4/i);
});

test('conditional relink updates only the matched row and preserves fingerprint and show state', () => {
  const store = new Store<{ revision: number }>(':memory:');
  try {
    store.save({ revision: 3 }, [{ id: 'song-1', path: '/old/song.mp4', fingerprint: 'hash1' }]);
    const expected = store.media('song-1')!;
    assert.equal(store.relinkMedia({ ...expected, fingerprint: 'wrong' }, '/wrong/song.mp4'), false);
    assert.equal(store.relinkMedia(expected, '/new/song.mp4'), true);
    assert.deepEqual({ ...store.media('song-1') }, { ...expected, path: '/new/song.mp4' });
    assert.equal(store.relinkMedia(expected, '/stale/song.mp4'), false);
    assert.deepEqual(store.load(), { revision: 3 });
    assert.equal(store.byFingerprint('hash1')?.path, '/new/song.mp4');
  } finally { store.close(); }
});

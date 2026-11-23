import { strict as assert } from 'node:assert';
import { mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fingerprintMedia, fingerprintPlaybackMedia, mediaIdentityMatches, verifyAndRelinkMedia } from '../../src/main/media-verification';
import { inspectMediaLocation } from '../../src/main/media-review';
import { Store } from '../../src/main/store';
import { mediaErrorDetail, mediaVerificationDetail } from '../../src/main/media-error-message';

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
  const denied = { code: 'EACCES', message: 'C:\\private\\song.mp4' };
  assert.match(mediaVerificationDetail(denied, false), /permissions.+press Play/);
  assert.doesNotMatch(mediaVerificationDetail(denied, false), /private|song\.mp4/i);
  assert.match(mediaVerificationDetail({ code: 'ENOENT' }, true), /Restore access and press Play.+return the request/);
  assert.match(mediaVerificationDetail({ code: 'EIO' }, false), /drive connection/);
  assert.doesNotMatch(mediaVerificationDetail(new Error('temporary read problem'), false), /Relink File/);
  assert.match(mediaErrorDetail('MEDIA_ERR_SRC_NOT_SUPPORTED'), /return the request to the queue.+supported codec/);
});

test('playback retries a settling sync file but still verifies its original bytes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-media-retry-'));
  try {
    const original = join(directory, 'song.mp4');
    writeFileSync(original, 'original recording');
    const signal = new AbortController().signal;
    let attempts = 0;
    const checked = await fingerprintPlaybackMedia(original, signal, async (path, activeSignal) => {
      if (++attempts === 1) throw Object.assign(new Error('Cloud file changed during its first open'), { code: 'ERR_MEDIA_CHANGED_DURING_READ' });
      return fingerprintMedia(path, activeSignal);
    });
    assert.equal(attempts, 2);
    assert.equal(checked.fingerprint, createHash('sha256').update('original recording').digest('hex'));
    rmSync(original);
    attempts = 0;
    await assert.rejects(fingerprintPlaybackMedia(original, signal, (path, activeSignal) => {
      attempts++; return fingerprintMedia(path, activeSignal);
    }), { code: 'ENOENT' });
    assert.equal(attempts, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('local file inspection distinguishes known absence from temporary denial', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-media-location-'));
  try {
    const original = join(directory, 'song.mp4');
    assert.equal(await inspectMediaLocation(original), 'missing');
    assert.equal(await inspectMediaLocation(directory), 'invalid');
    writeFileSync(original, 'original recording');
    assert.equal(await inspectMediaLocation(original), undefined);
    assert.equal(await inspectMediaLocation(original, async () => {
      throw Object.assign(new Error('Temporary read problem'), { code: 'EACCES' });
    }), 'unavailable');
  } finally { rmSync(directory, { recursive: true, force: true }); }
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

test('relink rejects symbolic links without changing the stored source', async context => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-relink-'));
  const store = new Store<{ revision: number }>(':memory:');
  try {
    const original = join(directory, 'original.mp4'), link = join(directory, 'linked.mp4');
    writeFileSync(original, 'original recording');
    const { fingerprint, identity } = await fingerprintMedia(original);
    store.save({ revision: 1 }, [{ id: 'song', path: '/old/song.mp4', fingerprint }]);
    const stored = store.media('song')!;
    try { symlinkSync(original, link, 'file'); }
    catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        context.skip('Windows session cannot create file symlinks.'); return;
      }
      throw error;
    }
    assert.equal(await mediaIdentityMatches(link, identity), false);
    await assert.rejects(verifyAndRelinkMedia(link, fingerprint, new AbortController().signal,
      () => true, () => store.relinkMedia(stored, link)), /could not be verified/i);
    assert.equal(store.media('song')?.path, '/old/song.mp4');
    await verifyAndRelinkMedia(original, fingerprint, new AbortController().signal,
      () => true, () => store.relinkMedia(stored, original));
    assert.equal(store.media('song')?.path, original);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('relink retains the old source when the authority no longer permits the update', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-relink-race-'));
  const store = new Store<{ revision: number }>(':memory:');
  try {
    const candidate = join(directory, 'candidate.mp4');
    writeFileSync(candidate, 'original recording');
    const { fingerprint } = await fingerprintMedia(candidate);
    store.save({ revision: 1 }, [{ id: 'song', path: '/old/song.mp4', fingerprint }]);
    const stored = store.media('song')!;
    await assert.rejects(verifyAndRelinkMedia(candidate, fingerprint, new AbortController().signal,
      () => false, () => store.relinkMedia(stored, candidate)), /changed while relinking/i);
    assert.equal(store.media('song')?.path, '/old/song.mp4');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

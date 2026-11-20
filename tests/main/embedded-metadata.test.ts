import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseEmbeddedMetadata, readEmbeddedMp4 } from '../../src/main/embedded-metadata';

const hasTools = ['ffmpeg', 'ffprobe'].every(file => spawnSync(file, ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0);

test('reads only bounded format-level Artist and Title without adopting stream or unrelated tags', () => {
  assert.deepEqual(parseEmbeddedMetadata({ format: { tags: { title: '  Été ', artist: '  Beyoncé ', comment: 'ignored',
    'com.apple.quicktime.artist': 'not the effective artist' } }, streams: [{ tags: { title: 'Wrong title' } }] }), { title: 'Été', artist: 'Beyoncé' });
  assert.deepEqual(parseEmbeddedMetadata({ format: {} }), { title: null, artist: null });
  assert.deepEqual(parseEmbeddedMetadata({ format: { tags: { title: 'A\0B', artist: 'x'.repeat(501) } } }), { title: null, artist: null });
  assert.deepEqual(parseEmbeddedMetadata({ format: { tags: { title: 123, artist: ' ' } } }), { title: null, artist: null });
  assert.throws(() => parseEmbeddedMetadata({ format: { tags: ['bad output'] } }), /Invalid container tag data/);
  assert.throws(() => parseEmbeddedMetadata(null), /Invalid container tag data/);
});

test('only accepts an absolute MP4 and suppresses work after cancellation', async () => {
  const media = { id: 'local', path: 'some.mp4', fingerprint: 'a'.repeat(64) };
  assert.deepEqual(await readEmbeddedMp4(media, [], new AbortController().signal), { status: 'unsupported' });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await readEmbeddedMp4(media, [], controller.signal), { status: 'cancelled' });
});

test('FFprobe reports real MP4 tags without modifying the file and refuses changed or managed assets', { skip: !hasTools }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tpv-embedded-tags-'));
  try {
    const path = join(dir, 'Tagged Été.mp4');
    const encoded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=160x90:r=20:d=1', '-c:v', 'libx264',
      '-metadata', 'title=Already Tagged Été', '-metadata', 'artist=Tagged Beyoncé', path], { windowsHide: true });
    assert.equal(encoded.status, 0, encoded.stderr?.toString());
    const original = await readFile(path);
    const media = { id: 'ordinary-local', path, fingerprint: createHash('sha256').update(original).digest('hex') };
    const signal = new AbortController().signal;
    assert.deepEqual(await readEmbeddedMp4(media, [], signal), { status: 'ready', title: 'Already Tagged Été', artist: 'Tagged Beyoncé' });
    assert.deepEqual(await readEmbeddedMp4({ ...media, fingerprint: 'f'.repeat(64) }, [], signal), { status: 'changed' });
    assert.deepEqual(await readEmbeddedMp4(media, [dir], signal), { status: 'unsupported' });
    assert.deepEqual(await readFile(path), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

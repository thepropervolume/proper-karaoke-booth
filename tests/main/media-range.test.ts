import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaRange } from '../../src/main/media-range';
import { serveBumper } from '../../src/main/bumper-media';

test('parses full, prefix, bounded, open-ended and suffix byte ranges', () => {
  assert.deepEqual(mediaRange(null, 10), { start: 0, end: 9, partial: false });
  assert.deepEqual(mediaRange('bytes=0-2', 10), { start: 0, end: 2, partial: true });
  assert.deepEqual(mediaRange('bytes=5-8', 10), { start: 5, end: 8, partial: true });
  assert.deepEqual(mediaRange('bytes=7-', 10), { start: 7, end: 9, partial: true });
  assert.deepEqual(mediaRange('bytes=8-500', 10), { start: 8, end: 9, partial: true });
  assert.deepEqual(mediaRange('bytes=-2', 10), { start: 8, end: 9, partial: true });
  assert.deepEqual(mediaRange('bytes=-50', 10), { start: 0, end: 9, partial: true });
});

test('rejects malformed, multiple, unsafe, and unsatisfiable ranges', () => {
  for (const value of ['', 'bytes=-', 'bytes=-0', 'bytes=4-3', 'bytes=10-', 'bytes=0-1,3-4',
    'items=0-3', 'bytes=+1-2', 'bytes=-9007199254740992', 'bytes=9007199254740992-']) {
    assert.equal(mediaRange(value, 10), null, value);
  }
  assert.equal(mediaRange(null, 0), null);
  assert.equal(mediaRange('bytes=0-', 0), null);
});

test('bumper streaming returns requested suffix bytes and preserves status and content headers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-bumper-range-'));
  const file = join(directory, 'track.mp3');
  const state = { status: 'playing', generation: 'generation', trackId: 'track' } as const;
  const tracks = [{ id: 'track', name: 'Track', path: file }];
  try {
    writeFileSync(file, '0123456789');
    const suffix = await serveBumper(new Request('tpv-media://bumper/generation', { headers: { Range: 'bytes=-3' } }), state, tracks);
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-type'), 'audio/mpeg');
    assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
    assert.equal(suffix.headers.get('content-length'), '3');
    assert.equal(await suffix.text(), '789');
    const invalid = await serveBumper(new Request('tpv-media://bumper/generation', { headers: { Range: 'bytes=0-1,3-4' } }), state, tracks);
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), 'bytes */10');
    const full = await serveBumper(new Request('tpv-media://bumper/generation'), state, tracks);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-length'), '10');
    assert.equal(await full.text(), '0123456789');
    writeFileSync(file, '');
    const empty = await serveBumper(new Request('tpv-media://bumper/generation'), state, tracks);
    assert.equal(empty.status, 404);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

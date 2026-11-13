import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { serveBumper } from '../../src/main/bumper-media';
import type { BumperSnapshot } from '../../src/main/bumper-controller';

test('bumper media is restricted to the current generation and supports bounded ranges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-bumper-media-'));
  try {
    const path = join(dir, 'sample.wav');
    writeFileSync(path, Buffer.from('0123456789'));
    const tracks = [{ id: 'track', name: 'Example', path }];
    const active: BumperSnapshot = { status: 'playing', trackId: 'track', generation: 'current' };
    const fetch = (url: string, state: BumperSnapshot = active, headers?: Record<string, string>) =>
      serveBumper(new Request(url, { headers }), state, tracks);
    assert.equal((await fetch('tpv-media://bumper/stale')).status, 404);
    assert.equal((await fetch('tpv-media://other/current')).status, 404);
    assert.equal((await fetch('tpv-media://bumper/current', { ...active, status: 'stopped' })).status, 404);
    const whole = await fetch('tpv-media://bumper/current');
    assert.equal(whole.status, 200);
    assert.equal(await whole.text(), '0123456789');
    const range = await fetch('tpv-media://bumper/current', active, { Range: 'bytes=2-4' });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('Content-Range'), 'bytes 2-4/10');
    assert.equal(await range.text(), '234');
    assert.equal((await fetch('tpv-media://bumper/current', active, { Range: 'bytes=15-20' })).status, 416);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

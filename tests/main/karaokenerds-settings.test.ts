import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings, writeSettings } from '../../src/main/settings';

test('video cache preferences upgrade and persist without overwriting valid settings on failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-kn-settings-'));
  const path = join(dir, 'settings.json');
  try {
    writeFileSync(path, JSON.stringify({ appearance: 'day' }));
    const old = readSettings(path);
    assert.equal(old.karaokeNerdsAutoCache, false);
    const saved = writeSettings(path, { ...old, karaokeNerdsCacheDirectory: '/media/videos', karaokeNerdsAutoCache: true,
      karaokeNerdsBrands: ['PVOL'], karaokeNerdsArtists: ['Nada Surf'] });
    assert.deepEqual(readSettings(path), saved);
    const before = readFileSync(path, 'utf8');
    assert.throws(() => writeSettings(path, { ...saved, karaokeNerdsCacheDirectory: 'relative' }));
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

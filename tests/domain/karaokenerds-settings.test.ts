import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings } from '../../src/domain/settings';

test('video cache planning preferences default off and accept portable absolute paths', () => {
  const defaults = parseSettings({});
  assert.equal(defaults.karaokeNerdsCacheDirectory, '');
  assert.equal(defaults.karaokeNerdsAutoCache, false);
  assert.deepEqual(defaults.karaokeNerdsBrands, []);
  assert.deepEqual(defaults.karaokeNerdsArtists, []);
  for (const directory of ['/media/videos', 'C:\\Videos', 'C:/Videos', '\\\\server\\share\\videos']) {
    const parsed = parseSettings({ karaokeNerdsCacheDirectory: directory, karaokeNerdsAutoCache: true,
      karaokeNerdsBrands: [' PVOL '], karaokeNerdsArtists: [' Nada Surf '] });
    assert.equal(parsed.karaokeNerdsCacheDirectory, directory);
    assert.equal(parsed.karaokeNerdsAutoCache, true);
    assert.deepEqual(parsed.karaokeNerdsBrands, ['PVOL']);
    assert.deepEqual(parsed.karaokeNerdsArtists, ['Nada Surf']);
  }
});

test('video cache configuration rejects ambiguous, duplicate or malformed values', () => {
  for (const directory of ['videos', 'C:videos', 'bad\npath', '/path\0name', null, 42])
    assert.throws(() => parseSettings({ karaokeNerdsCacheDirectory: directory }));
  for (const karaokeNerdsBrands of [['PVOL', 'pvol'], [''], ['a\nb'], [42], 'PVOL', Array(501).fill('brand')])
    assert.throws(() => parseSettings({ karaokeNerdsBrands }));
  assert.throws(() => parseSettings({ karaokeNerdsArtists: ['x'.repeat(201)] }));
  assert.throws(() => parseSettings({ karaokeNerdsAutoCache: 'yes' }));
  assert.throws(() => parseSettings({ karaokeNerdsApiKey: 'secret' }), /Unknown settings/);
});

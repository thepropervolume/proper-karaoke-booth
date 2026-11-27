import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readContainerMetadata } from '../../src/main/library-media-metadata';
import { djCodeForLibraryResult } from '../../src/renderer/library-song-code';
import type { SongResult } from '../../src/renderer/unified-song-results';

const local: SongResult = {
  id: 'local-1', title: 'A Praise Chorus', artist: 'Jimmy Eat World', rating: 'unrated', persisted: true, resultProvider: 'local',
  djCode: 'OLD', trackNumber: '0428',
};

test('local DJ codes prefer CATALOGNUMBER, then currently configured filename templates, then import data', () => {
  const tags = readContainerMetadata({ format: { tags: { CatalogNumber: ' PVOL-0428 ' } } });
  assert.equal(djCodeForLibraryResult(local, { ...tags, filenameDjCode: 'FILENAME-0428' }), 'PVOL-0428');
  assert.equal(djCodeForLibraryResult(local, { filenameDjCode: 'PVOL-0428' }), 'PVOL-0428');
  assert.equal(djCodeForLibraryResult(local), 'OLD-0428');
});

test('online codes identify the provider recording and preserve distinct KaraFun catalogs', () => {
  const karaFun: SongResult = { ...local, resultProvider: 'karafun', source: { provider: 'karafun', catalog: 'catalog', songId: '428' } };
  assert.equal(djCodeForLibraryResult(karaFun), 'KFUN-428');
  assert.equal(djCodeForLibraryResult({ ...karaFun, source: { provider: 'karafun', catalog: 'community', songId: '428' } }), 'KFUN-C-428');
  const videoId = 'a1b2c3d4E5f';
  assert.equal(djCodeForLibraryResult({ ...local, resultProvider: 'karaokenerds', catalogBrandCode: 'pvol', source: { provider: 'youtube', videoId } }), `PVOL-${videoId}`);
  assert.equal(djCodeForLibraryResult({ ...local, resultProvider: 'youtube', source: { provider: 'youtube', videoId } }), `YT-${videoId}`);
  assert.equal(djCodeForLibraryResult({ ...local, resultProvider: 'partytyme', source: { provider: 'partytyme', catalog: 'consumer', videoId: '428' } }), 'PT-428');
  assert.equal(djCodeForLibraryResult({ ...local, resultProvider: 'sunfly',
    catalogOnly: { provider: 'sunfly', id: 'store:428', providerSku: 'SF-428', durationSeconds: null, language: null, webUrl: null, playbackAvailable: false, title: local.title, artist: local.artist },
  }), 'SF-428');
});

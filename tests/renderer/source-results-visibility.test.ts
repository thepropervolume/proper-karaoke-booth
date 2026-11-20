import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedSongResults } from '../../src/renderer/unified-song-results';
import { emptyYouTubeSearchCounts, type YouTubeSearchResult } from '../../src/domain/youtube-search';

const youtube: YouTubeSearchResult = { provider: 'youtube', status: 'ok', searchId: 'receipt',
  counts: emptyYouTubeSearchCounts(), message: '', qualityNote: '', songs: [{ provider: 'youtube', videoId: 'abcdefghijk',
    title: 'Wonderwall', artist: 'Oasis', durationSeconds: 200, metadataSource: 'youtube-metadata', videoTitle: 'Oasis - Wonderwall',
    watchUrl: 'https://www.youtube.com/watch?v=abcdefghijk', channelId: 'UC1234567890123456789012', channelHandle: null,
    channelName: 'Karaoke', channelUrl: '', channelApproval: 'karaoke-hint' }] };

test('disabled local and Karaoke Nerds rows cannot suppress matching YouTube results', () => {
  const library = [
    { id: 'file', title: 'Wonderwall', artist: 'Oasis', rating: 'clean' as const },
    { id: 'nerds', title: 'Wonderwall', artist: 'Oasis', rating: 'unrated' as const,
      source: { provider: 'youtube' as const, videoId: 'ABCDEFGHIJK', brandSlug: 'Example' } },
  ];
  const options = { karaFunConnected: false, sort: 'import-oldest' as const, youtube };
  assert.deepEqual(unifiedSongResults(library, new Set(), options).map(row => row.id), ['file', 'nerds']);
  assert.deepEqual(unifiedSongResults(library, new Set(), { ...options, sourceVisibility: { local: false, karaokenerds: false } }).map(row => row.id), ['youtube-search:abcdefghijk']);
  assert.equal(library.length, 2, 'hiding results must not delete saved recordings');
});

test('disabled YouTube hides even a previously received discovery reply', () => {
  assert.deepEqual(unifiedSongResults([], new Set(), { karaFunConnected: false, sort: 'import-oldest', youtube,
    sourceVisibility: { youtube: false } }), []);
});

test('an unbranded saved Karaoke Nerds recording follows its discovery source', () => {
  const library = [{ id: 'nerds', title: 'Wonderwall', artist: 'Oasis', rating: 'unrated' as const,
    discoveryOrigin: 'karaokenerds' as const, source: { provider: 'youtube' as const, videoId: 'ABCDEFGHIJK' } }];
  const base = { karaFunConnected: false, sort: 'import-oldest' as const };
  assert.equal(unifiedSongResults(library, new Set(['nerds']), { ...base, sourceVisibility: { youtube: false } })[0].resultProvider, 'karaokenerds');
  assert.deepEqual(unifiedSongResults(library, new Set(['nerds']), { ...base, sourceVisibility: { karaokenerds: false } }), []);
});

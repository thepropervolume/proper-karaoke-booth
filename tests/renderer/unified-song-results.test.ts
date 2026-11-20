import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedSongResults, RESULT_PROVIDER_COLORS } from '../../src/renderer/unified-song-results';
import type { KaraFunSearchReply } from '../../src/domain/karafun';
import type { ProviderCatalogSearchResult } from '../../src/domain/provider-catalog';
import { emptyYouTubeSearchCounts, type YouTubeSearchResult, type YouTubeKaraokeSong } from '../../src/domain/youtube-search';
const reply: KaraFunSearchReply = { status: 'ok', searchId: 'receipt', songs: [
  { catalog: 'catalog', songId: '123', title: 'Provider Title', artist: 'Provider Artist', durationSeconds: 200, explicit: false },
  { catalog: 'community', songId: '123', title: 'Another Recording', artist: 'Same Artist', durationSeconds: 210, explicit: null },
] };

test('authenticated Party Tyme results use normal rows, hide when signed out and supersede its Pro metadata catalog',()=>{
  const partyTyme={status:'ok' as const,searchId:'party-receipt',songs:[{videoId:'34962',title:'Wonderwall',artist:'Oasis',durationSeconds:258,explicit:null}]};
  const catalogs=[{provider:'partytyme',label:'Party Tyme',status:'ok',message:'',songs:[{provider:'partytyme',id:'PH123',title:'Wonderwall',artist:'Oasis',durationSeconds:258,language:'English',webUrl:null,playbackAvailable:false}]}] as ProviderCatalogSearchResult[];
  const connected=unifiedSongResults([],new Set(),{karaFunConnected:false,partyTymeConnected:true,partyTyme,catalogs,sort:'import-oldest'});
  assert.equal(connected.length,1);assert.equal(connected[0].catalogOnly,undefined);assert.deepEqual(connected[0].partyTymeReceipt,{searchId:'party-receipt',videoId:'34962'});assert.equal(connected[0].resultProvider,'partytyme');
  const signedOut=unifiedSongResults(connected,new Set(),{karaFunConnected:false,partyTymeConnected:false,partyTyme,sort:'import-oldest'});assert.deepEqual(signedOut,[]);
});
test('exact source identity merges search matches with the host library, preserving host edits and distinct catalogs', () => {
  const rows = unifiedSongResults([{ id: 'host-edited', title: 'Host Title', artist: 'Host Artist', rating: 'unrated', source: { provider: 'karafun', catalog: 'catalog', songId: '123' } }], new Set(['host-edited']), { karaFun: reply, karaFunConnected: true, sort: 'import-oldest' });
  assert.equal(rows.length, 2); assert.equal(rows[0].id, 'host-edited'); assert.equal(rows[0].title, 'Host Title'); assert.equal(rows[0].persisted, true);
  assert.equal(rows[0].karaFunReceipt, undefined); assert.equal(rows[1].persisted, false);
  assert.deepEqual(rows[1].karaFunReceipt, { searchId: 'receipt', catalog: 'community', songId: '123' });
});
test('connected native results replace search-only KaraFun catalog matches; unsupported services stay visible in the same sort', () => {
  const catalogs = [{ provider: 'karafun', status: 'ok', songs: [{ provider: 'karafun', id: '123', title: 'Duplicate', artist: 'A' }] },
    { provider: 'sunfly', status: 'ok', songs: [{ provider: 'sunfly', id: 'SF10', title: 'A First Song', artist: 'Z' }] }] as ProviderCatalogSearchResult[];
  const rows = unifiedSongResults([], new Set(), { karaFun: reply, catalogs, karaFunConnected: true, sort: 'title-asc' });
  assert.deepEqual(rows.map(row => row.title), ['A First Song', 'Another Recording', 'Provider Title']);
  assert.equal(rows[0].catalogOnly?.provider, 'sunfly'); assert.equal(rows[0].source, undefined); assert.equal(rows[0].karaFunReceipt, undefined);
  const disconnected = unifiedSongResults([], new Set(), { catalogs, karaFunConnected: false, sort: 'import-oldest' });
  assert.deepEqual(disconnected.map(row => row.resultProvider), ['sunfly']);
  const saved = unifiedSongResults([{ id: 'saved', title: 'Host Title', artist: 'A', rating: 'clean', source: { provider: 'karafun', catalog: 'catalog', songId: '123' } }], new Set(['saved']), { catalogs, karaFunConnected: false, sort: 'import-oldest' });
  assert.equal(saved.filter(row => row.resultProvider === 'karafun').length, 0);
  assert.equal(unifiedSongResults([], new Set(), { karaFun: reply, karaFunConnected: false, sort: 'import-oldest' }).length, 0);
});

function youtube(songs: Pick<YouTubeKaraokeSong, 'videoId' | 'artist' | 'title'>[], metadataSource: YouTubeKaraokeSong['metadataSource'] = 'youtube-metadata'): YouTubeSearchResult {
  return { provider: 'youtube', status: 'ok', searchId: 'yt-receipt', counts: emptyYouTubeSearchCounts(), message: '', qualityNote: '',
    songs: songs.map(song => ({ ...song, provider: 'youtube', durationSeconds: 200, metadataSource, videoTitle: song.title, watchUrl: `https://www.youtube.com/watch?v=${song.videoId}`,
      channelId: 'UC1234567890123456789012', channelHandle: null, channelName: 'Karaoke', channelUrl: '', channelApproval: 'karaoke-hint' })) };
}
test('YouTube discovery falls back by song across local, community and other catalogs, without merging recordings', () => {
  const rows = unifiedSongResults([
    { id: 'local', title: 'Wonderwall', artist: 'Oasis', rating: 'clean' },
    { id: 'kn', title: 'Don’t Look Back In Anger', artist: 'Oasis', rating: 'unrated', source: { provider: 'youtube', videoId: 'NerdsTrack1', brandSlug: 'Creator' } },
  ], new Set(['local']), { karaFunConnected: false, sort: 'import-oldest',
    youtube: youtube([{ videoId: 'Discovery01', title: '  WONDERWALL ', artist: 'oasis' }, { videoId: 'Discovery02', title: "Don't Look Back in Anger", artist: 'Oasis' },
      { videoId: 'Discovery03', title: 'Champagne Supernova', artist: 'Oasis' }, { videoId: 'Discovery04', title: 'Wonderwall', artist: 'Ryan Adams' },
      { videoId: 'Discovery05', title: 'Wonderwall', artist: null }, { videoId: 'Discovery06', title: 'Wonderwall (Live)', artist: 'Oasis' },
      { videoId: 'Discovery07', title: 'Some Might Say', artist: 'Oasis' }]),
    catalogs: [{ provider: 'sunfly', status: 'ok', songs: [{ provider: 'sunfly', id: 'SF1', title: 'Some Might Say', artist: 'Oasis' }] }] as ProviderCatalogSearchResult[] });
  assert.deepEqual(rows.map(row => row.id), ['local', 'kn', 'catalog:sunfly:SF1', 'youtube-search:Discovery03', 'youtube-search:Discovery04', 'youtube-search:Discovery05', 'youtube-search:Discovery06']);
  assert.equal(rows[0].rating, 'clean');
});
test('video-title guesses can be reversed; verified artist/track metadata cannot', () => {
  const local = [{ id: 'local', title: 'Wonderwall', artist: 'Oasis', rating: 'clean' as const }];
  const songs = [{ videoId: 'Discovery01', title: 'Oasis', artist: 'Wonderwall' }];
  assert.equal(unifiedSongResults(local, new Set(), { karaFunConnected: false, sort: 'import-oldest', youtube: youtube(songs, 'video-title') }).length, 1);
  assert.equal(unifiedSongResults(local, new Set(), { karaFunConnected: false, sort: 'import-oldest', youtube: youtube(songs) }).length, 2);
});
test('saved YouTube recordings remain selectable; discovery is last even when sorting', () => {
  const local = [{ id: 'saved-yt', title: 'Wonderwall', artist: 'Oasis', rating: 'clean' as const, source: { provider: 'youtube' as const, videoId: 'SavedVideo1' } },
    { id: 'file', title: 'Z Local', artist: 'Z Artist', rating: 'clean' as const }];
  const search = youtube([{ videoId: 'Discovery01', title: 'Wonderwall', artist: 'Oasis' }, { videoId: 'Discovery02', title: 'A Fallback', artist: 'A Artist' }]);
  for (const sort of ['import-oldest', 'title-asc', 'title-desc', 'artist-asc', 'artist-desc'] as const) {
    const rows = unifiedSongResults(local, new Set(['saved-yt', 'file']), { karaFunConnected: false, sort, youtube: search });
    assert.equal(rows.length, 3); assert.equal(rows.at(-1)?.title, 'A Fallback'); assert.ok(rows.some(row => row.id === 'saved-yt' && row.persisted));
  }
});
test('provider colors retain explicit identities and distinguish imported files from online recordings', () => {
  const rows = unifiedSongResults([{ id: 'file', title: 'A', artist: 'B', rating: 'clean' }, { id: 'yt', title: 'Y', artist: 'Z', rating: 'unrated', source: { provider: 'youtube', videoId: 'Abcdefghijk' } }, { id: 'kn', title: 'K', artist: 'N', rating: 'unrated', source: { provider: 'youtube', videoId: 'Abcdefghijl', brandSlug: 'TheProperVolume' } }], new Set(['file', 'yt', 'kn']), { karaFunConnected: false, sort: 'import-oldest' });
  assert.deepEqual(rows.map(row => RESULT_PROVIDER_COLORS[row.resultProvider]), ['#601CE9', '#007bff', '#ff0033']);
  assert.equal(RESULT_PROVIDER_COLORS.karafun, '#d5167a');
  assert.equal(RESULT_PROVIDER_COLORS.partytyme, '#FACC15');
});
test('cached generic YouTube rows also defer to other sources without deleting saved recordings', () => {
  const library = [{ id: 'cached', artist: 'Oasis', title: 'Wonderwall', rating: 'clean' as const, source: { provider: 'youtube' as const, videoId: 'SavedVideo1' } },
    { id: 'file', artist: 'Oasis', title: 'Wonderwall', rating: 'clean' as const }];
  const rows = unifiedSongResults(library, new Set(['cached', 'file']), { karaFunConnected: false, sort: 'import-oldest' });
  assert.deepEqual(rows.map(row => row.id), ['file']); assert.equal(library.length, 2); assert.equal(library[0].id, 'cached');
});

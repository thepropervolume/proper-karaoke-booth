import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedSongResults, RESULT_PROVIDER_COLORS } from '../../src/renderer/unified-song-results';
import type { KaraFunSearchReply } from '../../src/domain/karafun';
import type { ProviderCatalogSearchResult } from '../../src/domain/provider-catalog';
const reply: KaraFunSearchReply = { status: 'ok', searchId: 'receipt', songs: [
  { catalog: 'catalog', songId: '123', title: 'Provider Title', artist: 'Provider Artist', durationSeconds: 200, explicit: false },
  { catalog: 'community', songId: '123', title: 'Another Recording', artist: 'Same Artist', durationSeconds: 210, explicit: null },
] };
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
  assert.equal(disconnected[0].catalogOnly?.provider, 'karafun');
  const saved = unifiedSongResults([{ id: 'saved', title: 'Host Title', artist: 'A', rating: 'clean', source: { provider: 'karafun', catalog: 'catalog', songId: '123' } }], new Set(['saved']), { catalogs, karaFunConnected: false, sort: 'import-oldest' });
  assert.equal(saved.filter(row => row.resultProvider === 'karafun').length, 1);
  assert.equal(saved[0].title, 'Host Title');
});
test('provider colors retain explicit identities and distinguish imported files from online recordings', () => {
  const rows = unifiedSongResults([{ id: 'file', title: 'A', artist: 'B', rating: 'clean' }, { id: 'yt', title: 'Y', artist: 'Z', rating: 'unrated', source: { provider: 'youtube', videoId: 'Abcdefghijk' } }, { id: 'kn', title: 'K', artist: 'N', rating: 'unrated', source: { provider: 'youtube', videoId: 'Abcdefghijl', brandSlug: 'TheProperVolume' } }], new Set(['file', 'yt', 'kn']), { karaFunConnected: false, sort: 'import-oldest' });
  assert.deepEqual(rows.map(row => RESULT_PROVIDER_COLORS[row.resultProvider]), ['#601CE9', '#ff0033', '#007bff']);
  assert.equal(RESULT_PROVIDER_COLORS.karafun, '#d5167a');
});

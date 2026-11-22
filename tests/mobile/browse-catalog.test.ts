import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBrowseSources, parseBrowsePage } from '../../src/mobile/browse-catalog';
import { searchMobileCatalog } from '../../src/relay/mobile-catalog';

const json = (value: unknown) => Response.json(value);

test('public Karaoke Nerds page retains an exact recording ID and continues the same cursor search', async () => {
  const result = await searchMobileCatalog('Oasis', undefined, async (input, init) => {
    assert.equal(String(input), 'http://127.0.0.1:8765/v1/catalog/public/tracks?q=Oasis&limit=50&cursor=next_page');
    assert.equal(init?.credentials, 'omit');
    return json({ items: [{ youtubeId: 'Video123456', artist: 'Oasis', title: 'Wonderwall', brandSlug: 'A-Brand' }], nextCursor: 'another_page' });
  }, { source: 'karaokenerds', cursor: 'next_page' });
  assert.deepEqual(parseBrowsePage(result, 'karaokenerds'), {
    items: [{ id: 'youtube_Video123456', title: 'Wonderwall', artist: 'Oasis', source: 'karaokenerds', recordingId: 'youtube:Video123456', brand: 'A-Brand' }], nextCursor: 'another_page',
  });
});

test('public paid catalogs return metadata only; a Party Tyme Pro code never becomes a consumer recording ID', async () => {
  for (const [source, id] of [['karafun', '12345'], ['partytyme', 'PH12345']] as const) {
    const result = await searchMobileCatalog('Adele', undefined, async (input, init) => {
      assert.equal(String(input), 'http://127.0.0.1:8768/search?source=' + source + '&q=Adele');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      return json({ items: [{ id, artist: 'Adele', title: 'Hello', videoUrl: 'private', token: 'private' }] });
    }, { source, cursor: null });
    const row = parseBrowsePage(result, source).items[0];
    assert.equal(row.recordingId, source === 'karafun' ? 'karafun:catalog:12345' : undefined);
    assert.deepEqual(result.items, [{ id, artist: 'Adele', title: 'Hello' }]);
  }
  assert.throws(() => parseBrowsePage({ items: [{ id: '9234', title: 'Wrong edition', artist: 'Adele' }] }, 'partytyme'), /Invalid catalog song/);
  assert.deepEqual(chooseBrowseSources(['local', 'karafun', 'karafun', 'partytyme', 'youtube']), ['karafun', 'partytyme']);
});

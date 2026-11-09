import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mapBrandToCatalog, youtubeVideoId } from '../../src/catalog/karaokenerds-brand-map';

const item = (Watch: string, Brand: string) => ({ Id: 0, Artist: 'Synthetic Artist', Title: 'Synthetic Song', Brand, Watch, Created: null });
const brand = { name: 'Example Brand', slug: "Example'sBrand" };
const id1 = 'aaaaaaaaaaa', id2 = 'bbbbbbbbbbb', id3 = 'ccccccccccc';

test('derives a brand slug mapping only from exact cached YouTube IDs', () => {
  const catalog = { Items: [item(`https://youtu.be/${id1}`, 'EX'), item(`https://youtu.be/${id2}`, 'EX')] };
  assert.deepEqual(mapBrandToCatalog(brand, [id1, id1, id2, id3], catalog),
    { status: 'resolved', ...brand, upstreamBrand: 'EX', matchedVideos: 2, unmatchedVideos: 1 });
  assert.deepEqual(mapBrandToCatalog(brand, [id3], catalog),
    { status: 'unresolved', ...brand, reason: 'no-matching-videos', matchedVideos: 0, unmatchedVideos: 1 });
});

test('does not guess when evidence points to multiple upstream brands', () => {
  const catalog = { Items: [item(`https://youtu.be/${id1}`, 'ONE'), item(`https://youtu.be/${id2}`, 'TWO')] };
  assert.equal(mapBrandToCatalog(brand, [id1, id2], catalog).status, 'unresolved');
  const shared = { Items: [item(`https://youtu.be/${id1}`, 'ONE'), item(`https://youtu.be/${id1}`, 'TWO')] };
  assert.deepEqual(mapBrandToCatalog(brand, [id1], shared),
    { status: 'unresolved', ...brand, reason: 'ambiguous-brand', matchedVideos: 1, unmatchedVideos: 0 });
});

test('validates video identities and rejects spoofed origins and dangerous brand identities', () => {
  assert.equal(youtubeVideoId(`https://youtu.be/${id1}`), id1);
  assert.equal(youtubeVideoId(`https://www.youtube.com/watch?v=${id1}&list=example`), id1);
  for (const url of [`https://youtu.be.evil.example/${id1}`, `http://youtu.be/${id1}`,
    `https://youtube.com/watch?v=${id1}&v=${id2}`, `https://evil.example/watch?v=${id1}`,
    `https://youtube.com/embed/${id1}`, `https://user@youtu.be/${id1}`]) assert.equal(youtubeVideoId(url), null);
  assert.throws(() => mapBrandToCatalog({ ...brand, slug: '../other' }, [], { Items: [] }));
  assert.throws(() => mapBrandToCatalog({ ...brand, slug: '%2e%2e' }, [], { Items: [] }));
  assert.throws(() => mapBrandToCatalog(brand, ['not-an-id'], { Items: [] }));
});

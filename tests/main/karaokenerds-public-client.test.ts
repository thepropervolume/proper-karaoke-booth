import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveSelectedBrand } from '../../src/catalog/karaokenerds-public-client';

const directory = '<table><thead><tr><th>Brand</th><th>Tracks</th></tr></thead><tbody><tr><td>The Proper Volume</td><td><a href="/Brand/TheProperVolume/">1 Track</a></td></tr></tbody></table>';
const tracks = '<table><thead><tr><th>Artist</th><th>Title</th><th>Date</th></tr></thead><tbody><tr><td>Artist</td><td>Song</td><td>Date</td><td><a href="https://www.youtube.com/watch?v=abcDEF_123-">Watch Online</a></td></tr></tbody></table>';
const catalog = { Items: [{ Id: 0, Artist: 'Artist', Title: 'Song', Brand: 'PVOL', Watch: 'https://youtu.be/abcDEF_123-', Created: null }] };

test('resolves a selected slug from exactly two public pages and cached data', async () => {
  const urls: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    urls.push(String(input)); assert.equal(init?.redirect, 'error');
    return new Response(urls.length === 1 ? directory : tracks);
  };
  const result = await resolveSelectedBrand('TheProperVolume', catalog, fake);
  assert.deepEqual(urls, ['https://www.karaokenerds.com/Community', 'https://www.karaokenerds.com/Brand/TheProperVolume/']);
  assert.equal(result.mapping.status, 'resolved');
  assert.deepEqual(result.matchedVideoIds, ['abcDEF_123-']);
});

test('unknown slugs and malformed pages cannot trigger arbitrary requests or fabricated mappings', async () => {
  let calls = 0;
  const fake: typeof fetch = async () => { calls++; return new Response(directory); };
  await assert.rejects(resolveSelectedBrand('../Other', catalog, fake));
  assert.equal(calls, 0);
  await assert.rejects(resolveSelectedBrand('UnknownBrand', catalog, fake));
  assert.equal(calls, 1);
  const absent = await resolveSelectedBrand('TheProperVolume', { Items: [] }, async (url) => new Response(String(url).endsWith('/Community') ? directory : tracks));
  assert.equal(absent.mapping.status, 'unresolved');
  assert.deepEqual(absent.matchedVideoIds, []);
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createMySqlCatalogReader, type CatalogReadSnapshot } from '../../src/catalog/karaokenerds-mysql-reader';

const request = { query: '', artist: '', brandSlug: '', cursor: null, limit: 1 };
const entry = (artist: string, title: string, brand: string, id: string) => ({ Id: 0, Artist: artist, Title: title, Brand: brand, Watch: `https://youtu.be/${id}`, Created: null });
const snapshot = (): CatalogReadSnapshot => ({ revision: '1', catalog: { Items: [
  entry('Z Artist', 'Zulu', 'B', 'abcdefghij2'), entry('A Artist', 'Alpha', 'A', 'abcdefghij1'),
  entry('<script>', 'Hidden', 'A', 'abcdefghij3'), entry('Unknown', 'No brand', 'UNKNOWN', 'abcdefghij4'),
  entry('Duplicate', 'One', 'A', 'abcdefghij5'), entry('Duplicate', 'Two', 'A', 'abcdefghij5'),
] }, brandMappings: [{ slug: 'BrandA', upstreamBrand: 'A' }, { slug: 'BrandB', upstreamBrand: 'B' }],
  videoMetadata: [{ youtubeId: 'abcdefghij1', brandSlug: 'BrandA' }, { youtubeId: 'abcdefghij2', brandSlug: 'BrandB' },
    { youtubeId: 'abcdefghij3', brandSlug: 'BrandA' }, { youtubeId: 'abcdefghij5', brandSlug: 'BrandA' }],
  videoDates: [{ youtubeId: 'abcdefghij1', uploadDate: '2025-02-03', source: 'yt-dlp' }] });

test('returns only safe and mapped records in deterministic snapshot-paginated order', async () => {
  const reader = createMySqlCatalogReader({ async searchSnapshot() { return snapshot(); } });
  const first = await reader.search(request);
  assert.deepEqual(first.items, [{ artist: 'A Artist', title: 'Alpha', brandSlug: 'BrandA', youtubeId: 'abcdefghij1', uploadDate: '2025-02-03' }]);
  assert.ok(first.nextCursor);
  const second = await reader.search({ ...request, cursor: first.nextCursor });
  assert.deepEqual(second.items, [{ artist: 'Z Artist', title: 'Zulu', brandSlug: 'BrandB', youtubeId: 'abcdefghij2', uploadDate: null }]);
  assert.equal(second.nextCursor, null);
});

test('rejects stale, malformed and query-mismatched cursors rather than mixing snapshots', async () => {
  let revision = '1';
  const reader = createMySqlCatalogReader({ async searchSnapshot() { return { ...snapshot(), revision }; } });
  const first = await reader.search(request);
  assert.ok(first.nextCursor);
  await assert.rejects(reader.search({ ...request, cursor: first.nextCursor, query: 'different' }), /cursor/);
  await assert.rejects(reader.search({ ...request, cursor: '%%%invalid' }), /Invalid/);
  revision = '2';
  await assert.rejects(reader.search({ ...request, cursor: first.nextCursor }), /stale/);
});

test('filters literal search text without SQL construction and returns only yt-dlp dates', async () => {
  const reader = createMySqlCatalogReader({ async searchSnapshot() {
    const data = snapshot(); data.videoDates = [{ youtubeId: 'abcdefghij1', uploadDate: '2025-02-31', source: 'yt-dlp' }]; return data;
  } });
  const matching = await reader.search({ ...request, query: 'alpha', artist: 'A Artist', brandSlug: 'branda' });
  assert.equal(matching.items.length, 1); assert.equal(matching.items[0].uploadDate, null);
  const injection = await reader.search({ ...request, query: "' OR 1=1 --" });
  assert.deepEqual(injection.items, []);
});

test('validates limit and metadata, and serializes resource-heavy searches', async () => {
  let release!: (value: CatalogReadSnapshot) => void;
  const reader = createMySqlCatalogReader({ searchSnapshot: () => new Promise(resolve => { release = resolve; }) });
  const pending = reader.search(request);
  await assert.rejects(reader.search(request), /busy/);
  release(snapshot()); await pending;
  await assert.rejects(reader.search({ ...request, limit: 101 }), /Invalid/);
  const invalid = snapshot(); invalid.brandMappings = [...invalid.brandMappings, invalid.brandMappings[0]];
  await assert.rejects(createMySqlCatalogReader({ async searchSnapshot() { return invalid; } }).search(request), /Ambiguous/);
});

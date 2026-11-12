import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createMySqlCatalogReader, type CatalogReadSnapshot } from '../../src/catalog/karaokenerds-mysql-reader';

const request = { query: '', artist: '', brandSlug: '', cursor: null, limit: 1 };
const entry = (artist: string, title: string, brand: string, id: string) => ({ Id: 0, Artist: artist, Title: title, Brand: brand, Watch: `https://youtu.be/${id}`, Created: null });
const snapshot = (): CatalogReadSnapshot => ({ revision: '1', lastAttempt: 2000, lastSuccess: 1000, catalog: { Items: [
  entry('Z Artist', 'Zulu', 'B', 'abcdefghij2'), entry('A Artist', 'Alpha', 'A', 'abcdefghij1'),
  entry('<script>', 'Hidden', 'A', 'abcdefghij3'), entry('Unknown', 'No brand', 'UNKNOWN', 'abcdefghij4'),
  entry('Duplicate', 'One', 'A', 'abcdefghij5'), entry('Duplicate', 'Two', 'A', 'abcdefghij5'),
] }, brandMappings: [{ slug: 'BrandA', upstreamBrand: 'A' }, { slug: 'BrandB', upstreamBrand: 'B' }],
  videoMetadata: [{ youtubeId: 'abcdefghij1', brandSlug: 'BrandA' }, { youtubeId: 'abcdefghij2', brandSlug: 'BrandB' },
    { youtubeId: 'abcdefghij3', brandSlug: 'BrandA' }, { youtubeId: 'abcdefghij5', brandSlug: 'BrandA' }],
  videoDates: [{ youtubeId: 'abcdefghij1', uploadDate: '2025-02-03', source: 'yt-dlp' }] });

test('returns safe mapped and unmapped records in deterministic snapshot-paginated order', async () => {
  const reader = createMySqlCatalogReader({ async searchSnapshot() { return snapshot(); } });
  const first = await reader.search(request);
  assert.deepEqual(first.items, [{ artist: 'A Artist', title: 'Alpha', brandSlug: 'BrandA', brandCode: 'A', youtubeId: 'abcdefghij1', uploadDate: '2025-02-03' }]);
  assert.deepEqual(first.metadata, { revision: '1', lastAttempt: 2000, lastSuccess: 1000 });
  assert.ok(first.nextCursor);
  const second = await reader.search({ ...request, cursor: first.nextCursor });
  assert.deepEqual(second.items, [{ artist: 'Unknown', title: 'No brand', brandSlug: '', brandCode: 'UNKNOWN', youtubeId: 'abcdefghij4', uploadDate: null }]);
  assert.ok(second.nextCursor);
  const third = await reader.search({ ...request, cursor: second.nextCursor });
  assert.deepEqual(third.items, [{ artist: 'Z Artist', title: 'Zulu', brandSlug: 'BrandB', brandCode: 'B', youtubeId: 'abcdefghij2', uploadDate: null }]);
  assert.equal(third.nextCursor, null);
});

test('reports freshness and raw/searchable counts from one coherent snapshot', async () => {
  let calls = 0;
  const reader = createMySqlCatalogReader({ async searchSnapshot() { calls++; return snapshot(); } });
  assert.deepEqual(await reader.status(), { revision: '1', lastAttempt: 2000, lastSuccess: 1000, recordCount: 6, searchableCount: 3 });
  assert.equal(calls, 1);
});

test('does not infer video slugs and excludes conflicting saved identities', async () => {
  const data = snapshot();
  data.videoMetadata = [
    { youtubeId: 'abcdefghij1', brandSlug: 'BrandB' }, // Conflicts with the feed's A code.
    { youtubeId: 'abcdefghij4', brandSlug: 'BrandA' }, // No verified feed-brand join.
  ];
  const reader = createMySqlCatalogReader({ async searchSnapshot() { return data; } });
  const found = await reader.search({ ...request, limit: 100 });
  assert.deepEqual(found.items, [{ artist: 'Z Artist', title: 'Zulu', brandSlug: '', brandCode: 'B', youtubeId: 'abcdefghij2', uploadDate: null }]);
  assert.deepEqual((await reader.search({ ...request, brandSlug: 'BrandB' })).items, []);
  assert.equal((await reader.status()).searchableCount, 1);
});

test('rejects stale, malformed and query-mismatched cursors rather than mixing snapshots', async () => {
  let revision = '1', now = 0;
  const reader = createMySqlCatalogReader({ async searchSnapshot() { return { ...snapshot(), revision }; } }, { now: () => now, cacheTtlMs: 100 });
  const first = await reader.search(request);
  assert.ok(first.nextCursor);
  await assert.rejects(reader.search({ ...request, cursor: first.nextCursor, query: 'different' }), /cursor/);
  await assert.rejects(reader.search({ ...request, cursor: '%%%invalid' }), /Invalid/);
  revision = '2';
  assert.equal((await reader.search({ ...request, cursor: first.nextCursor })).metadata?.revision, '1');
  now = 100;
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

test('matches all normalized search terms across artist and title together', async () => {
  const data = snapshot();
  data.catalog.Items = [entry('Nada   Surf', 'Amateur (Live)', 'UNKNOWN', 'abcdefghij6')];
  const reader = createMySqlCatalogReader({ async searchSnapshot() { return data; } });
  for (const query of ['Nada Surf Amateur', '  AMATEUR   nada  ', 'surf live']) {
    assert.equal((await reader.search({ ...request, query })).items[0]?.youtubeId, 'abcdefghij6');
  }
  for (const query of ['Nada Surf Missing', 'amateur other']) {
    assert.deepEqual((await reader.search({ ...request, query })).items, []);
  }
});

test('keeps the artist and title boundary compatible with the 500-character client limit', async () => {
  const data = snapshot();
  data.catalog.Items = [entry('A'.repeat(500), 'T'.repeat(500), 'UNKNOWN', 'abcdefghij6'),
    entry('A'.repeat(501), 'Title', 'UNKNOWN', 'abcdefghij7'), entry('Artist', 'T'.repeat(501), 'UNKNOWN', 'abcdefghij8')];
  const reader = createMySqlCatalogReader({ async searchSnapshot() { return data; } });
  assert.deepEqual((await reader.search({ ...request, limit: 100 })).items.map(item => item.youtubeId), ['abcdefghij6']);
  assert.equal((await reader.status()).searchableCount, 1);
});

test('validates inputs and coalesces concurrent resource-heavy snapshot reads', async () => {
  let release!: (value: CatalogReadSnapshot) => void;
  let calls = 0;
  const reader = createMySqlCatalogReader({ searchSnapshot: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const pending = reader.search(request), other = reader.search(request), status = reader.status();
  assert.equal(calls, 1);
  release(snapshot());
  const [one, two, metadata] = await Promise.all([pending, other, status]);
  assert.deepEqual(one, two); assert.equal(metadata.searchableCount, 3);
  await reader.search(request); assert.equal(calls, 1);
  await assert.rejects(reader.search({ ...request, limit: 101 }), /Invalid/);
  const invalid = snapshot(); invalid.brandMappings = [...invalid.brandMappings, invalid.brandMappings[0]];
  await assert.rejects(createMySqlCatalogReader({ async searchSnapshot() { return invalid; } }).search(request), /Ambiguous/);
  await assert.rejects(createMySqlCatalogReader({ async searchSnapshot() { return { ...snapshot(), lastAttempt: -1 }; } }).status(), /timestamp/);
});

test('cached public projections cannot be poisoned by a caller or later source-object mutation', async () => {
  const data = snapshot(); let calls = 0;
  const reader = createMySqlCatalogReader({ async searchSnapshot() { calls++; return data; } });
  const first = await reader.search(request);
  // Reflect reports failed writes in both CommonJS and strict ESM; direct
  // assignment throws only in strict mode and otherwise fails silently.
  assert.equal(Reflect.set(first.items[0], 'artist', 'poisoned'), false);
  assert.equal(Reflect.set(first.metadata!, 'revision', 'poisoned'), false);
  data.catalog.Items[1].Artist = 'mutated source';
  assert.equal((await reader.search(request)).items[0].artist, 'A Artist');
  assert.deepEqual((await reader.search({ ...request, query: 'mutated source' })).items, []);
  assert.equal((await reader.status()).revision, '1'); assert.equal(calls, 1);
});

test('expired projections fail closed on refresh error and later recover without accepting old cursors', async () => {
  let now = 0, revision = '1', failed = false, calls = 0;
  const reader = createMySqlCatalogReader({ async searchSnapshot() {
    calls++; if (failed) throw new Error('synthetic unavailable store'); return { ...snapshot(), revision };
  } }, { now: () => now });
  const first = await reader.search(request); assert.ok(first.nextCursor);
  now = 29_999; failed = true;
  assert.equal((await reader.status()).revision, '1'); assert.equal(calls, 1);
  now = 30_000;
  await assert.rejects(reader.status(), /unavailable/);
  await assert.rejects(reader.search(request), /unavailable/);
  assert.equal(calls, 3);
  failed = false; revision = '2';
  await assert.rejects(reader.search({ ...request, cursor: first.nextCursor }), /stale/);
  assert.equal((await reader.status()).revision, '2'); assert.equal(calls, 4);
});

test('cache duration is bounded and optional zero TTL preserves immediate revision checks', async () => {
  for (const cacheTtlMs of [-1, 60_001, Number.NaN])
    assert.throws(() => createMySqlCatalogReader({ async searchSnapshot() { return snapshot(); } }, { cacheTtlMs }), /configuration/);
  let revision = '1', calls = 0;
  const reader = createMySqlCatalogReader({ async searchSnapshot() { calls++; return { ...snapshot(), revision }; } }, { cacheTtlMs: 0 });
  const first = await reader.search(request); revision = '2';
  await assert.rejects(reader.search({ ...request, cursor: first.nextCursor }), /stale/);
  assert.equal(calls, 2);
});

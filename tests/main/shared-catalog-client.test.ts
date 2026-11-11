import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { SharedCatalogClient, type SharedCatalogSearchResult } from '../../src/main/shared-catalog-client';

const token = 'test-client-token-0123456789-abcdefghijklmnopqrstuvwxyz';
const baseUrl = 'https://apps.example.test';
const now = 1794437000000;
const track = { artist: 'Nada Surf', title: 'Amateur', brandSlug: 'TheProperVolume', youtubeId: 'sSaih0_IWEQ', uploadDate: '2023-11-16' };
const meta = { revision: '12', lastSuccess: now - 1000, lastAttempt: now - 500 };
const body = (extra: object = {}) => ({ items: [track], nextCursor: null, metadata: meta, ...extra });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const ready = (result: SharedCatalogSearchResult) => { assert.equal(result.status, 'ready'); if (result.status !== 'ready') throw new Error('Expected ready'); return result; };
async function fixture(run: (folder: string) => Promise<void>) {
  const base = await realpath(tmpdir()), folder = await mkdtemp(join(base, 'tpv-shared-catalog-'));
  try { await run(folder); }
  finally { assert.equal(dirname(await realpath(folder)), base); await rm(folder, { recursive: true, force: true }); }
}

test('HTTPS configuration and searches are validated before network or secret-bearing errors', async () => fixture(async folder => {
  const cacheFile = join(folder, 'cache.json'); let calls = 0;
  for (const override of [{ baseUrl: 'http://127.0.0.1:1234' }, { baseUrl: 'https://user:password@example.test' }, { baseUrl: baseUrl + '?token=secret' }, { token: token + '\n' }, { cacheFile: 'relative' }]) {
    assert.throws(() => new SharedCatalogClient({ baseUrl, token, cacheFile, ...override }), error => error instanceof Error && error.message === 'Invalid shared catalog configuration.');
  }
  const client = new SharedCatalogClient({ baseUrl, token, cacheFile, fetch: async () => { calls++; return json(body()); }, now: () => now });
  for (const value of [{ query: 'x' }, { query: 'ok', limit: 101 }, { query: 'ok', cursor: 'bad / cursor' }, { query: 'ok', brandSlug: '../bad' }, { query: 'ok', extra: 'private' }]) assert.equal((await client.search(value)).status, 'invalid-request');
  assert.equal(calls, 0);
}));

test('uses the fixed read-only contract, preserves exact identities and projects only public fields', async () => fixture(async folder => {
  let calls = 0;
  const client = new SharedCatalogClient({ baseUrl, token, cacheFile: join(folder, 'cache.json'), now: () => now, fetch: async (input, options) => {
    calls++; const url = new URL(String(input)); assert.equal(url.origin, baseUrl); assert.equal(url.pathname, '/v1/catalog/tracks');
    assert.equal(url.searchParams.get('q'), 'Nada Surf & friends'); assert.equal(url.searchParams.get('limit'), '25'); assert.equal(url.searchParams.get('brand'), 'TheProperVolume');
    assert.equal(options?.method, 'GET'); assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer ' + token);
    return json({ ...body(), items: [{ ...track, privatePath: '/private/path', apiKey: 'provider-secret' }], secret: token });
  } });
  const result = ready(await client.search({ query: ' Nada Surf & friends ', brandSlug: 'TheProperVolume', limit: 25 }));
  assert.equal(calls, 1); assert.deepEqual(result.items, [track]); assert.equal(result.revision, '12'); assert.equal(result.lastSuccess, meta.lastSuccess); assert.equal(result.lastAttempt, meta.lastAttempt);
  assert.equal(result.source, 'remote'); assert.equal(result.stale, false); assert.equal(result.cachePersisted, true);
  assert.doesNotMatch(JSON.stringify(result), /private|provider-secret|test-client-token/);
  const cache = await readFile(join(folder, 'cache.json'), 'utf8'); assert.doesNotMatch(cache, /test-client-token|apps\.example|private|provider-secret/);
}));

test('supports unmapped brands and the older response without freshness metadata', async () => fixture(async folder => {
  const client = new SharedCatalogClient({ baseUrl, token, cacheFile: join(folder, 'cache.json'), now: () => now, fetch: async () => json({ items: [{ ...track, brandSlug: '', brandCode: 'PVOL' }], nextCursor: 'next_page' }) });
  const result = ready(await client.search({ query: 'nada' })); assert.equal(result.items[0].brandSlug, ''); assert.equal(result.items[0].brandCode, 'PVOL');
  assert.equal(result.nextCursor, 'next_page'); assert.equal(result.lastSuccess, null); assert.equal(result.stale, true);
}));

test('persists query and status caches across restart and labels offline results stale', async () => fixture(async folder => {
  const options = { baseUrl, token, cacheFile: join(folder, 'cache.json'), now: () => now };
  const online = new SharedCatalogClient({ ...options, fetch: async input => String(input).includes('/status') ? json({ ...meta, recordCount: 64261, searchableCount: 64000 }) : json(body()) });
  ready(await online.search({ query: 'nada' }));
  const status = await online.status(); assert.equal(status.status, 'ready'); if (status.status === 'ready') assert.equal(status.recordCount, 64261);
  const offline = new SharedCatalogClient({ ...options, now: () => now + 30000, fetch: async () => { throw new Error('private signed URL'); } });
  const cached = ready(await offline.search({ query: 'nada' })); assert.equal(cached.source, 'cache'); assert.equal(cached.stale, true); assert.equal(cached.offlineReason, 'unavailable'); assert.equal(cached.fetchedAt, now); assert.deepEqual(cached.items, [track]);
  const cachedStatus = await offline.status(); assert.equal(cachedStatus.status, 'ready'); if (cachedStatus.status === 'ready') { assert.equal(cachedStatus.source, 'cache'); assert.equal(cachedStatus.lastAttempt, meta.lastAttempt); }
  assert.equal((await offline.search({ query: 'never searched' })).status, 'unavailable');
  cached.items[0].title = 'caller mutation'; assert.equal(ready(await offline.search({ query: 'nada' })).items[0].title, 'Amateur');
}));

test('endpoint and credential scope changes never expose a previous cache', async () => fixture(async folder => {
  const cacheFile = join(folder, 'cache.json');
  ready(await new SharedCatalogClient({ baseUrl, token, cacheFile, now: () => now, fetch: async () => json(body()) }).search({ query: 'nada' }));
  for (const change of [{ token: token + '-new' }, { baseUrl: 'https://other.example.test' }, { baseUrl: baseUrl + '/different' }]) {
    const client = new SharedCatalogClient({ baseUrl, token, cacheFile, now: () => now, ...change, fetch: async () => { throw Error('network'); } });
    assert.equal((await client.search({ query: 'nada' })).status, 'unavailable');
  }
}));

test('401/403 invalidate scoped cache and cannot be hidden by fallback or late responses', async () => fixture(async folder => {
  for (const code of [401, 403]) {
    const cacheFile = join(folder, `cache-${code}.json`); let response = 200;
    const client = new SharedCatalogClient({ baseUrl, token, cacheFile, now: () => now, fetch: async () => response === 0 ? Promise.reject(Error('offline')) : response === 200 ? json(body()) : new Response('secret response', { status: response }) });
    ready(await client.search({ query: 'nada' })); response = code;
    assert.equal((await client.search({ query: 'nada' })).status, code === 401 ? 'unauthorized' : 'forbidden');
    response = 0; assert.equal((await client.search({ query: 'nada' })).status, 'unavailable');
    const restarted = new SharedCatalogClient({ baseUrl, token, cacheFile, now: () => now, fetch: async () => { throw Error('offline'); } });
    assert.equal((await restarted.search({ query: 'nada' })).status, 'unavailable');
  }
  let resolveOld!: (value: Response) => void, calls = 0;
  const client = new SharedCatalogClient({ baseUrl, token, cacheFile: join(folder, 'race.json'), now: () => now, fetch: async () => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve; }) : new Response(null, { status: 403 }) });
  const old = client.search({ query: 'nada' }); assert.equal((await client.search({ query: 'other' })).status, 'forbidden'); resolveOld(json(body()));
  assert.equal((await old).status, 'forbidden');
}));

test('transient failures may use cache but malformed, redirected and bad-schema replies may not', async () => fixture(async folder => {
  let next = 200, malformed = false;
  const client = new SharedCatalogClient({ baseUrl, token, cacheFile: join(folder, 'cache.json'), now: () => now, fetch: async () => malformed ? new Response('{bad', { headers: { 'Content-Type': 'application/json' } }) : next === 200 ? json(body()) : new Response(null, { status: next }) });
  ready(await client.search({ query: 'nada' }));
  for (const code of [429, 500, 503]) { next = code; assert.equal(ready(await client.search({ query: 'nada' })).source, 'cache'); }
  next = 302; assert.equal((await client.search({ query: 'nada' })).status, 'invalid-response');
  malformed = true; assert.equal((await client.search({ query: 'nada' })).status, 'invalid-response');
  for (const value of [body({ nextCursor: 'bad cursor' }), body({ metadata: { ...meta, revision: 'not decimal' } }), body({ items: [{ ...track, title: 'x'.repeat(501) }] }), body({ items: [{ ...track, uploadDate: '2026-02-30' }] }), { ...meta, recordCount: 1, searchableCount: 2 }]) {
    const bad = new SharedCatalogClient({ baseUrl, token, cacheFile: join(folder, 'bad.json'), now: () => now, fetch: async () => json(value) });
    assert.equal((await (Object.hasOwn(value, 'items') ? bad.search({ query: 'nada' }) : bad.status())).status, 'invalid-response');
  }
}));

test('timeout and response-size bounds do not emit raw errors or leave a hanging request', async () => fixture(async folder => {
  const options = { baseUrl, token, cacheFile: join(folder, 'cache.json'), now: () => now, timeoutMs: 10 };
  const hung = new SharedCatalogClient({ ...options, fetch: async () => new Promise(() => {}) });
  assert.deepEqual(await hung.search({ query: 'nada' }), { status: 'timed-out' });
  const huge = new SharedCatalogClient({ ...options, fetch: async () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(1024 * 1024 + 1) } }) });
  assert.deepEqual(await huge.search({ query: 'nada' }), { status: 'invalid-response' });
  const streamed = new SharedCatalogClient({ ...options, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }), { headers: { 'Content-Type': 'application/json' } }) });
  assert.deepEqual(await streamed.search({ query: 'nada' }), { status: 'timed-out' });
}));

test('cache corruption/oversize are ignored and failed persistence is reported truthfully', async () => fixture(async folder => {
  const cacheFile = join(folder, 'cache.json');
  for (const raw of ['{bad', JSON.stringify({ format: 99, scope: 'wrong', entries: [] })]) {
    await writeFile(cacheFile, raw);
    const client = new SharedCatalogClient({ baseUrl, token, cacheFile, now: () => now, fetch: async () => { throw Error(); } }); assert.equal((await client.search({ query: 'nada' })).status, 'unavailable');
  }
  const file = await open(cacheFile, 'w'); try { await file.truncate(20 * 1024 * 1024 + 1); } finally { await file.close(); }
  const oversized = new SharedCatalogClient({ baseUrl, token, cacheFile, now: () => now, fetch: async () => { throw Error(); } }); assert.equal((await oversized.search({ query: 'nada' })).status, 'unavailable');
  const occupied = join(folder, 'directory-not-cache'); await mkdir(occupied); let online = true;
  const client = new SharedCatalogClient({ baseUrl, token, cacheFile: occupied, now: () => now, fetch: async () => { if (!online) throw Error(); return json(body()); } });
  assert.equal(ready(await client.search({ query: 'nada' })).cachePersisted, false); online = false;
  assert.equal(ready(await client.search({ query: 'nada' })).cachePersisted, false);
}));

test('persistent query cache evicts older entries at the 100-entry bound', async () => fixture(async folder => {
  const cacheFile = join(folder, 'cache.json');
  const client = new SharedCatalogClient({ baseUrl, token, cacheFile, now: () => now, fetch: async () => json(body()) });
  for (let i = 0; i < 101; i++) ready(await client.search({ query: `query-${i}` }));
  assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).entries.length, 100);
  const offline = new SharedCatalogClient({ baseUrl, token, cacheFile, now: () => now, fetch: async () => { throw Error(); } });
  assert.equal((await offline.search({ query: 'query-0' })).status, 'unavailable'); assert.equal(ready(await offline.search({ query: 'query-100' })).source, 'cache');
}));

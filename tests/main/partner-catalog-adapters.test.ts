import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createPartnerCatalogSearch, getPartnerCatalogStatus, searchPartnerCatalog } from '../../src/main/partner-catalog-adapters';
import type { SunflyCatalogItem, SunflyCatalogResult } from '../../src/main/sunfly-catalog-client';

const first = '2026-11-01T00:00:00.000Z';
const second = '2026-11-02T00:00:00.000Z';
const key = 'fixture-provider-secret';
const item = (id: number, title: string, artist = 'Test Artist'): SunflyCatalogItem => ({
  id, title, artist, type: 'mp4', sku: `test-${id}`, deleted: false, updatedAt: first,
});
const page = (items: SunflyCatalogItem[], nextCursor = first, hasMore = false): SunflyCatalogResult => ({
  status: 'ok', items, nextCursor, hasMore,
});

test('missing or invalid private profiles and invalid queries make no provider requests', async () => {
  let calls = 0;
  const search = createPartnerCatalogSearch({
    stingray: async () => { calls++; throw new Error('unexpected'); },
    sunflyKey: () => { throw new Error('private-path-or-key'); },
    sunflyPage: async () => { calls++; throw new Error('unexpected'); },
  });
  for (const provider of ['stingray', 'sunfly'] as const) {
    assert.equal((await search(provider, undefined, 'test')).status, 'not-configured');
    for (const query of ['', 'ab', 'test\nquery', 'x'.repeat(129), '\u0301\u0301\u0301']) assert.equal((await search(provider, 'private-file', query)).status, 'invalid-input');
  }
  const missing = await search('sunfly', 'private-path', 'test');
  assert.equal(missing.status, 'not-configured');
  assert.doesNotMatch(JSON.stringify(missing), /private-path|private-file|provider-secret/);
  assert.equal(calls, 0);
  assert.equal((await searchPartnerCatalog('sunfly', undefined, 'test')).status, 'not-configured');
});

test('partner status validates only local profile format without claiming verified API or playback access', async () => {
  const parent = realpathSync(tmpdir());
  const dir = mkdtempSync(join(parent, 'tpv-partner-status-'));
  const sunfly = join(dir, 'sunfly'), stingray = join(dir, 'stingray');
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('No network permitted'); };
  try {
    writeFileSync(sunfly, key, { mode: 0o600 });
    writeFileSync(stingray, JSON.stringify({ apiKey: key, deviceId: 'fixture-device', languageCode: 'en', countryCode: 'US' }), { mode: 0o600 });
    for (const [provider, file] of [['sunfly', sunfly], ['stingray', stingray]] as const) {
      const result = await getPartnerCatalogStatus(provider, file);
      assert.equal(result.configured, true); assert.equal(result.searchAvailable, true); assert.equal(result.playbackAvailable, false);
      assert.match(result.message, /API access is not yet verified/);
      assert.doesNotMatch(JSON.stringify(result), /fixture-provider-secret|fixture-device|tpv-partner-status/);
      assert.equal((await getPartnerCatalogStatus(provider, undefined)).configured, false);
    }
    writeFileSync(sunfly, 'invalid\nkey');
    writeFileSync(stingray, JSON.stringify({ apiKey: 'bad\nkey', deviceId: 'fixture-device', languageCode: 'en', countryCode: 'US' }));
    assert.equal((await getPartnerCatalogStatus('sunfly', sunfly)).configured, false);
    assert.equal((await getPartnerCatalogStatus('stingray', stingray)).configured, false);
    writeFileSync(stingray, JSON.stringify({ apiKey: key, deviceId: 'x'.repeat(257), languageCode: 'en', countryCode: 'US' }));
    assert.equal((await getPartnerCatalogStatus('stingray', stingray)).configured, false);
    for (const wrong of [JSON.stringify({ apiKey: key }), '["fixture-key"]', 'fixture@example.invalid:fixture-password']) {
      writeFileSync(sunfly, wrong);
      assert.equal((await getPartnerCatalogStatus('sunfly', sunfly)).configured, false);
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    const actual = realpathSync(dir);
    assert.equal(dirname(actual), parent); assert.ok(basename(actual).startsWith('tpv-partner-status-'));
    rmSync(actual, { recursive: true, force: true });
  }
});

test('obvious wrong-provider credentials never leave the Sunfly process boundary', async () => {
  let requests = 0;
  for (const wrong of [JSON.stringify({ apiKey: key }), '["fixture-key"]', 'fixture@example.invalid:fixture-password', 'fixture key']) {
    const search = createPartnerCatalogSearch({ sunflyKey: () => wrong,
      sunflyPage: async () => { requests++; throw new Error('No network permitted'); } });
    const result = await search('sunfly', 'private-file', 'test');
    assert.equal(result.status, 'not-configured');
    assert.doesNotMatch(JSON.stringify(result), /fixture-provider-secret|fixture-password|fixture@example/);
  }
  assert.equal(requests, 0);
});

test('Stingray maps only bounded metadata and never claims playback or exposes provider data', async () => {
  const search = createPartnerCatalogSearch({ stingray: async (path, query) => {
    assert.equal(path, 'selected-private-file'); assert.equal(query, 'test song');
    return { status: 'ok', songs: [{ id: 'track-1', title: 'Test Song', artist: 'Artist', durationSeconds: 210,
      providerUrl: 'private-signed-url', token: key } as { id: string; title: string; artist: string; durationSeconds: number }] };
  } });
  const result = await search('stingray', 'selected-private-file', ' test song ');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.songs, [{ provider: 'stingray', id: 'track-1', title: 'Test Song', artist: 'Artist',
    durationSeconds: 210, language: null, webUrl: null, playbackAvailable: false }]);
  assert.match(result.message, /search only/i);
  assert.doesNotMatch(JSON.stringify(result), /private|fixture-provider-secret|token/);
});

test('Stingray status failures remain classified without raw errors or credentials', async () => {
  for (const status of ['unauthorized', 'rate-limited', 'unavailable', 'timed-out', 'invalid-response', 'configuration-error'] as const) {
    const search = createPartnerCatalogSearch({ stingray: async () => ({ status }) });
    const result = await search('stingray', 'private-path', 'test');
    assert.equal(result.status, status === 'configuration-error' ? 'not-configured' : status);
    assert.deepEqual(result.songs, []);
    assert.doesNotMatch(JSON.stringify(result), /private-path/);
  }
  const search = createPartnerCatalogSearch({ stingray: async () => { throw new Error(key); } });
  assert.doesNotMatch(JSON.stringify(await search('stingray', 'private-path', 'test')), /fixture-provider-secret/);
});

test('Sunfly waits for every catalog page, applies removals and searches title and artist', async () => {
  const calls: (string | undefined)[] = [];
  const search = createPartnerCatalogSearch({ sunflyKey: () => key, sunflyPage: async (received, query, options) => {
    assert.equal(received, key); assert.equal(query?.limit, 500); assert.ok(options!.timeoutMs! <= 10_000);
    calls.push(query?.since);
    return query?.since === undefined
      ? page([item(1, 'Old Song'), item(2, 'Café Song', 'The Artist')], first, true)
      : page([{ ...item(1, 'Old Song'), deleted: true }, item(3, 'New Hit', 'Another Artist')], second);
  } });
  const result = await search('sunfly', 'private-key-file', 'cafe artist');
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls, [undefined, first]);
  assert.deepEqual(result.songs, [{ provider: 'sunfly', id: '2', title: 'Café Song', artist: 'The Artist',
    durationSeconds: null, language: null, webUrl: null, playbackAvailable: false }]);
  assert.match(result.message, /complete.*snapshot.*24 hours/i);
  const withdrawn = await search('sunfly', 'private-key-file', 'old song');
  assert.equal(withdrawn.status, 'ok'); assert.deepEqual(withdrawn.songs, []);
  assert.equal(calls.length, 2);
});

test('Sunfly never turns a failed later page or a cursor loop into partial or empty matches', async () => {
  for (const failure of ['unauthorized', 'rate-limited', 'timed-out', 'unavailable'] as const) {
    let calls = 0;
    const search = createPartnerCatalogSearch({ sunflyKey: () => key, sunflyPage: async () => ++calls === 1
      ? page([item(1, 'Matching Song')], first, true) : { status: failure } });
    const result = await search('sunfly', 'private-file', 'matching');
    assert.equal(result.status, failure); assert.deepEqual(result.songs, []); assert.equal(calls, 2);
  }
  const loop = createPartnerCatalogSearch({ sunflyKey: () => key, sunflyPage: async () => page([item(1, 'Matching Song')], first, true) });
  assert.equal((await loop('sunfly', 'private-file', 'matching')).status, 'invalid-response');
});

test('Sunfly complete cache is shared across concurrent searches and invalidated by expiry or key rotation', async () => {
  let calls = 0, time = Date.now(), currentKey = key;
  let finish!: (value: SunflyCatalogResult) => void;
  const search = createPartnerCatalogSearch({ now: () => time, sunflyKey: () => currentKey, sunflyPage: async () => {
    calls++; if (calls === 1) return new Promise(resolve => { finish = resolve; });
    return page([item(1, 'Test Song')]);
  } });
  const one = search('sunfly', 'private-file', 'test');
  const two = search('sunfly', 'private-file', 'song');
  finish(page([item(1, 'Test Song')]));
  assert.equal((await one).status, 'ok'); assert.equal((await two).status, 'ok'); assert.equal(calls, 1);
  assert.equal((await search('sunfly', 'private-file', 'artist')).status, 'ok'); assert.equal(calls, 1);
  time += 24 * 60 * 60 * 1000;
  assert.equal((await search('sunfly', 'private-file', 'test')).status, 'ok'); assert.equal(calls, 2);
  currentKey = 'replacement-fixture-key';
  assert.equal((await search('sunfly', 'private-file', 'test')).status, 'ok'); assert.equal(calls, 3);
});

test('Sunfly rejects excessive pages/items, credential echoes and uncooperative timed-out reads', async () => {
  const bounded = createPartnerCatalogSearch({ sunflyKey: () => key, snapshotMaxPages: 1,
    sunflyPage: async () => page([item(1, 'Test Song')], first, true) });
  assert.equal((await bounded('sunfly', 'private-file', 'test')).status, 'invalid-response');
  const oversized = createPartnerCatalogSearch({ sunflyKey: () => key, snapshotMaxItems: 1,
    sunflyPage: async () => page([item(1, 'Test Song'), item(2, 'Test Song')]) });
  assert.equal((await oversized('sunfly', 'private-file', 'test')).status, 'invalid-response');
  const echo = createPartnerCatalogSearch({ sunflyKey: () => key,
    sunflyPage: async () => page([item(1, `Test ${key}`)]) });
  const bad = await echo('sunfly', 'private-file', 'test');
  assert.equal(bad.status, 'invalid-response'); assert.doesNotMatch(JSON.stringify(bad), /fixture-provider-secret/);
  const timeout = createPartnerCatalogSearch({ sunflyKey: () => key, snapshotTimeoutMs: 5,
    sunflyPage: async () => new Promise<SunflyCatalogResult>(() => {}) });
  assert.equal((await timeout('sunfly', 'private-file', 'test')).status, 'timed-out');
});

test('Sunfly allows an empty terminal page with an unchanged cursor and bounds results', async () => {
  let calls = 0;
  const search = createPartnerCatalogSearch({ sunflyKey: () => key, sunflyPage: async () => ++calls === 1
    ? page(Array.from({ length: 25 }, (_, n) => item(n + 1, `Test Song ${n}`)), first, true)
    : page([], first, false) });
  const result = await search('sunfly', 'private-file', 'test');
  assert.equal(result.status, 'ok'); assert.equal(result.songs.length, 20);
});

test('Sunfly unsuccessful scans cool down across queries without retrying automatically', async () => {
  let calls = 0, time = Date.now();
  const search = createPartnerCatalogSearch({ now: () => time, sunflyKey: () => key,
    sunflyPage: async () => { calls++; return { status: 'rate-limited' }; } });
  assert.equal((await search('sunfly', 'private-file', 'test song')).status, 'rate-limited');
  assert.equal((await search('sunfly', 'private-file', 'other song')).status, 'rate-limited');
  assert.equal(calls, 1);
  time += 30_000;
  assert.equal((await search('sunfly', 'private-file', 'other song')).status, 'rate-limited');
  assert.equal(calls, 2);
});

test('Sunfly cached large-library scans yield to the main loop and return detached records', async () => {
  let count = 0;
  const search = createPartnerCatalogSearch({ sunflyKey: () => key, sunflyPage: async () => {
    const offset = count++ * 500;
    return page(Array.from({ length: 500 }, (_, index) => item(offset + index + 1, `Test Song ${offset + index}`)),
      new Date(Date.UTC(2026, 10, 1) + count * 1000).toISOString(), count < 6);
  } });
  const first = await search('sunfly', 'private-file', 'test');
  first.songs[0].title = 'Changed by caller';
  assert.notEqual((await search('sunfly', 'private-file', 'test')).songs[0].title, 'Changed by caller');
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const result = await search('sunfly', 'private-file', 'unmatched query');
  assert.equal(result.status, 'ok'); assert.equal(result.songs.length, 0); assert.equal(yielded, true);
});

test('Sunfly bounds retained metadata volume as well as row count', async () => {
  let count = 0;
  const title = 'Test' + 'a'.repeat(2044), artist = 'Artist' + 'b'.repeat(2042);
  const search = createPartnerCatalogSearch({ sunflyKey: () => key, sunflyPage: async () => {
    const offset = count++ * 500;
    return page(Array.from({ length: 500 }, (_, index) => item(offset + index + 1, title, artist)),
      new Date(Date.UTC(2026, 10, 1) + count * 1000).toISOString(), count < 9);
  } });
  const result = await search('sunfly', 'private-file', 'test');
  assert.equal(result.status, 'invalid-response'); assert.deepEqual(result.songs, []);
});

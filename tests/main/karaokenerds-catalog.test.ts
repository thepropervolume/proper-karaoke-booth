import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CommunityCatalogStore, fetchCommunity, parseCommunityCatalog, validateCommunityUrl } from '../../src/catalog/karaokenerds';

const DAY = 24 * 60 * 60 * 1000;
const URL = 'https://karaokenerds.com/Data/Community?key=synthetic-test-only';
const example = { Items: [{ Id: 0, Artist: 'Example Artist', Title: 'Example Track', Brand: 'Example Brand', Watch: 'https://youtu.be/00000000000', Created: null }] };

test('validates community feed without assuming dates or unique IDs', () => {
  assert.deepEqual(parseCommunityCatalog(example), example);
  assert.deepEqual(parseCommunityCatalog({ Items: [example.Items[0], { ...example.Items[0], Created: '/Date(42)/' }] }).Items.length, 2);
  for (const invalid of [null, [], {}, { Items: [] }, { Items: [{ ...example.Items[0], Created: undefined }] }, { Items: [{ ...example.Items[0], Artist: '' }] }]) {
    assert.throws(() => parseCommunityCatalog(invalid), /Invalid catalog/);
  }
});

test('only permits the specific HTTPS origin and private key parameter', () => {
  assert.equal(validateCommunityUrl(URL).hostname, 'karaokenerds.com');
  for (const invalid of [
    'http://karaokenerds.com/Data/Community?key=test',
    'https://karaokenerds.com.evil.example/Data/Community?key=test',
    'https://karaokenerds.com:444/Data/Community?key=test',
    'https://user:pass@karaokenerds.com/Data/Community?key=test',
    'https://karaokenerds.com/Data/Other?key=test',
    'https://karaokenerds.com/Data/Community?key=test&key=extra',
    'https://karaokenerds.com/Data/Community?key=',
    'https://karaokenerds.com/Data/Community?key=test#fragment',
  ]) assert.throws(() => validateCommunityUrl(invalid), /Invalid Karaoke Nerds URL/);
});

test('sends only the allowed request and refuses errors and oversized responses', async () => {
  let calls = 0;
  const fake: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), URL);
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(JSON.stringify(example), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  assert.deepEqual(await fetchCommunity(URL, fake), example);
  assert.equal(calls, 1);
  await assert.rejects(fetchCommunity(URL, async () => new Response(null, { status: 302 })), /Catalog request failed/);
  await assert.rejects(fetchCommunity(URL, async () => new Response('x', { status: 200, headers: { 'content-length': String(64 * 1024 * 1024 + 1) } })), /Catalog request failed/);
  const chunk = new Uint8Array(1024 * 1024); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(chunk); }, cancel() { cancelled = true; } });
  await assert.rejects(fetchCommunity(URL, async () => new Response(stream)), /Catalog request failed/);
  assert.equal(cancelled, true);
  await assert.rejects(fetchCommunity(URL, async () => { throw Error('synthetic-test-only'); }), error =>
    error instanceof Error && error.message === 'Catalog request failed.' && !String(error.stack).includes('synthetic-test-only'));
  await assert.rejects(fetchCommunity(URL, async () => new Response('synthetic-test-only')), error =>
    error instanceof Error && error.message === 'Catalog request failed.' && !String(error.stack).includes('synthetic-test-only'));
});

test('seeding an existing snapshot reserves the original attempt and cannot replace initialized data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-community-seed-')); const path = join(dir, 'catalog.sqlite');
  let store = new CommunityCatalogStore(path); let calls = 0;
  try {
    assert.throws(() => store.seed(example, Date.now() + DAY), /Invalid initial attempt time/);
    store.seed(example, DAY);
    assert.deepEqual(store.status(), { lastAttempt: DAY, lastSuccess: DAY, nextAttempt: 2 * DAY });
    assert.throws(() => store.seed(example, DAY), /already initialized/);
    store.close(); store = new CommunityCatalogStore(path);
    assert.deepEqual(store.read(), example);
    assert.deepEqual(await store.refresh(async () => { calls++; return example; }, 2 * DAY - 1),
      { status: 'not-due', lastAttempt: DAY, lastSuccess: DAY, nextAttempt: 2 * DAY });
    assert.equal(calls, 0);
    assert.equal((await store.refresh(async () => { calls++; return example; }, 2 * DAY)).status, 'updated');
    assert.equal(calls, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('persists the daily attempt, retains last good data and handles clock regression', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-community-test-')); const path = join(dir, 'catalog.sqlite');
  let store = new CommunityCatalogStore(path); let calls = 0;
  const success = async () => { calls++; return example; };
  try {
    assert.equal(store.read(), null);
    assert.equal((await store.refresh(success, DAY)).status, 'not-initialized');
    assert.equal(calls, 0);
    store.seed(example, 0);
    assert.deepEqual(await store.refresh(success, DAY), { status: 'updated', lastAttempt: DAY, lastSuccess: DAY, nextAttempt: 2 * DAY });
    assert.deepEqual(store.read(), example);
    store.close(); store = new CommunityCatalogStore(path);
    assert.equal((await store.refresh(success, 2 * DAY - 1)).status, 'not-due');
    assert.equal((await store.refresh(success, DAY - 1)).status, 'not-due');
    assert.equal(calls, 1);
    assert.equal((await store.refresh(async () => { calls++; throw Error('synthetic credential in error'); }, 2 * DAY)).status, 'failed');
    assert.equal((await store.refresh(success, 2 * DAY + 1)).status, 'not-due');
    assert.deepEqual(store.read(), example);
    assert.equal((await store.refresh(async () => ({ Items: [{ unexpected: true }] }), 3 * DAY)).status, 'failed');
    assert.deepEqual(store.read(), example);
    assert.equal((await store.refresh(success, 4 * DAY)).status, 'updated');
    assert.equal(calls, 3);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a reserved attempt gates a second store while the request is still running', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-community-race-')); const path = join(dir, 'catalog.sqlite');
  const one = new CommunityCatalogStore(path); const two = new CommunityCatalogStore(path);
  let resolve!: (value: unknown) => void; let calls = 0;
  try {
    one.seed(example, 0);
    const pending = one.refresh(() => { calls++; return new Promise(done => { resolve = done; }); }, DAY);
    assert.equal((await two.refresh(async () => { calls++; return example; }, DAY)).status, 'not-due');
    assert.equal(calls, 1);
    resolve(example);
    assert.equal((await pending).status, 'updated');
    assert.deepEqual(two.read(), example);
  } finally { one.close(); two.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a suspiciously truncated valid response does not replace the prior catalog', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-community-truncated-')); const path = join(dir, 'catalog.sqlite');
  const store = new CommunityCatalogStore(path);
  const prior = { Items: [example.Items[0], example.Items[0], example.Items[0], example.Items[0]] };
  try {
    store.seed(prior, 0);
    assert.equal((await store.refresh(async () => example, DAY)).status, 'failed');
    assert.deepEqual(store.read(), prior);
    assert.equal((await store.refresh(async () => prior, DAY + 1)).status, 'not-due');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('verified brand mappings persist and reject conflicting identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-community-brands-')); const path = join(dir, 'catalog.sqlite');
  let store = new CommunityCatalogStore(path);
  try {
    store.seed(example, 0);
    store.saveBrandMapping({ slug: 'TheProperVolume', name: 'The Proper Volume', upstreamBrand: 'PVOL' }, 10, ['abcDEF_123-']);
    store.close(); store = new CommunityCatalogStore(path);
    assert.deepEqual(store.brandMappings(), [{ slug: 'TheProperVolume', name: 'The Proper Volume', upstreamBrand: 'PVOL', observedAt: 10 }]);
    assert.throws(() => store.saveBrandMapping({ slug: 'AnotherBrand', name: 'Other', upstreamBrand: 'pvol' }, 11), /conflicts/);
    assert.throws(() => store.saveBrandMapping({ slug: 'TheProperVolume', name: 'Other', upstreamBrand: 'OTHER' }, 11), /conflicts/);
    assert.throws(() => store.saveBrandMapping({ slug: '../Bad', name: 'Bad', upstreamBrand: 'BAD' }, 11), /Invalid/);
    assert.throws(() => store.saveBrandMapping({ slug: 'Other', name: 'Other', upstreamBrand: 'OTHER' }, 11, ['abcDEF_123-']), /Video mapping conflicts/);
    assert.equal(store.brandMappings().length, 1);
    assert.deepEqual(store.videoMetadata(), [{ youtubeId: 'abcDEF_123-', brandSlug: 'TheProperVolume', producerTrackCode: null, codeSource: null }]);
    store.saveProducerTrackCode('abcDEF_123-', 'PVOL-003', 'host-confirmed');
    assert.equal(store.videoMetadata()[0].producerTrackCode, 'PVOL-003');
    assert.throws(() => store.saveProducerTrackCode('abcDEF_123-', 'PVOL-004', 'host-confirmed'), /conflicting/);
    assert.throws(() => store.saveProducerTrackCode('unknown0000', 'PVOL-004', 'host-confirmed'), /Unknown/);
    store.saveVideoDates('abcDEF_123-', { uploadDate: '2026-05-21', releaseDate: null, provenance: 'yt-dlp' }, 12);
    assert.deepEqual(store.videoDates('abcDEF_123-'), { uploadDate: '2026-05-21', releaseDate: null, source: 'yt-dlp', observedAt: 12 });
    assert.throws(() => store.saveVideoDates('unknown0000', { uploadDate: null, releaseDate: null, provenance: 'yt-dlp' }, 12), /Unknown/);
    assert.throws(() => store.saveVideoDates('abcDEF_123-', { uploadDate: '2026-02-31', releaseDate: null, provenance: 'yt-dlp' }, 12), /Invalid/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

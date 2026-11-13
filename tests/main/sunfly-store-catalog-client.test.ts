import { strict as assert } from 'node:assert';
import test from 'node:test';
import { SunflyStoreCatalogClient, parseSunflyStoreDetail } from '../../src/main/sunfly-store-catalog-client';

const ORIGIN = 'https://www.sunflykaraoke.com';
const product = (id = 100) => ({ id, name: 'Our Song', sku: 'SF1124621', type: 'variable', parent: 0,
  permalink: ORIGIN + '/karaoke/anne-marie/our-song/', grouped_products: [], categories: [{ slug: 'songs' }, { slug: 'karaoke' }] });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
const html = (value: string) => new Response(value, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
const meta = () => ({ '@context': 'https://schema.org', '@type': ['Product', 'MusicRecording'],
  name: 'Our Song', sku: 'SF1124621', url: product().permalink,
  byArtist: { '@type': 'MusicGroup', name: 'Anne-Marie & Niall Horan' }, duration: 'PT0H2M44S', inLanguage: 'English',
  media: { url: 'https://protected.example/private-media' }, offers: { price: '2.00' } });
const detail = (value: unknown = meta()) => '<html><script type="application/ld+json">' + JSON.stringify(value) + '</script></html>';
const expected = { sku: product().sku, title: product().name, url: product().permalink };

test('Sunfly Store reads public metadata only and keeps store identities separate from streaming IDs', async () => {
  let calls = 0;
  const client = new SunflyStoreCatalogClient({ fetch: async (url, init) => {
    calls++; const parsed = new URL(String(url)); assert.equal(parsed.origin, ORIGIN);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    if (calls === 1) {
      assert.equal(parsed.pathname, '/wp-json/wc/store/v1/products'); assert.equal(parsed.searchParams.get('search'), 'Our Song');
      assert.equal(parsed.searchParams.get('per_page'), '5'); assert.equal(parsed.searchParams.get('page'), '1');
      return json([{ ...product(), resources: { secret: 'private-provider-token' } }]);
    }
    assert.equal(String(url), product().permalink); return html(detail());
  } });
  const result = await client.search('Our Song');
  assert.equal(result.status, 'ok'); assert.equal(result.label, 'Sunfly Store');
  assert.deepEqual(result.songs, [{ provider: 'sunfly', id: 'store:100', providerSku: 'SF1124621', title: 'Our Song', artist: 'Anne-Marie & Niall Horan',
    durationSeconds: 164, language: 'English', webUrl: product().permalink, playbackAvailable: false }]);
  assert.match(result.message, /Artist search is not verified/); assert.match(result.message, /not streaming IDs/);
  assert.doesNotMatch(JSON.stringify(result), /protected\.example|private-provider|offers|media/); assert.equal(calls, 2);
});

test('Sunfly Store artist and duration enrichment requires exact SKU, title and canonical page identity', async () => {
  for (const change of [{ sku: 'SF9999999' }, { name: 'Another Song' }, { url: ORIGIN + '/karaoke/another/song/' }]) {
    const changed = { ...meta(), ...change };
    assert.equal(parseSunflyStoreDetail(detail(changed), expected), null);
    const result = await new SunflyStoreCatalogClient({ fetch: async url => String(url).includes('/wp-json/') ? json([product()]) : html(detail(changed)) }).search('Our Song');
    assert.equal(result.status, 'ok'); assert.equal(result.songs[0].artist, null); assert.equal(result.songs[0].durationSeconds, null);
  }
  assert.equal(parseSunflyStoreDetail(detail({ '@graph': [meta(), meta()] }), expected), null);
  assert.deepEqual(parseSunflyStoreDetail(detail({ '@graph': [meta()] }), expected), { artist: 'Anne-Marie & Niall Horan', durationSeconds: 164, language: 'English' });
});

test('Sunfly Store leaves unknown artists null instead of turning slugs into invented names', async () => {
  const data = { ...meta(), byArtist: undefined };
  assert.deepEqual(parseSunflyStoreDetail(detail(data), expected), { artist: null, durationSeconds: 164, language: 'English' });
  const client = new SunflyStoreCatalogClient({ fetch: async url => String(url).includes('/wp-json/') ? json([product()]) : new Response('private-detail-error', { status: 503 }) });
  const result = await client.search('our song');
  assert.equal(result.status, 'ok'); assert.equal(result.songs[0].artist, null); assert.match(result.message, /could not be verified/);
  assert.doesNotMatch(JSON.stringify(result), /private-detail-error|Anne Marie/);
});

test('Sunfly Store refuses redirect and SSRF-style product links before enrichment', async () => {
  for (const permalink of [
    'http://www.sunflykaraoke.com/karaoke/a/b/', 'https://evil.example/karaoke/a/b/',
    'https://www.sunflykaraoke.com@evil.example/karaoke/a/b/', ORIGIN + ':444/karaoke/a/b/',
    ORIGIN + '/karaoke/a/b/?token=secret', ORIGIN + '/karaoke/a/b/#secret',
    ORIGIN + '/karaoke/a%2fb/c/', ORIGIN + '/wp-admin/private/',
  ]) {
    let calls = 0;
    const result = await new SunflyStoreCatalogClient({ fetch: async () => { calls++; return json([{ ...product(), permalink }]); } }).search('Our Song');
    assert.equal(result.status, 'invalid-response'); assert.equal(calls, 1); assert.deepEqual(result.songs, []);
  }
  const result = await new SunflyStoreCatalogClient({ fetch: async (_url, init) => {
    assert.equal(init?.redirect, 'error'); return new Response('', { status: 302, headers: { Location: 'https://evil.example/' } });
  } }).search('Our Song');
  assert.equal(result.status, 'unavailable');
});

test('Sunfly Store excludes packs, albums, merchandise, variations and backing-only products', async () => {
  let details = 0;
  const client = new SunflyStoreCatalogClient({ fetch: async url => {
    if (!String(url).includes('/wp-json/')) { details++; return html(detail()); }
    return json([{ ...product(1), type: 'bundle' }, { ...product(2), categories: [{ slug: 'albums' }] },
      { ...product(3), parent: 9 }, { ...product(4), sku: 'SFB202601' }, product(5)]);
  } });
  const result = await client.search('Our Song'); assert.equal(result.status, 'ok');
  assert.deepEqual(result.songs.map(song => song.id), ['store:5']); assert.equal(details, 1);
});

test('Sunfly Store rejects contradictory non-song categories even when a pack also has song and karaoke labels', async () => {
  for (const slug of ['albums', 'compilations', 'packs', 'backing-only', 'merchandise']) {
    let details = 0;
    const client = new SunflyStoreCatalogClient({ fetch: async url => {
      if (!String(url).includes('/wp-json/')) { details++; return html(detail()); }
      return json([{ ...product(), categories: [...product().categories, { slug }] }]);
    } });
    const result = await client.search('Our Song');
    assert.equal(result.status, 'ok'); assert.deepEqual(result.songs, []); assert.equal(details, 0);
  }
  // This shared parent category is present on genuine store karaoke songs.
  const client = new SunflyStoreCatalogClient({ fetch: async url => String(url).includes('/wp-json/') ?
    json([{ ...product(), categories: [...product().categories, { slug: 'backingtracks-mp3' }] }]) : html(detail()) });
  assert.equal((await client.search('Our Song')).songs[0].id, 'store:100');
});

test('Sunfly Store detail caches do not reuse a credit after the expected product title changes', async () => {
  let currentTitle = 'Our Song', detailCalls = 0;
  const client = new SunflyStoreCatalogClient({ fetch: async url => {
    if (String(url).includes('/wp-json/')) return json([{ ...product(), name: currentTitle }]);
    detailCalls++; return html(detail());
  } });
  assert.equal((await client.search('Our Song')).songs[0].artist, 'Anne-Marie & Niall Horan');
  currentTitle = 'Different Recording';
  const changed = await client.search('Different Recording');
  assert.equal(changed.songs[0].title, currentTitle);
  assert.equal(changed.songs[0].artist, null); assert.equal(changed.songs[0].durationSeconds, null); assert.equal(detailCalls, 2);
});

test('Sunfly Store shares same-query and product-detail requests and uses bounded expiring caches', async () => {
  let now = 1000, lists = 0, details = 0;
  const client = new SunflyStoreCatalogClient({ now: () => now, fetch: async url => {
    if (String(url).includes('/wp-json/')) { lists++; return json([product()]); }
    details++; return html(detail());
  } });
  const [first, second] = await Promise.all([client.search('Our Song'), client.search('our song')]);
  assert.equal(lists, 1); assert.equal(details, 1); first.songs[0].artist = 'Changed by caller';
  assert.equal(second.songs[0].artist, 'Anne-Marie & Niall Horan');
  await client.search('Different query'); assert.equal(lists, 2); assert.equal(details, 1);
  now += 6 * 60_000; await client.search('Our Song'); assert.equal(lists, 3); assert.equal(details, 1);
  for (let index = 0; index < 33; index++) await client.search('Another query ' + index);
  const before = lists; await client.search('Our Song'); assert.equal(lists, before + 1); assert.equal(details, 1);
  now += 24 * 60 * 60_000; await client.search('Our Song'); assert.equal(details, 2);
});

test('Sunfly Store uses the explicit public SKU filter rather than treating a SKU as a streaming ID', async () => {
  const client = new SunflyStoreCatalogClient({ fetch: async url => {
    const parsed = new URL(String(url)); assert.equal(parsed.searchParams.get('sku'), 'SF1124621'); assert.equal(parsed.searchParams.has('search'), false);
    return json([]);
  } });
  assert.equal((await client.search('sf1124621')).status, 'ok');
});

test('Sunfly Store rejects unexpected SKU-filter results before fetching any detail page', async () => {
  for (const entries of [[{ ...product(), sku: 'SF9999999' }], [product(), { ...product(101), sku: 'SF9999999' }],
    [{ ...product(), sku: 'SFB202601', categories: [{ slug: 'albums' }] }]]) {
    let calls = 0;
    const client = new SunflyStoreCatalogClient({ fetch: async url => {
      calls++; assert.equal(new URL(String(url)).searchParams.get('sku'), 'SF1124621'); return json(entries);
    } });
    const result = await client.search('sf1124621');
    assert.equal(result.status, 'invalid-response'); assert.deepEqual(result.songs, []); assert.equal(calls, 1);
  }
});

test('Sunfly Store rejects malformed and oversized lists, bounds query length and redacts failures', async () => {
  for (const response of [json({ songs: [] }), json(Array.from({ length: 6 }, (_, index) => product(index + 1))),
    json([{ ...product(), name: '<script>secret</script>' }]), json([{ ...product(), categories: null }]),
    new Response('secret', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(513 * 1024) } })]) {
    const result = await new SunflyStoreCatalogClient({ fetch: async () => response }).search('Our Song');
    assert.equal(result.status, 'invalid-response'); assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
  let calls = 0;
  const client = new SunflyStoreCatalogClient({ fetch: async () => { calls++; return json([]); } });
  for (const query of ['', 'a', 'x'.repeat(161), 'our\nsong', '\u212b ']) assert.equal((await client.search(query)).status, 'invalid-input');
  assert.equal(calls, 0); assert.throws(() => new SunflyStoreCatalogClient({ timeoutMs: NaN }));
  for (const [status, expectedStatus] of [[401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate-limited'], [503, 'unavailable']] as const) {
    const result = await new SunflyStoreCatalogClient({ fetch: async () => new Response('private-token', { status }) }).search('Our Song');
    assert.equal(result.status, expectedStatus); assert.doesNotMatch(JSON.stringify(result), /private-token/);
  }
});

test('Sunfly Store deadlines also bound an unresponsive request and do not admit a late response into cache', async () => {
  let finish!: (response: Response) => void, calls = 0;
  const client = new SunflyStoreCatalogClient({ timeoutMs: 5, fetch: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  assert.equal((await client.search('Our Song')).status, 'timed-out');
  finish(json([product()])); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await client.search('Our Song')).status, 'timed-out'); assert.equal(calls, 1);
});

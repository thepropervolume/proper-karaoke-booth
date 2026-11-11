import { strict as assert } from 'node:assert';
import test from 'node:test';
import { inspectStingrayCredentials } from '../../src/main/stingray-auth';
import { StingrayCatalogClient } from '../../src/main/stingray-client';

const credentials = { clientId: 'fixture-id', clientSecret: 'fixture-secret', deviceId: 'test-device' };
const device = { deviceId: 'test-device', languageCode: 'en' as const, countryCode: 'US' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test('OAuth status uses only the documented HTTPS login and discards tokens', async () => {
  const result = await inspectStingrayCredentials(credentials, { fetch: async (url, init) => {
    assert.equal(url, 'https://login.stingray.com/loginapi/oauth/deviceLogin');
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${Buffer.from('fixture-id:fixture-secret').toString('base64')}`);
    assert.equal(new URLSearchParams(String(init?.body)).get('deviceId'), 'test-device');
    return json({ access_token: 'fixture-token', expires_in: 60, token_type: 'Bearer' });
  } });
  assert.deepEqual(result, { status: 'authenticated', expiresInSeconds: 60 });
  assert.doesNotMatch(JSON.stringify(result), /fixture-(?:secret|token)/);
});

test('OAuth refuses malformed results, secrets in errors, redirects, and rate limits', async () => {
  assert.deepEqual(await inspectStingrayCredentials(credentials, { fetch: async () => json({ access_token: 'fixture-token', expires_in: '60' }) }), { status: 'invalid-response' });
  assert.deepEqual(await inspectStingrayCredentials(credentials, { fetch: async () => new Response('fixture-secret', { status: 401 }) }), { status: 'unauthorized' });
  assert.deepEqual(await inspectStingrayCredentials(credentials, { fetch: async () => new Response('x', { status: 429 }) }), { status: 'rate-limited' });
  assert.deepEqual(await inspectStingrayCredentials(credentials, { fetch: async () => { throw new Error('fixture-secret'); } }), { status: 'unavailable' });
  assert.deepEqual(await inspectStingrayCredentials(credentials, { fetch: async () => new Promise<Response>(() => {}), timeoutMs: 10 }), { status: 'timed-out' });
});

test('v1 connects then searches with both documented credentials and projects only safe metadata', async () => {
  let calls = 0; let now = 1000;
  const client = new StingrayCatalogClient('fixture-api-key', { now: () => now, fetch: async (url, init) => {
    calls++; const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-API-KEY'), 'fixture-api-key'); assert.equal(init?.redirect, 'error');
    if (calls === 1) {
      assert.equal(url, 'https://karaoke-api-service-prod.stingray.com/v1/login-device');
      assert.deepEqual(JSON.parse(String(init?.body)), { device_id: 'test-device', language_code: 'en', country_code: 'US' });
      return json({ token: 'fixture-bearer', duration_ms: 5000 });
    }
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'https://karaoke-api-service-prod.stingray.com'); assert.equal(parsed.pathname, '/v1/search-songs');
    assert.equal(parsed.searchParams.get('text'), 'nada surf'); assert.equal(parsed.searchParams.get('search-fields'), 'title,artists');
    assert.equal(headers.get('Authorization'), 'Bearer fixture-bearer');
    assert.equal(String(url).includes('fixture-api-key'), false); assert.equal(String(url).includes('fixture-bearer'), false);
    return json({ songs: [{ id: 'KAR:G:123', title: 'Popular', artist_display_name: 'Nada Surf', duration_sec: 200,
      resources: { video: { uri: 'https://secret.example/signed' } }, thumbnails: { album: 'https://secret.example/cover' } }] });
  } });
  assert.equal(await client.connect(device), 'ok');
  const result = await client.searchSongs('nada surf');
  assert.deepEqual(result, { status: 'ok', songs: [{ id: 'KAR:G:123', title: 'Popular', artist: 'Nada Surf', durationSeconds: 200 }] });
  assert.doesNotMatch(JSON.stringify(result), /secret|fixture/);
  assert.deepEqual(await client.searchSongs('nada surf'), { status: 'rate-limited' });
  now += 5000;
  assert.deepEqual(await client.searchSongs('nada surf'), { status: 'unauthorized' });
  assert.equal(calls, 2);
});

test('v1 rejects invalid input, provider failures, invalid response, and unknown credentials', async () => {
  let now = 1000, calls = 0;
  const client = new StingrayCatalogClient('fixture-api-key', { now: () => now, fetch: async () => {
    calls++; return calls === 1 ? json({ token: 'fixture-bearer', duration_ms: 5000 }) : json({ songs: [{ id: 3, title: 'x' }] });
  } });
  assert.deepEqual(await client.searchSongs('abc'), { status: 'unauthorized' });
  assert.equal(await client.connect({ ...device, countryCode: 'us' }), 'invalid-input'); assert.equal(calls, 0);
  assert.equal(await client.connect(device), 'ok');
  for (const invalid of ['ab', 'a'.repeat(41), 'abc\ndef']) assert.deepEqual(await client.searchSongs(invalid), { status: 'invalid-input' });
  assert.deepEqual(await client.searchSongs('abc', { size: 101 }), { status: 'invalid-input' });
  assert.deepEqual(await client.searchSongs('abc'), { status: 'invalid-response' });
  now += 101; client.disconnect();
  assert.deepEqual(await client.searchSongs('abc'), { status: 'unauthorized' });
  assert.equal(calls, 2);
});

test('disconnect prevents a slow device login from reviving the session', async () => {
  let finish!: (response: Response) => void;
  const client = new StingrayCatalogClient('fixture-api-key', { fetch: async () => new Promise(resolve => { finish = resolve; }) });
  const connecting = client.connect(device); client.disconnect(); finish(json({ token: 'fixture-bearer', duration_ms: 5000 }));
  assert.equal(await connecting, 'unavailable');
  assert.deepEqual(await client.searchSongs('anything'), { status: 'unauthorized' });
});

test('v1 search refuses provider data that echoes an API key or token', async () => {
  for (const fieldName of ['id', 'title', 'artist_display_name'] as const) {
    for (const leaked of ['fixture-api-key', 'fixture-bearer']) {
      let calls = 0;
      const client = new StingrayCatalogClient('fixture-api-key', { fetch: async () => {
        calls++;
        return calls === 1 ? json({ token: 'fixture-bearer', duration_ms: 5000 }) :
          json({ songs: [{ id: 'KAR:G:123', title: 'Title', artist_display_name: 'Artist', [fieldName]: `oops ${leaked}` }] });
      } });
      assert.equal(await client.connect(device), 'ok');
      const result = await client.searchSongs('title');
      assert.deepEqual(result, { status: 'invalid-response' });
      assert.equal(JSON.stringify(result).includes(leaked), false);
    }
  }
});

test('a stalled response is cancelled when OAuth or search times out', async () => {
  let cancelledOAuth = false;
  const stalledOAuth = new ReadableStream<Uint8Array>({ cancel() { cancelledOAuth = true; } });
  assert.deepEqual(await inspectStingrayCredentials(credentials, { fetch: async () => new Response(stalledOAuth), timeoutMs: 10 }), { status: 'timed-out' });
  assert.equal(cancelledOAuth, true);
  let cancelledSearch = false, calls = 0;
  const stalledSearch = new ReadableStream<Uint8Array>({ cancel() { cancelledSearch = true; } });
  const client = new StingrayCatalogClient('fixture-api-key', { timeoutMs: 10, fetch: async () => ++calls === 1 ?
    json({ token: 'fixture-bearer', duration_ms: 5000 }) : new Response(stalledSearch) });
  assert.equal(await client.connect(device), 'ok');
  assert.deepEqual(await client.searchSongs('title'), { status: 'timed-out' });
  assert.equal(cancelledSearch, true);
});

test('v1 search refuses URLs as metadata and drops the session on unauthorized', async () => {
  let calls = 0, now = 1000;
  const client = new StingrayCatalogClient('fixture-api-key', { now: () => now, fetch: async () => {
    calls++;
    if (calls === 1) return json({ token: 'fixture-bearer', duration_ms: 5000 });
    if (calls === 2) return json({ songs: [{ id: 'KAR:G:123', title: 'https://stream.example/signed', artist_display_name: 'Artist' }] });
    return new Response('private details', { status: 401 });
  } });
  assert.equal(await client.connect(device), 'ok');
  assert.deepEqual(await client.searchSongs('title'), { status: 'invalid-response' });
  now += 100; assert.deepEqual(await client.searchSongs('title'), { status: 'unauthorized' });
  now += 100; assert.deepEqual(await client.searchSongs('title'), { status: 'unauthorized' });
  assert.equal(calls, 3);
});

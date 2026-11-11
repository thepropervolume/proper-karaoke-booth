import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { inspectSunflyAccount } from '../../src/main/sunfly-client';

const secret = 'sfk_fixture_secret';
const validAccount = (subscriptionActive: boolean) => ({
  success: true,
  result: {
    userId: 25,
    apiVersion: 2,
    subscriptionActive,
    legacyApiAccess: false,
    keyFirstUsedAtUtc: '2026-10-14T09:12:00Z',
    linkDeliveryAvailable: true,
    subscription: { status: 'Trialing', planCode: 'trial', currentPeriodEndUtc: '2026-11-13T09:00:00Z', startedAtUtc: '2026-10-14T09:00:00Z', freeSongs: null },
    players: ['dotnet', 'cpp', 'kotlin'],
    metadataFields: ['year', 'genre', 'bpm', 'key'],
    subscribers: { enabled: true, limit: 10, used: 2, remaining: 8, live: 1, suspended: 1, removed: 3, free: 0 },
    catalogues: [{ id: 4, name: 'sunfly.mp4', fileCount: 19771, entitled: true, reason: null }],
  },
});
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

test('inspects an account only at the official URL and keeps the credential in a header', async () => {
  let calls = 0;
  const result = await inspectSunflyAccount(secret, { fetch: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.sunflykaraoke.com/api/v2/me');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('X-Sunfly-Access-Key'), secret);
    assert.equal(String(url).includes(secret), false);
    return json(validAccount(true));
  } });
  assert.deepEqual(result, { status: 'active' });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('reports an inactive subscription without granting playback', async () => {
  assert.deepEqual(await inspectSunflyAccount(secret, { fetch: async () => json(validAccount(false)) }), { status: 'inactive' });
});

test('classifies authentication and rate-limit failures without exposing provider responses', async () => {
  for (const [code, expected] of [[401, 'unauthorized'], [429, 'rate-limited'], [403, 'unavailable'], [500, 'unavailable'], [302, 'unavailable']] as const) {
    const result = await inspectSunflyAccount(secret, { fetch: async () => new Response(`private ${secret}`, { status: code }) });
    assert.deepEqual(result, { status: expected });
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('rejects malformed provider responses rather than marking the account active', async () => {
  const invalid = [
    {}, { success: false, result: validAccount(true).result },
    { result: { ...validAccount(true).result, apiVersion: 1 } },
    { result: { ...validAccount(true).result, subscriptionActive: 'true' } },
    { result: { ...validAccount(true).result, players: 'node' } },
    { result: { ...validAccount(true).result, catalogues: [{ id: 4, name: 'mp4', entitled: 'true' }] } },
    { result: { ...validAccount(true).result, catalogues: Array(10_001).fill({ id: 1, name: 'mp4', entitled: true }) } },
  ];
  for (const fixture of invalid) {
    assert.deepEqual(await inspectSunflyAccount(secret, { fetch: async () => json(fixture) }), { status: 'invalid-response' });
  }
  assert.deepEqual(await inspectSunflyAccount(secret, { fetch: async () => new Response('{') }), { status: 'invalid-response' });
  assert.deepEqual(await inspectSunflyAccount(secret, { fetch: async () => new Response('x'.repeat(256 * 1024 + 1)) }), { status: 'invalid-response' });
});

test('rejects invalid header credentials without making a request', async () => {
  let calls = 0;
  for (const key of ['', 'x\ny', 'x y', 'x'.repeat(1025)]) {
    const result = await inspectSunflyAccount(key, { fetch: async () => { calls++; throw new Error('unexpected'); } });
    assert.deepEqual(result, { status: 'invalid-credential' });
  }
  assert.equal(calls, 0);
});

test('bounds unresponsive requests and does not surface network error details', async () => {
  assert.deepEqual(await inspectSunflyAccount(secret, { fetch: async () => { throw new Error(`private ${secret}`); } }), { status: 'unavailable' });
  const result = await inspectSunflyAccount(secret, { fetch: async () => new Promise<Response>(() => {}), timeoutMs: 10 });
  assert.deepEqual(result, { status: 'timed-out' });
});

test('bounds a response that streams without ending', async () => {
  let cancelled = false;
  const neverEnding = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
    cancel() { cancelled = true; },
  });
  const result = await inspectSunflyAccount(secret, { fetch: async () => new Response(neverEnding), timeoutMs: 10 });
  assert.deepEqual(result, { status: 'timed-out' });
  assert.equal(cancelled, true);
});

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { inspectSunflyCatalogPage } from '../../src/main/sunfly-catalog-client';

const secret = 'sfk_fake_for_test';
const timestamp = '2026-10-12T03:00:11.250Z';
const item = { id: 40133254, artist: 'The Everly Brothers', title: "('Til) I Kissed You", type: 'mp4',
  sku: 'SF1107869', deleted: false, updatedAt: timestamp, path: 'private-source-path', eTag: 'fixture-etag' };
const body = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });

test('reads one requested page from the fixed Sunfly endpoint without leaking the key or source paths', async () => {
  let called = 0;
  const result = await inspectSunflyCatalogPage(secret, { since: timestamp, directoryId: 4, limit: 2 }, { fetch: async (url, init) => {
    called++;
    const target = new URL(String(url));
    assert.equal(target.origin, 'https://api.sunflykaraoke.com');
    assert.equal(target.pathname, '/api/v2/catalogue/changes');
    assert.equal(target.searchParams.get('since'), timestamp);
    assert.equal(target.searchParams.get('directoryId'), '4');
    assert.equal(target.searchParams.get('limit'), '2');
    assert.equal(target.href.includes(secret), false);
    assert.equal(new Headers(init?.headers).get('X-Sunfly-Access-Key'), secret);
    assert.equal(init?.redirect, 'error');
    return body({ items: [item], nextCursor: timestamp, hasMore: true });
  } });
  assert.equal(called, 1);
  assert.deepEqual(result, { status: 'ok', items: [{ id: item.id, artist: item.artist, title: item.title, type: item.type,
    sku: item.sku, deleted: false, updatedAt: timestamp }], nextCursor: timestamp, hasMore: true });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('private-source-path'), false);
});

test('preserves withdrawal markers even when a removed record has no descriptive metadata', async () => {
  const result = await inspectSunflyCatalogPage(secret, {}, { fetch: async () => body({ items: [{ id: 2, deleted: true, updatedAt: timestamp }], nextCursor: timestamp, hasMore: false }) });
  assert.deepEqual(result, { status: 'ok', items: [{ id: 2, artist: null, title: null, type: null, sku: null, deleted: true, updatedAt: timestamp }], nextCursor: timestamp, hasMore: false });
});

test('fails closed for malformed or oversized pages', async () => {
  for (const result of [null, { items: [item], nextCursor: 'invalid', hasMore: false },
    { items: [{ ...item, deleted: 'false' }], nextCursor: timestamp, hasMore: false },
    { items: [{ ...item, title: null }], nextCursor: timestamp, hasMore: false },
    { items: [item, item], nextCursor: timestamp, hasMore: false }]) {
    assert.deepEqual(await inspectSunflyCatalogPage(secret, { limit: 1 }, { fetch: async () => body(result) }), { status: 'invalid-response' });
  }
  assert.deepEqual(await inspectSunflyCatalogPage(secret, {}, { fetch: async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)) }), { status: 'invalid-response' });
});

test('reports auth, rate and timeout failures without response bodies or network retries', async () => {
  for (const [code, expected] of [[401, 'unauthorized'], [429, 'rate-limited'], [500, 'unavailable']] as const) {
    let calls = 0;
    const result = await inspectSunflyCatalogPage(secret, {}, { fetch: async () => { calls++; return new Response(secret, { status: code }); } });
    assert.deepEqual(result, { status: expected }); assert.equal(calls, 1);
  }
  const result = await inspectSunflyCatalogPage(secret, {}, { fetch: async () => new Promise<Response>(() => {}), timeoutMs: 5 });
  assert.deepEqual(result, { status: 'timed-out' });
});

test('does not surface a credential embedded in a valid-looking provider response', async () => {
  const result = await inspectSunflyCatalogPage(secret, {}, { fetch: async () =>
    body({ items: [{ ...item, artist: `Artist ${secret}` }], nextCursor: timestamp, hasMore: false }) });
  assert.deepEqual(result, { status: 'invalid-response' });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('rejects invalid query or credential without a network request', async () => {
  let calls = 0;
  const options = { fetch: async () => { calls++; throw new Error('unexpected'); } };
  for (const query of [{ since: '2026-02-30T00:00:00Z' }, { since: secret }, { directoryId: 0 }, { limit: 501 }, { limit: 0 }])
    assert.deepEqual(await inspectSunflyCatalogPage(secret, query, options), { status: 'invalid-input' });
  assert.deepEqual(await inspectSunflyCatalogPage('bad\nkey', {}, options), { status: 'invalid-input' });
  assert.equal(calls, 0);
});

test('operator help and invalid invocations do not echo arguments or make requests', () => {
  const command = ['--import', 'tsx', 'scripts/sunfly-catalog.ts'];
  const help = spawnSync(process.execPath, [...command, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /TPV_SUNFLY_ACCESS_KEY_FILE/);
  const bad = spawnSync(process.execPath, [...command, secret], { encoding: 'utf8' });
  assert.equal(bad.status, 7); assert.deepEqual(JSON.parse(bad.stdout), { status: 'configuration-error' });
  assert.equal((bad.stdout + bad.stderr).includes(secret), false);
});

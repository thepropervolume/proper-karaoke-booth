import { strict as assert } from 'node:assert';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createCatalogHttpHandler, type CatalogReader } from '../../src/catalog/karaokenerds-http';

const token = 'test-only-abcdefghijklmnopqrstuvwxyz-0123456789';
const item = { artist: 'Example Artist', title: 'Example Song', brandSlug: 'ExampleBrand', youtubeId: 'abcDEF_123-', uploadDate: '2025-03-04' };

async function withServer(reader: CatalogReader, run: (origin: string) => Promise<void>) {
  const server = createServer(createCatalogHttpHandler({ token, reader }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener.');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('requires a configured token and rejects unauthorized or duplicate credentials without touching the store', async () => {
  let calls = 0;
  const reader: CatalogReader = { async search() { calls++; return { items: [], nextCursor: null }; } };
  assert.throws(() => createCatalogHttpHandler({ token: 'weak', reader }), /configuration/);
  await withServer(reader, async origin => {
    for (const authorization of [undefined, `Bearer ${'x'.repeat(40)}`, `Basic ${token}`]) {
      const response = await fetch(`${origin}/v1/catalog/tracks`, { headers: authorization ? { authorization } : {} });
      assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.text()).includes(token), false);
    }
    const duplicateStatus = await new Promise<number>((resolve, reject) => {
      const req = request(`${origin}/v1/catalog/tracks`, { headers: ['Authorization', `Bearer ${token}`, 'Authorization', `Bearer ${token}`] }, res => {
        res.resume(); resolve(res.statusCode ?? 0);
      });
      req.on('error', reject); req.end();
    });
    // Node may reject duplicate Authorization headers at its HTTP parser.
    assert.ok([400, 401].includes(duplicateStatus)); assert.equal(calls, 0);
  });
});

test('passes bounded search values to the reader and projects only public fields', async () => {
  const calls: unknown[] = [];
  const reader: CatalogReader = { async search(query) { calls.push(query); return { items: [{ ...item, secret: 'never-return', filePath: '/private' }], nextCursor: 'next_123' }; } };
  await withServer(reader, async origin => {
    const response = await fetch(`${origin}/v1/catalog/tracks?q=popular&artist=Nada%20Surf&brand=ExampleBrand&cursor=first_123&limit=5`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [item], nextCursor: 'next_123' });
    assert.deepEqual(calls, [{ query: 'popular', artist: 'Nada Surf', brandSlug: 'ExampleBrand', cursor: 'first_123', limit: 5 }]);
  });
});

test('projects optional freshness and unmapped brand codes without leaking internal fields', async () => {
  const metadata = { revision: '12', lastAttempt: 2000, lastSuccess: 1000 };
  await withServer({ async search() {
    return { items: [{ ...item, brandSlug: '', brandCode: 'UPSTREAM', secret: 'never-return' }], nextCursor: null,
      metadata: { ...metadata, privateEndpoint: 'never-return' } };
  } }, async origin => {
    const response = await fetch(`${origin}/v1/catalog/tracks`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ ...item, brandSlug: '', brandCode: 'UPSTREAM' }], nextCursor: null, metadata });
  });
});

test('status requires the same authentication and returns only validated public counts and freshness', async () => {
  let calls = 0;
  const status = { revision: '12', lastAttempt: 2000, lastSuccess: 1000, recordCount: 10, searchableCount: 8 };
  await withServer({ async search() { throw new Error('Search should not be called.'); }, async status() { calls++; return { ...status, privatePath: 'never-return' }; } }, async origin => {
    assert.equal((await fetch(`${origin}/v1/catalog/status`)).status, 401); assert.equal(calls, 0);
    const response = await fetch(`${origin}/v1/catalog/status`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), status); assert.equal(calls, 1);
    for (const suffix of ['?token=anything', '?limit=1', '/']) {
      assert.equal((await fetch(`${origin}/v1/catalog/status${suffix}`, { headers: { authorization: `Bearer ${token}` } })).status, 400);
    }
    assert.equal(calls, 1);
  });
});

test('rejects malformed status and freshness instead of serving misleading counts or times', async () => {
  const status = { revision: '12', lastAttempt: 2000, lastSuccess: 1000, recordCount: 10, searchableCount: 8 };
  for (const bad of [{ ...status, searchableCount: 11 }, { ...status, lastSuccess: -1 }, { ...status, revision: '01' }]) {
    await withServer({ async search() { return { items: [], nextCursor: null }; }, async status() { return bad; } }, async origin => {
      const response = await fetch(`${origin}/v1/catalog/status`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'Catalog unavailable' });
    });
  }
  await withServer({ async search() { return { items: [], nextCursor: null, metadata: { revision: '1', lastSuccess: Number.NaN, lastAttempt: 1 } }; } }, async origin => {
    assert.equal((await fetch(`${origin}/v1/catalog/tracks`, { headers: { authorization: `Bearer ${token}` } })).status, 503);
  });
});

test('rejects invalid routes, duplicate or unknown parameters, bad cursors and unsafe limits', async () => {
  let calls = 0;
  await withServer({ async search() { calls++; return { items: [], nextCursor: null }; } }, async origin => {
    for (const suffix of ['/v1/catalog/tracks?limit=0', '/v1/catalog/tracks?limit=101', '/v1/catalog/tracks?limit=1&limit=2',
      '/v1/catalog/tracks?cursor=bad%2Fcursor', '/v1/catalog/tracks?token=secret', '/v1/catalog/tracks?brand=..', '/v1/other']) {
      const response = await fetch(origin + suffix, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 400);
    }
    const response = await fetch(`${origin}/v1/catalog/tracks`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 405); assert.equal(calls, 0);
  });
});

test('returns a generic error for backend failures or malformed results without exposing internal data', async () => {
  const failures: CatalogReader[] = [
    { async search() { throw new Error(`private: ${token}`); } },
    { async search() { return { items: [{ ...item, youtubeId: 'not-an-id' }], nextCursor: null }; } },
    { async search() { return { items: [{ ...item, artist: 'A'.repeat(501) }], nextCursor: null }; } },
    { async search() { return { items: [{ ...item, title: 'T'.repeat(501) }], nextCursor: null }; } },
    { async search() { return { items: Array(26).fill(item), nextCursor: null }; } },
  ];
  for (const reader of failures) await withServer(reader, async origin => {
    const response = await fetch(`${origin}/v1/catalog/tracks`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'Catalog unavailable' });
  });
});

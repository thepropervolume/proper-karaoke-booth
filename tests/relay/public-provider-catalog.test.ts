import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { ProviderCatalogSearchResult, ProviderCatalogSong } from '../../src/domain/provider-catalog';
import { createPublicProviderCatalogServer } from '../../src/relay/public-provider-catalog';

async function fixture(task: (origin: string, calls: string[]) => Promise<void>) {
  const calls: string[] = [];
  const search = (provider: 'karafun' | 'partytyme') => async (query: string): Promise<ProviderCatalogSearchResult> => {
    calls.push(`${provider}:${query}`);
    const sample: ProviderCatalogSong = { id: provider === 'karafun' ? '12877' : 'PH12877', provider, title: 'Popular', artist: 'Nada Surf',
      webUrl: 'https://provider.test/private', language: 'English', durationSeconds: 200, playbackAvailable: false };
    const songs = query === 'All matches' ? Array.from({ length: 55 }, (_, index) => ({ ...sample, id: String(20000 + index) })) : [sample];
    return { provider, label: 'Provider', message: '/private/provider-error', status: query === 'Provider outage' ? 'timed-out' : 'ok', songs };
  };
  const server = createPublicProviderCatalogServer({ karafun: { search: search('karafun') }, partytyme: { search: search('partytyme') } });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await task(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('public search worker exposes only bounded metadata and preserves the distinct Party Tyme Pro ID', () => fixture(async (origin, calls) => {
  for (const [source, id] of [['karafun', '12877'], ['partytyme', 'PH12877']]) {
    const response = await fetch(`${origin}/search?source=${source}&q=${encodeURIComponent(' Nada Surf ')}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { items: [{ id, title: 'Popular', artist: 'Nada Surf' }] });
  }
  const response = await fetch(`${origin}/search?source=karafun&q=All+matches`);
  assert.equal((await response.json()).items.length, 50);
  assert.deepEqual(calls, ['karafun:Nada Surf', 'partytyme:Nada Surf', 'karafun:All matches']);
}));

test('private worker refuses browser origins, credentials, extra parameters and arbitrary routes', () => fixture(async (origin, calls) => {
  const route = `${origin}/search?source=partytyme&q=Coldplay`;
  for (const url of [route + '&q=Oasis', route + '&url=https%3A%2F%2Fprivate.test', `${origin}/search?source=stingray&q=Coldplay`,
    `${origin}/index.json`, `${origin}/search?source=karafun&q=%E0`, `${origin}/search?source=partytyme&q=${'x'.repeat(161)}`]) {
    assert.equal((await fetch(url)).status, 400, url);
  }
  for (const headers of [{ origin: 'https://outside.test' }, { authorization: 'Bearer private-token' }, { cookie: 'account=private' }]) {
    assert.equal((await fetch(route, { headers: new Headers(Object.entries(headers)) })).status, 400);
  }
  assert.equal((await fetch(route, { method: 'POST' })).status, 405);
  assert.deepEqual(calls, []);
}));

test('public upstream failure remains a recoverable service error without provider details', () => fixture(async origin => {
  const response = await fetch(`${origin}/search?source=karafun&q=Provider+outage`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'CATALOG_UNAVAILABLE' });
}));

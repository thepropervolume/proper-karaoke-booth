import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { RelayStore } from '../../src/relay/store';
import { RelayBroker } from '../../src/relay/broker';
import { RelayRateLimits, startQueueRelayService } from '../../src/relay/http';

const origin = 'https://queue.example.test';
const token = 'a'.repeat(43), second = 'b'.repeat(43);
const ownerId = randomUUID(), otherId = randomUUID();
const owners = [{ id: ownerId, tokenSha256: createHash('sha256').update(token).digest('hex') },
  { id: otherId, tokenSha256: createHash('sha256').update(second).digest('hex') }];

test('mobile endpoints remain disabled unless explicitly enabled', async () => fixture(async call => {
  assert.equal((await call('/v1/mobile/hosts', {}, { origin })).status, 404);
  assert.equal((await call('/v1/mobile/nearby')).status, 404);
}));
test('mobile hosts require exact origins, get isolated temporary capabilities and share the singer protocol', async () => fixture(async call => {
  assert.equal((await call('/v1/mobile/hosts', {})).status, 403);
  assert.equal((await call('/v1/mobile/hosts', {}, { origin: 'https://attacker.test' })).status, 403);
  const access = await (await call('/v1/mobile/hosts', {}, { origin })).json();
  assert.match(access.token, /^[A-Za-z0-9_-]{43}$/);
  const opened = await (await call('/v1/relay/host/open', { slug: 'phone-karaoke', openId: randomUUID() }, { token: access.token, headers: { 'x-tpv-room-discovery': 'yes' } })).json();
  assert.equal(opened.publicUrl, origin + '/phone-karaoke');
  const identity = { roomId: opened.roomId, generation: opened.generation };
  assert.equal((await call('/v1/relay/host/poll', identity, { token })).status, 403);
  await call('/v1/relay/host/poll', identity, { token: access.token, headers: { 'x-tpv-room-discovery': 'yes' } });
  const nearby = await (await call('/v1/mobile/nearby')).json();
  assert.equal(nearby.rooms.length, 1); assert.equal(nearby.rooms[0].slug, 'phone-karaoke');
  assert.ok(!JSON.stringify(nearby).includes(access.token)); assert.ok(!JSON.stringify(nearby).includes('127.0.0.1'));
  await call('/v1/relay/host/close', identity, { token: access.token });
  assert.equal((await (await call('/v1/mobile/nearby')).json()).rooms.length, 0);
}, false, true));
test('mobile catalog is bounded read-only search and never an arbitrary URL proxy', async () => fixture(async call => {
  assert.equal((await call('/v1/mobile/catalog', { query: 'Oasis' })).status, 403);
  assert.equal((await call('/v1/mobile/catalog', { query: 'Oasis', url: 'http://private.test' }, { origin })).status, 400);
  assert.equal((await call('/v1/mobile/catalog', { query: 'O' }, { origin })).status, 400);
  const response = await call('/v1/mobile/catalog', { query: 'Oasis' }, { origin });
  assert.equal(response.status, 200); assert.equal((await response.json()).items[0].title, 'Oasis');
  assert.equal(response.headers.get('cache-control'), 'no-store');
}, false, true));

async function fixture(run: (call: (path: string, value?: unknown, options?: { token?: string; origin?: string; host?: string; headers?: Record<string,string>; method?: string }) => Promise<Response>) => Promise<void>, trustProxy = false, mobileEnabled = false) {
  const db = new DatabaseSync(':memory:');
  const broker = new RelayBroker(new RelayStore(db, { publicOrigin: origin }), { pollTimeoutMs: 500, rpcTimeoutMs: 1000, offlineAfterMs: 2000 });
  const service = await startQueueRelayService({ publicOrigin: origin, owners, broker, trustProxy, port: 0, mobileEnabled, mobileCatalog: async query => ({ items: [{ id: 'youtube_Video123456', title: query, artist: 'Artist', provider: 'karaokenerds', videoId: 'Video123456' }] }),
    staticHandler: async (request, response) => {
      if (request.url !== '/singer/' && request.url !== '/assets/singer-test.js') return false;
      response.writeHead(200, { 'Content-Type': request.url.endsWith('.js') ? 'text/javascript' : 'text/html' });
      response.end(request.url === '/singer/' ? '<h1>Karaoke</h1>' : '// singer'); return true;
    }, closeDependencies: () => db.close() });
  try {
    await run(async (path, value, options = {}) => {
      const headers: Record<string,string> = { Host: options.host ?? 'queue.example.test', ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}), ...(options.origin ? { Origin: options.origin } : {}), ...options.headers };
      return new Promise<Response>((resolve, reject) => {
        const request = httpRequest({ hostname: '127.0.0.1', port: service.port, path,
          method: options.method ?? (value === undefined ? 'GET' : 'POST'), headers }, response => {
          const chunks: Buffer[] = [];
          response.on('data', chunk => chunks.push(chunk)); response.once('error', reject);
          response.once('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode,
            headers: Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string,string] => typeof entry[1] === 'string')) })));
        });
        request.once('error', reject); request.end(value === undefined ? undefined : JSON.stringify(value));
      });
    });
  } finally { await service.stop(); }
}

test('authenticated host long-poll routes only bounded guest operations and strips private result fields', async () => fixture(async call => {
  const opened = await call('/v1/relay/host/open', { slug: 'proper-volume', openId: randomUUID() }, { token });
  assert.equal(opened.status, 200); const room = await opened.json();
  assert.equal(room.publicUrl, origin + '/proper-volume');
  const identity = { roomId: room.roomId, generation: room.generation };
  const poll = call('/v1/relay/host/poll', identity, { token });
  for (let attempt = 0; attempt < 20; attempt++) {
    const lookup = await (await call('/v1/relay/lookup/proper-volume')).json();
    if (lookup.online) break;
    if (attempt === 19) assert.fail('host poll did not become online');
  }
  const guestPath = `/v1/relay/rooms/${room.roomId}/${room.generation}/guest/admission`;
  const guest = call(guestPath, {}, { origin });
  const batchResponse = await poll; assert.equal(batchResponse.status, 200);
  const batch = await batchResponse.json(); assert.equal(batch.roomId, room.roomId); assert.equal(batch.requests.length, 1);
  assert.equal(batch.requests[0].operation, 'admission'); assert.deepEqual(batch.requests[0].payload, {});
  assert.equal(JSON.stringify(batch).includes(token), false);
  const reply = { ...identity, responses: [{ requestId: batch.requests[0].requestId, status: 200,
    body: { showId: randomUUID(), hostEpoch: randomUUID(), revision: 1, filePath: '/private/media', notes: 'private', providerKey: 'secret' } }] };
  assert.deepEqual(await (await call('/v1/relay/host/reply', reply, { token })).json(), { ok: true });
  const result = await guest; assert.equal(result.status, 200);
  const body = await result.json(); assert.deepEqual(Object.keys(body).sort(), ['hostEpoch','revision','showId']);
  assert.deepEqual(await (await call('/v1/relay/host/reply', reply, { token })).json(), { ok: true });
  assert.equal((await call('/v1/relay/host/close', identity, { token })).status, 200);
  assert.equal((await call(guestPath, {}, { origin })).status, 410);
}));

test('host credentials, origins, identities and operation allowlists are enforced before dispatch', async () => fixture(async call => {
  const open = { slug: 'karaoke-night', openId: randomUUID() };
  assert.equal((await call('/v1/relay/host/open', open)).status, 401);
  assert.equal((await call('/v1/relay/host/open', open, { token: 'wrong' })).status, 401);
  assert.equal((await call('/v1/relay/host/open', open, { token, origin: 'https://attacker.test' })).status, 403);
  assert.equal((await call('/v1/relay/host/open', open, { token, host: 'attacker.test' })).status, 400);
  const room = await (await call('/v1/relay/host/open', open, { token })).json();
  const identity = { roomId: room.roomId, generation: room.generation };
  assert.equal((await call('/v1/relay/host/poll', identity, { token: second })).status, 403);
  assert.equal((await call('/v1/relay/host/open', { ...open, openId: randomUUID() }, { token: second })).status, 409);
  const base = `/v1/relay/rooms/${room.roomId}/${room.generation}/guest/`;
  assert.equal((await call(base + 'admission', {})).status, 403);
  assert.equal((await call(base + 'admission', {}, { origin: 'https://attacker.test' })).status, 403);
  assert.equal((await call(base + 'admin', {}, { origin })).status, 400);
  assert.equal((await call(base + 'snapshot', {}, { origin })).status, 400);
  assert.equal((await call(base + 'request', { command: { type: 'play', filePath: '/secret' } }, { origin, token: second })).status, 400);
  assert.equal((await call('/v1/relay/host/open', { ...open, extra: '/private' }, { token })).status, 400);
  assert.equal((await call('/v1/relay/host/open', { slug: 'admin', openId: randomUUID() }, { token })).status, 400);
}));

test('only the singer asset allowlist and clean custom slug paths are served', async () => fixture(async call => {
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/healthz')).status, 200);
  assert.match(await (await call('/my-karaoke')).text(), /Karaoke/);
  assert.match(await (await call('/my-karaoke/')).text(), /Karaoke/);
  assert.equal((await call('/assets/singer-test.js')).status, 200);
  assert.equal((await call('/assets/unknown.js')).status, 404);
  for (const path of ['/admin','/api/v1/snapshot','/my-karaoke/extra','/assets/main.js?secret=x','/my-karaoke?token=x']) assert.ok((await call(path)).status >= 400, path);
  assert.equal((await call('/v1/relay/host/open', 'x'.repeat(8193), { token })).status, 413);
  assert.equal((await call('/healthz', undefined, { method: 'OPTIONS' })).status, 405);
}));

test('trusted client IP is required and cannot be a forwarded chain', async () => fixture(async call => {
  assert.equal((await call('/healthz')).status, 400);
  assert.equal((await call('/healthz', undefined, { headers: { 'X-TPV-Client-IP': '198.51.100.8, 127.0.0.1' } })).status, 400);
  assert.equal((await call('/healthz', undefined, { headers: { 'X-TPV-Client-IP': '198.51.100.8' } })).status, 200);
}, true));

test('rate limits reject excess traffic and reset only after their monotonic window', () => {
  let now = 10; const limiter = new RelayRateLimits(() => now);
  assert.equal(limiter.take('client', 2, 100), true); assert.equal(limiter.take('client', 2, 100), true); assert.equal(limiter.take('client', 2, 100), false);
  now = 109; assert.equal(limiter.take('client', 2, 100), false);
  now = 110; assert.equal(limiter.take('client', 2, 100), true);
  now = -1; assert.equal(limiter.take('client', 2, 100), false);
});

test('failed revocation still closes the listener and dependencies exactly once', async () => {
  let closed = 0;
  const broker = { stop() { throw new Error('private-database-failure'); } } as unknown as RelayBroker;
  const service = await startQueueRelayService({ publicOrigin: origin, owners, broker, port: 0,
    staticHandler: async () => false, closeDependencies: () => { closed++; } });
  await assert.rejects(service.stop(), /Relay shutdown failed/);
  await assert.rejects(service.stop(), /Relay shutdown failed/);
  assert.equal(closed, 1);
  await assert.rejects(fetch(`http://127.0.0.1:${service.port}`));
});

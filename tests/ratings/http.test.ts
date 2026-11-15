import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { test } from 'node:test';
import { startRatingsService } from '../../src/ratings/service';
import type { RatingsStore } from '../../src/ratings/http';
import { RatingsError } from '../../src/ratings/schema';

const token = 'synthetic-ratings-token-012345678901234567890123456789';
const other = 'synthetic-other-voter-token-01234567890123456789012345';
const readonly = 'synthetic-reader-token-012345678901234567890123456789';
const a = 'youtube:AbCdEf012_-', b = 'sha256:' + 'f'.repeat(64);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture(): RatingsStore & { votes: Map<string, Map<string, number>>; disabled: Set<string> } {
  const votes = new Map<string, Map<string, number>>(), disabled = new Set<string>();
  function lookup(key: string, voter: string | null) {
    const current = votes.get(key) ?? new Map<string, number>(), values = [...current.values()];
    return { recordingKey: key, average: values.length ? values.reduce((x, y) => x + y, 0) / values.length : null,
      count: values.length, ownVote: voter ? current.get(voter) ?? null : null, secret: 'must-never-project' };
  }
  return { votes, disabled,
    async authenticate(value) { const id = value === hash(token) ? 'voter-a' : value === hash(other) ? 'voter-b' : null; return id && !disabled.has(id) ? id : null; },
    async lookup(keys, voter) { return keys.map(key => lookup(key, voter)); },
    async vote(key, value, voter) {
      if (disabled.has(voter)) throw new RatingsError(401, 'unauthorized');
      const current = votes.get(key) ?? new Map<string, number>(); votes.set(key, current);
      if (value === null) current.delete(voter); else current.set(voter, value);
      return lookup(key, voter);
    } };
}
async function setup(options: { store?: RatingsStore; now?: () => number } = {}) {
  const store = options.store ?? fixture(); let closed = 0;
  const service = await startRatingsService({ port: 0, store, now: options.now, closeDependencies: async () => { closed++; } });
  const call = (path: string, body: unknown, auth?: string, method?: string) => fetch(`http://127.0.0.1:${service.port}${path}`, {
    method: method ?? (path.endsWith('/vote') ? 'PUT' : 'POST'), headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
  return { store, service, call, closed: () => closed };
}

test('anonymous aggregates, per-voter replacement, exact identities and clear survive the wire contract', async () => {
  const { service, call } = await setup();
  try {
    let response = await call('/v1/ratings/lookup', { recordingKeys: [a, b] });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { items: [a, b].map(recordingKey => ({ recordingKey, average: null, count: 0, ownVote: null })) });
    assert.deepEqual(await (await call('/v1/ratings/vote', { recordingKey: a, value: 8 }, token)).json(), { recordingKey: a, average: 8, count: 1, ownVote: 8 });
    await call('/v1/ratings/vote', { recordingKey: a, value: 10 }, other);
    await call('/v1/ratings/vote', { recordingKey: a, value: 6 }, token);
    response = await call('/v1/ratings/lookup', { recordingKeys: [a, b] }, other);
    assert.deepEqual((await response.json() as any).items[0], { recordingKey: a, average: 8, count: 2, ownVote: 10 });
    response = await call('/v1/ratings/lookup', { recordingKeys: [a] });
    assert.equal((await response.json() as any).items[0].ownVote, null);
    assert.deepEqual(await (await call('/v1/ratings/vote', { recordingKey: a, value: null }, token)).json(), { recordingKey: a, average: 10, count: 1, ownVote: null });
    await call('/v1/ratings/vote', { recordingKey: a, value: null }, token);
    assert.deepEqual(await (await call('/v1/ratings/vote', { recordingKey: a, value: null }, other)).json(), { recordingKey: a, average: null, count: 0, ownVote: null });
  } finally { await service.stop(); }
});

test('unknown or reader bearer always rejects and cannot fall back to anonymous or overwrite another voter', async () => {
  const store = fixture(), { service, call } = await setup({ store });
  try {
    for (const auth of [readonly, 'short']) {
      assert.equal((await call('/v1/ratings/lookup', { recordingKeys: [a] }, auth)).status, 401);
      assert.equal((await call('/v1/ratings/vote', { recordingKey: a, value: 8 }, auth)).status, 401);
    }
    assert.equal((await call('/v1/ratings/vote', { recordingKey: a, value: 8 })).status, 401);
    assert.equal((await call('/v1/ratings/vote', { recordingKey: a, value: 8, voterId: 'voter-b' }, token)).status, 400);
    store.disabled.add('voter-a');
    assert.equal((await call('/v1/ratings/lookup', { recordingKeys: [a] }, token)).status, 401);
    assert.equal(store.votes.size, 0);
  } finally { await service.stop(); }
});

test('KaraFun catalog and community ratings stay distinct through authenticated writes and anonymous aggregates',async()=>{
  const {service,call}=await setup();const catalog='karafun:catalog:6229',community='karafun:community:6229';
  try{
    assert.equal((await call('/v1/ratings/vote',{recordingKey:catalog,value:9},token)).status,200);
    assert.equal((await call('/v1/ratings/vote',{recordingKey:community,value:4},token)).status,200);
    const response=await call('/v1/ratings/lookup',{recordingKeys:[catalog,community]});assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{items:[{recordingKey:catalog,average:9,count:1,ownVote:null},{recordingKey:community,average:4,count:1,ownVote:null}]});
    for(const recordingKey of ['karafun:catalog:06229','karafun:catalog:0','karafun:other:6229','karafun:catalog:6229?key=secret'])
      assert.equal((await call('/v1/ratings/vote',{recordingKey,value:8},token)).status,400);
  }finally{await service.stop();}
});

test('strict keys, integers, body shapes, paths and methods are bounded before store writes', async () => {
  const store = fixture(), { service, call } = await setup({ store });
  try {
    for (const value of [0, 11, 1.5, '8', true, {}, undefined])
      assert.equal((await call('/v1/ratings/vote', { recordingKey: a, value }, token)).status, 400);
    for (const recordingKey of ['artist:title', 'youtube:short', 'sha256:' + 'F'.repeat(64), '/private/show.mp4', a + '\n'])
      assert.equal((await call('/v1/ratings/vote', { recordingKey, value: 8 }, token)).status, 400);
    for (const input of [{ recordingKeys: [a, a] }, { recordingKeys: Array(101).fill(a) }, { recordingKeys: [a], voterId: 'voter-a' }])
      assert.equal((await call('/v1/ratings/lookup', input)).status, 400);
    assert.equal((await call('/v1/ratings/lookup?ignored=1', { recordingKeys: [a] })).status, 404);
    assert.equal((await call('/v1/ratings/lookup', {}, undefined, 'PUT')).status, 405);
    assert.equal((await call('/v1/ratings/vote', {}, token, 'POST')).status, 405);
    const malformed = await fetch(`http://127.0.0.1:${service.port}/v1/ratings/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    const huge = await fetch(`http://127.0.0.1:${service.port}/v1/ratings/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(12_289) });
    assert.equal(huge.status, 400); assert.equal(store.votes.size, 0);
  } finally { await service.stop(); }
});

test('empty connection checks still authenticate every supplied credential', async () => {
  const { service, call } = await setup();
  try {
    for (const auth of [undefined, token]) {
      const response = await call('/v1/ratings/lookup', { recordingKeys: [] }, auth);
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { items: [] });
    }
    assert.equal((await call('/v1/ratings/lookup', { recordingKeys: [] }, readonly)).status, 401);
  } finally { await service.stop(); }
});

test('duplicate authorization headers reject even if first token is valid', async () => {
  const { service } = await setup();
  try {
    const status = await new Promise<number>(resolve => {
      const req = request({ hostname: '127.0.0.1', port: service.port, path: '/v1/ratings/lookup', method: 'POST',
        headers: ['Host', 'localhost', 'Authorization', `Bearer ${token}`, 'Authorization', `Bearer ${other}`, 'Content-Type', 'application/json'] }, res => { res.resume(); resolve(res.statusCode!); });
      req.end(JSON.stringify({ recordingKeys: [a] }));
    });
    assert.equal(status, 401);
  } finally { await service.stop(); }
});

test('database failures and invalid projections fail closed without private detail', async () => {
  const store = fixture(); store.lookup = async () => { throw new Error('mysql secret private server path'); };
  const { service, call } = await setup({ store });
  try {
    let response = await call('/v1/ratings/lookup', { recordingKeys: [a] });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'ratings-unavailable' });
    store.lookup = async () => [{ recordingKey: a, average: 8, count: 1, ownVote: 8 }];
    response = await call('/v1/ratings/lookup', { recordingKeys: [a] }); assert.equal(response.status, 503);
    store.lookup = async () => [{ recordingKey: a, average: NaN, count: 1, ownVote: null }];
    response = await call('/v1/ratings/lookup', { recordingKeys: [a] }); assert.equal(response.status, 503);
  } finally { await service.stop(); }
});

test('bounded request and voter token buckets refill, and shutdown closes dependencies once', async () => {
  let now = 0;
  const { service, call, closed } = await setup({ now: () => now });
  try {
    for (let i = 0; i < 20; i++) assert.equal((await call('/v1/ratings/vote', { recordingKey: a, value: 8 }, token)).status, 200);
    assert.equal((await call('/v1/ratings/vote', { recordingKey: a, value: 8 }, token)).status, 429);
    now += 3_001;
    assert.equal((await call('/v1/ratings/vote', { recordingKey: a, value: 8 }, token)).status, 200);
    for (let i = 0; i < 80; i++) await call('/v1/ratings/lookup', { recordingKeys: [a] });
    const response = await call('/v1/ratings/lookup', { recordingKeys: [a] });
    assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '5');
    now += 100_000;
    assert.equal((await call('/v1/ratings/lookup', { recordingKeys: [a] })).status, 200);
    await Promise.all([service.stop(), service.stop()]); assert.equal(closed(), 1);
  } finally { await service.stop(); }
});

test('production Host and Origin are checked before accessing the store', async () => {
  let touched = 0;
  const store = fixture(); store.lookup = async () => { touched++; return []; };
  const service = await startRatingsService({ port: 0, allowedHost: 'apps.thepropervolume.com', store, closeDependencies: async () => {} });
  try {
    const base = `http://127.0.0.1:${service.port}/v1/ratings/lookup`;
    const cases: Record<string, string>[] = [{ Host: 'unexpected.invalid' }, { Host: 'apps.thepropervolume.com', Origin: 'https://unexpected.invalid' }];
    for (const headers of cases) {
      const response = await fetch(base, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ recordingKeys: [a] }) });
      assert.equal(response.status, 403);
    }
    assert.equal(touched, 0);
  } finally { await service.stop(); }
});

test('only eight database requests may remain in flight and capacity recovers after completion', async () => {
  let entered = 0, release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }), store = fixture();
  store.lookup = async keys => { entered++; await wait; return keys.map(recordingKey => ({ recordingKey, average: null, count: 0, ownVote: null })); };
  const { service, call } = await setup({ store });
  try {
    const pending = Array.from({ length: 8 }, () => call('/v1/ratings/lookup', { recordingKeys: [a] }));
    const deadline = Date.now() + 3000;
    while (entered < 8 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(entered, 8);
    assert.equal((await call('/v1/ratings/lookup', { recordingKeys: [a] })).status, 503);
    release(); assert.ok((await Promise.all(pending)).every(response => response.status === 200));
    assert.equal((await call('/v1/ratings/lookup', { recordingKeys: [a] })).status, 200);
  } finally { release(); await service.stop(); }
});

test('a slow anonymous body is closed within its own deadline without calling the store', async () => {
  const store = fixture(); let touched = false;
  store.lookup = async () => { touched = true; return []; };
  const { service, call } = await setup({ store });
  try {
    const start = Date.now();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: service.port, path: '/v1/ratings/lookup', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '100' } }, res => { res.resume(); resolve(res.statusCode!); });
      req.on('error', reject); req.write('{');
    });
    assert.equal(status, 400); assert.ok(Date.now() - start < 4500); assert.equal(touched, false);
    const response = await call('/v1/ratings/lookup', { recordingKeys: [a] });
    assert.equal(response.status, 503); // fake store intentionally returns an invalid projection; capacity was released.
    assert.equal(touched, true);
  } finally { await service.stop(); }
});

test('disconnects during asynchronous authentication release every request slot', async () => {
  const store = fixture(), authenticate = store.authenticate;
  let entered = 0;
  store.authenticate = async hash => { entered++; await new Promise(resolve => setTimeout(resolve, 80)); return authenticate(hash); };
  const { service, call } = await setup({ store });
  try {
    const clients = Array.from({ length: 8 }, () => {
      const req = request({ hostname: '127.0.0.1', port: service.port, path: '/v1/ratings/lookup', method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': '100' } });
      req.on('error', () => {}); req.write('{'); return req;
    });
    const deadline = Date.now() + 3000;
    while (entered < 8 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(entered, 8); clients.forEach(req => req.destroy());
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal((await call('/v1/ratings/lookup', { recordingKeys: [a] })).status, 200);
  } finally { await service.stop(); }
});

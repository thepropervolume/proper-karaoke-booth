import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { mobileServiceWorker } from '../../scripts/mobile-service-worker.mjs';

const scope = 'https://queue.example.test/app/';
const cacheName = 'tpv-mobile-next';
const assets = ['./', 'index.html', 'assets/app-new.js'];
const requestFor = (path, options = {}) => ({ url: new URL(path, scope).href, method: 'GET', ...options });

function rehearsal({ network = async () => new Response('network copy'), precacheError } = {}) {
  const cacheStores = new Map([
    ['tpv-mobile-old', new Map([[scope, new Response('old shell')]])],
    ['unrelated-cache', new Map()],
  ]);
  const events = new Map();
  const calls = [];
  const cacheKey = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const caches = {
    async open(name) {
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const entries = cacheStores.get(name);
      return {
        async addAll(files) {
          calls.push('precache');
          if (precacheError) throw precacheError;
          for (const file of files) entries.set(cacheKey(file), new Response('precache ' + file));
          calls.push('precache-complete');
        },
        async match(request) {
          return entries.get(cacheKey(request))?.clone();
        },
      };
    },
    async keys() { return Array.from(cacheStores.keys()); },
    async delete(name) { calls.push('delete ' + name); return cacheStores.delete(name); },
  };
  const self = {
    location: new URL('service-worker.js', scope),
    registration: { scope },
    addEventListener(type, handler) { events.set(type, handler); },
    async skipWaiting() { calls.push('skip-waiting'); },
    clients: { async claim() { calls.push('claim'); } },
  };
  const fetch = (...args) => {
    calls.push('network');
    return network(...args);
  };
  runInNewContext(mobileServiceWorker(cacheName, assets), { self, caches, fetch, URL, Request, Response });
  function lifecycle(type) {
    let done;
    events.get(type)({ waitUntil(promise) { done = promise; } });
    assert.ok(done, type + ' extends its lifetime');
    return done;
  }
  function fetchEvent(request) {
    let response;
    events.get('fetch')({
      request,
      respondWith(promise) { response = promise; },
    });
    return response;
  }
  return { lifecycle, fetchEvent, cacheStores, calls };
}

test('an installed worker immediately replaces the older shell and still preserves unrelated caches', async () => {
  let navigationOptions;
  const fixture = rehearsal({ network: async (_request, options) => {
    navigationOptions = options;
    return new Response('network copy');
  } });
  await fixture.lifecycle('install');
  assert.deepEqual(fixture.calls, ['precache', 'precache-complete', 'skip-waiting']);
  await fixture.lifecycle('activate');
  assert.deepEqual(fixture.calls.slice(3), ['claim', 'delete tpv-mobile-old']);
  assert.ok(fixture.cacheStores.has('unrelated-cache'));
  assert.ok(fixture.cacheStores.has(cacheName));
  assert.ok(!fixture.cacheStores.has('tpv-mobile-old'));

  const response = await fixture.fetchEvent(requestFor('./', { mode: 'navigate' }));
  assert.equal(await response.text(), 'network copy');
  assert.equal(fixture.calls.at(-1), 'network');
  assert.equal(navigationOptions?.cache, 'no-store');
});

test('a failed precache leaves the current worker in place', async () => {
  const fixture = rehearsal({ precacheError: new Error('some asset failed') });
  await assert.rejects(fixture.lifecycle('install'), /some asset failed/);
  assert.ok(!fixture.calls.includes('skip-waiting'));
  assert.ok(fixture.cacheStores.has('tpv-mobile-old'));
});

test('shell navigation falls back to its precached HTML after network errors and server failures', async () => {
  let onlineStatus;
  const fixture = rehearsal({
    network: async () => {
      if (!onlineStatus) throw new Error('Offline');
      return new Response('origin response', { status: onlineStatus });
    },
  });
  await fixture.lifecycle('install');
  await fixture.lifecycle('activate');
  const navigate = async (path = './') => fixture.fetchEvent(requestFor(path, { mode: 'navigate' }));
  assert.equal(await (await navigate()).text(), 'precache ./');
  assert.equal(await (await navigate('index.html')).text(), 'precache index.html');

  onlineStatus = 503;
  assert.equal(await (await navigate()).text(), 'precache ./');

  onlineStatus = 404;
  const missing = await navigate();
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'origin response');

  onlineStatus = 200;
  assert.equal(await (await navigate()).text(), 'origin response');
});

test('only allowlisted assets use the cache and out-of-scope requests flow to the browser unchanged', async () => {
  const fixture = rehearsal();
  await fixture.lifecycle('install');
  const response = await fixture.fetchEvent(requestFor('assets/app-new.js'));
  assert.equal(await response.text(), 'precache assets/app-new.js');
  assert.ok(!fixture.calls.includes('network'));

  for (const request of [
    requestFor('./?account=1', { mode: 'navigate' }),
    requestFor('assets/app-new.js?bypass=1'),
    requestFor('./', { method: 'POST', mode: 'navigate' }),
    requestFor('/v1/mobile/account/session'),
    requestFor('api/account/session'),
    requestFor('/app-other/index.html', { mode: 'navigate' }),
    requestFor('https://other.example.test/app/', { mode: 'navigate' }),
    requestFor('assets/old-app.js'),
  ]) assert.equal(fixture.fetchEvent(request), undefined, request.url);

  assert.ok(!fixture.calls.includes('network'));
});

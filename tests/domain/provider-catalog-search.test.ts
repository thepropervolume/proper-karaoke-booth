import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProviderCatalogSearchResult } from '../../src/domain/provider-catalog';
import { ProviderCatalogSearch, type ProviderCatalogSearchState } from '../../src/renderer/provider-catalog-search';
import { ProviderCatalogResults, ProviderConnectionBadge } from '../../src/renderer/ProviderCatalogPanel';

function clock() {
  let id = 0; const tasks = new Map<number, () => void>();
  return { schedule: (callback: () => void, delay: number) => { assert.equal(delay, 300); tasks.set(++id, callback); return id; },
    cancel: (handle: unknown) => { tasks.delete(handle as number); },
    flush: () => { const pending = [...tasks.values()]; tasks.clear(); pending.forEach(callback => callback()); } };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const page = (title: string): ProviderCatalogSearchResult[] => [{ provider: 'karafun', label: 'KaraFun', status: 'ok', message: '', songs: [{
  provider: 'karafun', id: '123', title, artist: 'Artist', durationSeconds: 180, language: 'en',
  webUrl: 'https://www.karafun.com/karaoke/example/', playbackAvailable: false,
}] }];
const deferred = () => { let resolve!: (value: ProviderCatalogSearchResult[]) => void; return {
  promise: new Promise<ProviderCatalogSearchResult[]>(done => { resolve = done; }), resolve: (value: ProviderCatalogSearchResult[]) => resolve(value),
}; };

test('provider searches debounce independently and refuse disabled or malformed queries', async () => {
  const timer = clock(), calls: string[] = [], states: ProviderCatalogSearchState[] = [];
  const controller = new ProviderCatalogSearch(async query => { calls.push(query); return page(query); }, value => states.push(value), timer);
  controller.update('na'); controller.update('nada'); timer.flush(); await tick();
  assert.deepEqual(calls, ['nada']); assert.equal(states.at(-1)?.phase, 'complete');
  for (const invalid of ['', 'x', 'a'.repeat(201), 'bad\nquery']) { controller.update(invalid); timer.flush(); }
  controller.update('disabled', false); timer.flush(); await tick();
  assert.deepEqual(calls, ['nada']); assert.equal(states.at(-1)?.phase, 'idle'); controller.dispose();
});

test('late provider replies cannot replace a new query or return after clearing or disposal', async () => {
  const timer = clock(), tasks = new Map<string, ReturnType<typeof deferred>>(), states: ProviderCatalogSearchState[] = [];
  const controller = new ProviderCatalogSearch(query => { const task = deferred(); tasks.set(query, task); return task.promise; }, value => states.push(value), timer);
  controller.update('old'); timer.flush(); await tick(); controller.update('new'); timer.flush(); await tick();
  tasks.get('new')!.resolve(page('New')); await tick(); tasks.get('old')!.resolve(page('Old')); await tick();
  assert.equal(states.at(-1)?.query, 'new'); assert.equal(states.at(-1)?.results?.[0].songs[0].title, 'New');
  controller.update('clear'); timer.flush(); await tick(); controller.update(''); tasks.get('clear')!.resolve(page('Hidden')); await tick();
  assert.equal(states.at(-1)?.results, null); assert.equal(states.at(-1)?.phase, 'idle');
  controller.update('dispose'); timer.flush(); await tick(); controller.dispose(); const count = states.length;
  tasks.get('dispose')!.resolve(page('Hidden')); await tick(); assert.equal(states.length, count);
});

test('provider IPC failures are distinct from an empty catalog and do not expose exception details', async () => {
  const timer = clock(), states: ProviderCatalogSearchState[] = [];
  const controller = new ProviderCatalogSearch(async () => { throw new Error('password and private profile path'); }, value => states.push(value), timer);
  controller.update('song'); timer.flush(); await tick();
  assert.equal(states.at(-1)?.failed, true); assert.equal(states.at(-1)?.results, null);
  assert.doesNotMatch(JSON.stringify(states), /password|private profile/); controller.dispose();
});

test('search-only provider songs name the service and never expose queue, play or local selection controls', () => {
  const markup = renderToStaticMarkup(React.createElement(ProviderCatalogResults, {
    state: { query: 'song', phase: 'complete', results: page('Song'), failed: false }, openSong: async () => {},
  }));
  assert.match(markup, /Artist.*KaraFun/); assert.match(markup, /Search only.*Playback pending/);
  assert.match(markup, /View on KaraFun/); assert.match(markup, /role="listitem"/);
  assert.doesNotMatch(markup, /role="option"|aria-selected|Add to Queue|Add to Library|href=/);
});

test('an unavailable provider never renders songs carried by a failed result', () => {
  const results = page('Must not appear'); results[0].status = 'unauthorized'; results[0].message = 'Catalog access was rejected.';
  const markup = renderToStaticMarkup(React.createElement(ProviderCatalogResults, {
    state: { query: 'song', phase: 'complete', results, failed: false }, openSong: async () => {},
  }));
  assert.match(markup, /Catalog access was rejected/); assert.doesNotMatch(markup, /Must not appear|View on KaraFun/);
});

test('connected account badges are visible and accessible only for active connections', () => {
  const connected = renderToStaticMarkup(React.createElement(ProviderConnectionBadge, { provider: 'Party Tyme', connected: true }));
  assert.match(connected, /Party Tyme account connected/);
  assert.match(connected, /✓/);
  assert.equal(renderToStaticMarkup(React.createElement(ProviderConnectionBadge, { provider: 'Party Tyme', connected: false })), '');
});

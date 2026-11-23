import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LocalCatalogResult } from '../../src/main/karaokenerds-local-browser';
import { LibraryCatalogSearch, type LibraryCatalogSearchState } from '../../src/renderer/library-catalog-search';
import { LibraryCatalogStatus } from '../../src/renderer/LibraryCatalogStatus';

function clock() {
  let id = 0;const jobs = new Map<number, () => void>();
  return { schedule: (callback: () => void, delay: number) => { assert.equal(delay, 300);jobs.set(++id, callback);return id; },
    cancel: (handle: unknown) => { jobs.delete(handle as number); },
    flush: () => { const pending = [...jobs.values()];jobs.clear();for (const run of pending) run(); }, size: () => jobs.size };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const page = (title: string): Extract<LocalCatalogResult, { status: 'ready' }> =>
  ({ status: 'ready', tracks: [{ id: 'abcdefghijk', youtubeId: 'abcdefghijk', title, artist: 'Artist', brand: null }], limited: false, lastSuccess: null });
const deferred = () => { let resolve!: (value: LocalCatalogResult) => void;return { promise: new Promise<LocalCatalogResult>(done => { resolve = done; }), resolve: (value: LocalCatalogResult) => resolve(value) }; };

test('typing bursts cancel queued searches and short, long or disabled queries never start remote work', async () => {
  const timer = clock(), calls: string[] = [], states: LibraryCatalogSearchState[] = [];
  const controller = new LibraryCatalogSearch(async query => { calls.push(query);return page(query); }, value => states.push(value), timer);
  controller.update('na');controller.update('nada');assert.equal(timer.size(), 1);timer.flush();await tick();
  assert.deepEqual(calls, ['nada']);assert.equal(states.at(-1)?.phase, 'complete');
  for (const query of ['', 'a', 'x'.repeat(201), 'bad\nquery']) { controller.update(query);timer.flush(); }
  controller.update('cancel before dispatch');timer.flush();controller.update('');await tick();assert.deepEqual(calls, ['nada']);
  controller.update('disabled', false);timer.flush();await tick();assert.deepEqual(calls, ['nada']);assert.equal(states.at(-1)?.phase, 'idle');
  controller.dispose();
});

test('the latest query wins when earlier replies arrive late, and disposal suppresses an in-flight reply', async () => {
  const timer = clock(), pending = new Map<string, ReturnType<typeof deferred>>(), states: LibraryCatalogSearchState[] = [];
  const controller = new LibraryCatalogSearch(query => { const task = deferred();pending.set(query, task);return task.promise; }, value => states.push(value), timer);
  controller.update('old');timer.flush();await tick();controller.update('new');timer.flush();await tick();
  pending.get('new')!.resolve(page('New'));await tick();pending.get('old')!.resolve(page('Old'));await tick();
  assert.equal(states.at(-1)?.query, 'new');assert.equal(states.at(-1)?.result?.tracks[0]?.title, 'New');
  controller.update('later');timer.flush();await tick();controller.dispose();const count = states.length;
  pending.get('later')!.resolve(page('Later'));await tick();assert.equal(states.length, count);
});

test('clearing search cancels old catalog results and failures do not masquerade as successful empty results', async () => {
  const timer = clock(), task = deferred(), states: LibraryCatalogSearchState[] = [];
  const controller = new LibraryCatalogSearch(() => task.promise, value => states.push(value), timer);
  controller.update('song');timer.flush();await tick();controller.update('');task.resolve(page('Stale'));await tick();
  assert.equal(states.at(-1)?.result, null);assert.equal(states.at(-1)?.phase, 'idle');controller.dispose();
  const failing = new LibraryCatalogSearch(async () => { throw new Error('private connection details'); }, value => states.push(value), timer);
  failing.update('song');timer.flush();await tick();assert.equal(states.at(-1)?.result?.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(states), /private connection details/);failing.dispose();
});

test('offline and connection failure messages preserve local-library context and explain stale or unsaved results', () => {
  const render = (result: LocalCatalogResult) => renderToStaticMarkup(React.createElement(LibraryCatalogStatus, { state: { query: 'song', phase: 'complete', result } }));
  assert.match(render({ ...page('Song'), status: 'ready', source: 'offline-cache', fetchedAt: 1000, stale: true, cachePersisted: false }), /Saved Karaoke Nerds results.*outdated.*could not be saved/s);
  assert.match(render({ status: 'forbidden', tracks: [], limited: false, lastSuccess: null }), /Local matches are still available.*Preferences/s);
});

test('load more keeps prior songs, deduplicates exact recording IDs and preserves offline state', async () => {
  const timer = clock(), calls: (string | undefined)[] = [], states: LibraryCatalogSearchState[] = [], next = deferred();
  const first = { ...page('First'), limited: true, nextCursor: 'next-page', revision: '4', source: 'offline-cache', stale: true, fetchedAt: 100 } as const;
  const controller = new LibraryCatalogSearch(async (_query, cursor) => { calls.push(cursor); return cursor ? next.promise : first; }, value => states.push(value), timer);
  controller.update('song'); timer.flush(); await tick();
  const loading = controller.loadMore(); await controller.loadMore();
  assert.equal(states.at(-1)?.phase, 'loading-more');
  assert.equal(states.at(-1)?.result?.tracks[0]?.title, 'First');
  next.resolve({ ...page('Duplicate'), tracks: [...page('Duplicate').tracks, { id: 'klmnopqrstu', youtubeId: 'klmnopqrstu', title: 'Second', artist: 'Artist', brand: null }],
    nextCursor: null, revision: '4', source: 'shared', fetchedAt: 200 });
  await loading;
  const result = states.at(-1)?.result;
  assert.equal(result?.status, 'ready');
  assert.deepEqual(result.tracks.map(track => track.title), ['First', 'Second']);
  assert.equal(result.nextCursor, null);
  assert.equal(result.source, 'offline-cache');
  assert.equal(result.fetchedAt, 100);
  assert.equal(result.stale, true);
  assert.deepEqual(calls, [undefined, 'next-page']);
  controller.dispose();
});

test('stale revision leaves prior matches visible and access denial clears the old pages', async () => {
  const timer = clock(), states: LibraryCatalogSearchState[] = [];
  const first = { ...page('First'), limited: true, nextCursor: 'next-page', revision: '1' } as const;
  let response: LocalCatalogResult = { ...page('New snapshot'), revision: '2' };
  const controller = new LibraryCatalogSearch(async (_query, cursor) => cursor ? response : first, value => states.push(value), timer);
  controller.update('same song'); timer.flush(); await tick();
  await controller.loadMore();
  assert.equal(states.at(-1)?.pageError, true);
  assert.equal(states.at(-1)?.result?.tracks[0].title, 'First');
  response = { status: 'forbidden', tracks: [], limited: false, lastSuccess: null };
  await controller.loadMore();
  assert.deepEqual(states.at(-1)?.result, response);
  controller.dispose();
});

test('a next-page reply cannot escape its query or arrive after disposal', async () => {
  const timer = clock(), states: LibraryCatalogSearchState[] = [], next = deferred();
  const first = { ...page('First'), limited: true, nextCursor: 'next-page', revision: '1' } as const;
  const controller = new LibraryCatalogSearch(async (query, cursor) => cursor ? next.promise : query === 'old query' ? first : page('New query'),
    value => states.push(value), timer);
  controller.update('old query'); timer.flush(); await tick();
  const loading = controller.loadMore(); await tick();
  controller.update('new query'); timer.flush(); await tick(); controller.dispose();
  next.resolve({ ...page('Late page'), revision: '1' });
  await loading;
  assert.equal(states.at(-1)?.result?.tracks[0].title, 'New query');
});

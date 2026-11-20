import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';
import { projectControlLibrary, type ControlLibraryPage } from '../../src/control/library';
import { LocalControlClient } from '../../src/control/client';
import { fixtureAccess, httpControl, serverFixture } from './fixtures';

test('control library returns stable scoped pages with no media paths', async () => {
  const state = createInitialState('show-libr', 'epoch-libr');
  state.versions = Array.from({ length: 53 }, (_, index) => ({ id: `local-${index}`, title: `Song ${index + 1}`, artist: 'Beyoncé',
    rating: 'clean', privatePath: 'C:/synthetic-private-media/' }));
  let visible = state.versions;
  await serverFixture(async (_server, d) => {
    assert.equal((await httpControl(d, '/v1/library', { anonymous: true })).status, 401);
    assert.equal((await httpControl(d, '/v1/library?limit=101')).status, 400);
    assert.equal((await httpControl(d, '/v1/library?limit=2&limit=3')).status, 400);
    assert.equal((await httpControl(d, '/v1/library?includePrivatePaths=true')).status, 400);
    const client = new LocalControlClient(d.profileDirectory, { access: fixtureAccess });
    const first = (await client.library('beyonce song')).result as ControlLibraryPage;
    assert.equal(first.count, 53);
    assert.equal(first.items.length, 50);
    assert.equal(first.items[0].id, 'local-0');
    assert.ok(first.nextCursor);
    assert.doesNotMatch(JSON.stringify(first), /synthetic-private/);
    const last = (await client.library('beyonce song', first.nextCursor)).result as ControlLibraryPage;
    assert.deepEqual(last.items.map(item => item.id), ['local-50', 'local-51', 'local-52']);
    await assert.rejects(client.library('different query', first.nextCursor), { code: 'stale-cursor' });
    // Changing visibility can invalidate a page without incrementing state.revision.
    visible = visible.slice(1);
    await assert.rejects(client.library('beyonce song', first.nextCursor), { code: 'stale-cursor' });
  }, { adapter: {
    getState: () => state, getSettings: () => DEFAULT_SETTINGS, getShortcuts: () => DEFAULT_SHORTCUTS,
    getLibrary: query => projectControlLibrary(state, visible, query),
  } });
});

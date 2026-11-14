import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../../src/domain';
import { catalogRequest } from '../../src/domain/catalog-request';
import { parseSettings } from '../../src/domain/settings';
const input = { track: { youtubeId: 'abcdefghijk', title: 'Amateur', artist: 'Nada Surf' }, singerId: 'singer', requestId: 'request' };
const ids = { versionId: 'version', commandId: 'command' };
const fixture = () => { const state = createInitialState('show', 'epoch'); state.singers.push({ id: 'singer', name: 'Singer' }); return state; };

test('canonical catalog song and artist rules reject proposals without creating orphan versions', () => {
  for (const settings of [parseSettings({ songBlacklist: [{ artist: 'Nada Surf', title: 'Amateur' }] }), parseSettings({ artistBlacklist: ['Nada Surf'] })]) {
    const state = fixture(), planned = catalogRequest(state, input, settings, ids, 1);
    assert.equal(planned.result.ok, false); assert.equal(planned.state, state); assert.equal(state.versions.length, 0); assert.equal(state.requests.length, 0);
  }
});

test('existing library metadata and incoming canonical metadata cannot evade each other’s blacklist checks', () => {
  const state = catalogRequest(fixture(), input, parseSettings({}), ids, 1).state;
  const settings = parseSettings({ artistBlacklist: ['Nada Surf'] });
  const disguised = { ...input, requestId: 'different-request', track: { ...input.track, artist: 'Unblocked replacement' } };
  assert.equal(catalogRequest(state, disguised, settings, { versionId: 'replacement', commandId: 'different' }, 2).result.ok, false);
  state.versions[0].artist = 'Host correction';
  assert.equal(catalogRequest(state, { ...input, requestId: 'different-request' }, settings, { versionId: 'replacement', commandId: 'different' }, 2).result.ok, false);
  assert.equal(state.versions.length, 1); assert.equal(state.requests.length, 1);
});

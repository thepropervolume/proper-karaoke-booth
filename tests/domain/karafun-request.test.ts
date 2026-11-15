import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { karaFunRequest } from '../../src/domain/karafun-request';

const track = { catalog: 'catalog' as const, songId: '6229', title: 'Synthetic song', artist: 'Synthetic artist' };
function fixture() { const state = createInitialState('show', 'epoch'); state.singers.push({ id: 's', name: 'Singer' }); return state; }
const ids = { versionId: 'native-version', commandId: 'native-command' };

test('native selections can queue without a singer and retain atomic replay identity', () => {
  const state = createInitialState('show', 'epoch');
  const planned = karaFunRequest(state, track, null, 'unassigned', DEFAULT_SETTINGS, ids, 1000);
  assert.equal(planned.result.ok, true); assert.equal(planned.state.singers.length, 0);
  assert.equal(planned.state.requests[0].singerId, null);
  assert.equal(karaFunRequest(planned.state, track, null, 'unassigned', DEFAULT_SETTINGS, ids, 1001).state, planned.state);
  assert.equal(karaFunRequest(planned.state, track, 's', 'unassigned', DEFAULT_SETTINGS, ids, 1001).result.ok, false);
});

test('native KaraFun selection enters the ordinary durable queue without staging or playing', () => {
  const state = fixture(), planned = karaFunRequest(state, track, 's', 'r', DEFAULT_SETTINGS, ids, 1000);
  assert.equal(planned.result.ok, true); assert.equal(state.versions.length, 0);
  assert.deepEqual(planned.state.versions[0].source, { provider: 'karafun', catalog: 'catalog', songId: '6229' });
  assert.equal(planned.state.requests[0].status, 'accepted'); assert.equal(planned.state.playback, null);
  assert.equal(planned.state.stagedRequestId, null);
  const repeated = karaFunRequest(planned.state, track, 's', 'r', DEFAULT_SETTINGS, ids, 2000);
  assert.equal(repeated.state, planned.state); assert.equal(repeated.result.ok, true);
});

test('failed singer, limits, policy and blacklist checks cannot create an orphaned native version', () => {
  const state = fixture();
  const invalidSinger = karaFunRequest(state, track, 'missing', 'r', DEFAULT_SETTINGS, ids, 1000);
  assert.equal(invalidSinger.result.ok, false); assert.equal(invalidSinger.state, state);
  const blocked = karaFunRequest(state, track, 's', 'r', { ...DEFAULT_SETTINGS, artistBlacklist: ['synthetic artist'] }, ids, 1000);
  assert.equal(blocked.result.ok, false); assert.equal(blocked.state, state);
  state.policy.ageRestricted = true;
  const policy = karaFunRequest(state, track, 's', 'r', DEFAULT_SETTINGS, ids, 1000);
  assert.equal(policy.result.ok, false); assert.equal(policy.state, state);
});

test('catalog/community identities are distinct and existing host metadata wins over a new search result', () => {
  const state = fixture();
  const first = karaFunRequest(state, track, 's', 'r', DEFAULT_SETTINGS, ids, 1000).state;
  first.versions[0].title = 'Host corrected title';
  const second = karaFunRequest(first, track, 's', 'r2', DEFAULT_SETTINGS, { versionId: 'unused', commandId: 'next' }, 1000);
  assert.equal(second.state.versions.length, 1); assert.equal(second.state.versions[0].title, 'Host corrected title');
  const community = karaFunRequest(second.state, { ...track, catalog: 'community' }, 's', 'r3', DEFAULT_SETTINGS, { versionId: 'community-version', commandId: 'community' }, 1000);
  assert.equal(community.result.ok, true); assert.equal(community.state.versions.length, 2);
  const foreign = karaFunRequest(state, { ...track, url: 'https://example.test/private' } as typeof track, 's', 'r', DEFAULT_SETTINGS, ids, 1000);
  assert.equal(foreign.result.ok, false);
});

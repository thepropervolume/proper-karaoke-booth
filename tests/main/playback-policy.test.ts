import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyCommand, createInitialState, type Command } from '../../src/domain';
import { startPolicyError } from '../../src/main/playback-policy';

test('start preparation rejects ineligible or replaced staged tracks while resume remains available', () => {
  let state = createInitialState('show', 'epoch');
  let sequence = 0;
  const send = (command: Command) => {
    const result = applyCommand(state, { commandId: `c${++sequence}`, showId: state.showId, hostEpoch: state.hostEpoch,
      expectedRevision: state.revision, actor: { role: 'host', id: 'host' }, command }, { autoApprove: false, rotationMode: 'singer' });
    assert.equal(result.outcome.ok, true, JSON.stringify(result.outcome)); state = result.state;
  };
  send({ type: 'addSinger', singer: { id: 's', name: 'Singer' } });
  send({ type: 'addVersion', version: { id: 'v', title: 'Song', artist: '', rating: 'unrated' } });
  send({ type: 'request', requestId: 'r', singerId: 's', versionId: 'v' });
  send({ type: 'accept', requestId: 'r' }); send({ type: 'stage' });
  const start: Command = { type: 'start', generationId: 'g' };
  assert.equal(startPolicyError(state, start, 'r'), null);
  assert.match(startPolicyError(state, start, 'other')!, /changed/i);
  send({ type: 'setPolicy', policy: { ageRestricted: true, includeVersionIds: null, excludeVersionIds: [] } });
  assert.equal(state.stagedRequestId, 'r');
  assert.match(startPolicyError(state, start, 'r')!, /policy/i);
  assert.equal(startPolicyError(state, { type: 'resume' }), null);
  send({ type: 'setPolicy', policy: { ageRestricted: false, includeVersionIds: null, excludeVersionIds: [] } });
  assert.equal(startPolicyError(state, start, 'r'), null);
  send({ type: 'release' });
  assert.match(startPolicyError(state, start, 'r')!, /changed/i);
});

test('host-wide song rules gate staged preparation without persisting show exclusions', () => {
  const state = createInitialState('show', 'epoch');
  state.versions.push({ id: 'v', title: 'Popular', artist: 'Nada Surf', rating: 'unrated' });
  state.requests.push({ id: 'r', singerId: 's', versionId: 'v', status: 'staged', round: 1, order: 1 });
  state.stagedRequestId = 'r';
  const rules = { artistBlacklist: [], songBlacklist: [{ artist: 'nada surf', title: 'POPULAR' }] };
  assert.match(startPolicyError(state, { type: 'start' }, 'r', rules)!, /unavailable/i);
  assert.equal(startPolicyError(state, { type: 'start' }, 'r', { artistBlacklist: [], songBlacklist: [] }), null);
  assert.deepEqual(state.policy.excludeVersionIds, []);
});

test('resuming an existing performance respects a global artist block while retaining the old show-policy rule', () => {
  const state = createInitialState('show', 'epoch');
  state.versions.push({ id: 'v', title: 'Popular', artist: 'Nada Surf', rating: 'unrated' });
  state.requests.push({ id: 'r', singerId: 's', versionId: 'v', status: 'playing', round: 1, order: 1 });
  state.playback = { requestId: 'r', generationId: 'g', status: 'paused' };
  state.policy.excludeVersionIds = ['v'];
  assert.equal(startPolicyError(state, { type: 'resume' }, undefined, { songBlacklist: [], artistBlacklist: [] }), null);
  assert.match(startPolicyError(state, { type: 'resume' }, undefined, { songBlacklist: [], artistBlacklist: ['nada surf'] })!, /blacklisted/i);
});

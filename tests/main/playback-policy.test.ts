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

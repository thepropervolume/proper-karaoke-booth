import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createInitialState, orderedFuture, singerAvailable, type Actor, type Command } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

function fixture(autoApprove = true, limit = 0) {
  let state = createInitialState('show', 'epoch'), serial = 0;
  const send = (command: Command, actor: Actor = { role: 'host', id: 'host' }) => {
    const result = applyCommand(state, { showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision,
      commandId: String(++serial), actor, command }, { ...DEFAULT_SETTINGS, autoApprove, maxFutureRequestsPerSinger: limit }, 1000);
    state = result.state; return result.outcome;
  };
  const ok = (command: Command) => { const outcome = send(command); assert.equal(outcome.ok, true, JSON.stringify(outcome)); };
  ok({ type: 'addVersion', version: { id: 'v', title: 'Song', artist: 'Artist', rating: 'clean' } });
  for (const id of ['a', 'b']) ok({ type: 'addSinger', singer: { id, name: id } });
  return { send, ok, state: () => state };
}

test('unassigned requests are independent FIFO slots interleaved with fair named-singer rounds', () => {
  const f = fixture();
  for (const [requestId, singerId] of [['a1', 'a'], ['a2', 'a'], ['u1', null], ['b1', 'b'], ['u2', null]] as const)
    f.ok({ type: 'request', requestId, singerId, versionId: 'v' });
  assert.deepEqual(orderedFuture(f.state(), 'singer').map(r => r.id), ['a1', 'u1', 'b1', 'u2', 'a2']);
  assert.deepEqual(orderedFuture(f.state(), 'fifo').map(r => r.id), ['a1', 'a2', 'u1', 'b1', 'u2']);
  assert.deepEqual(f.state().requests.filter(r => r.singerId === null).map(r => r.round), [1, 1]);
  assert.equal(f.state().singers.length, 2, 'no anonymous or placeholder singer entity');
  assert.equal(singerAvailable(f.state(), null, 1000), true);
});

test('unassigned songs have no shared future limit while named singers retain theirs', () => {
  const f = fixture(true, 1);
  f.ok({ type: 'request', requestId: 'a1', singerId: 'a', versionId: 'v' });
  assert.equal(f.send({ type: 'request', requestId: 'a2', singerId: 'a', versionId: 'v' }).ok, false);
  for (let index = 0; index < 6; index++) f.ok({ type: 'request', requestId: 'u' + index, singerId: null, versionId: 'v' });
  assert.equal(f.state().requests.length, 7);
});

test('host can leave a song pending without a singer, approve and play it without creating a person', () => {
  const f = fixture(false);
  f.ok({ type: 'request', requestId: 'u', singerId: null, versionId: 'v' });
  assert.equal(f.state().requests[0].status, 'pending');
  assert.equal(f.send({ type: 'stage' }).ok, false);
  f.ok({ type: 'accept', requestId: 'u' }); f.ok({ type: 'stage' });
  f.ok({ type: 'start', generationId: 'g' });
  assert.equal(f.state().playback?.requestId, 'u');
  assert.equal(f.send({ type: 'complete', generationId: 'g' }, { role: 'engine', id: 'engine' }).ok, true);
  assert.equal(f.state().requests[0].status, 'completed'); assert.equal(f.state().requests[0].singerId, null);
});

test('assigning and clearing a prepared singer preserves the request identity, manual order and locked slot', () => {
  const f = fixture();
  f.ok({ type: 'request', requestId: 'a1', singerId: 'a', versionId: 'v' });
  f.ok({ type: 'request', requestId: 'u', singerId: null, versionId: 'v' });
  f.ok({ type: 'moveRequest', requestId: 'u', beforeRequestId: 'a1' });
  f.ok({ type: 'stage' });
  for (const singerId of ['b', null]) {
    f.ok({ type: 'editRequest', requestId: 'u', singerId, versionId: 'v' });
    assert.equal(f.state().stagedRequestId, 'u');
    assert.equal(f.state().requests.find(r => r.id === 'u')?.status, 'staged');
    assert.deepEqual(f.state().manualQueueOrder, ['u', 'a1']);
    assert.equal(f.state().playback, null);
  }
  f.ok({ type: 'start', generationId: 'g' });
  assert.equal(f.send({ type: 'editRequest', requestId: 'u', singerId: 'a', versionId: 'v' }).ok, false);
});

test('remote singer authority cannot queue unassigned songs or clear another request ownership', () => {
  const f = fixture();
  for (const singerId of [null, 'b']) assert.equal(f.send({ type: 'request', requestId: 'guest', singerId, versionId: 'v' }, { role: 'singer', id: 'a' }).ok, false);
  f.ok({ type: 'request', requestId: 'u', singerId: null, versionId: 'v' });
  assert.equal(f.send({ type: 'withdrawRequest', requestId: 'u' }, { role: 'singer', id: 'a' }).ok, false);
  assert.equal(f.send({ type: 'editRequest', requestId: 'u', singerId: 'a', versionId: 'v' }, { role: 'singer', id: 'a' }).ok, false);
  assert.equal(f.state().requests[0].singerId, null);
  assert.equal(f.send({ type: 'request', requestId: 'staff-unassigned', singerId: null, versionId: 'v' }, { role: 'staff', id: 'staff' }).ok, true);
  assert.equal(f.send({ type: 'editRequest', requestId: 'u', singerId: 'a', versionId: 'v' }, { role: 'staff', id: 'staff' }).ok, false);
});

test('only explicit null is unassigned; malformed blank or omitted identities are rejected', () => {
  const f = fixture();
  for (const singerId of ['', ' ', undefined, 0, false, {}]) assert.equal(f.send({ type: 'request', requestId: 'invalid', singerId, versionId: 'v' } as Command).ok, false);
  assert.equal(f.state().requests.length, 0);
});

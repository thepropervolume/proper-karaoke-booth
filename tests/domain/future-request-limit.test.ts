import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { futureRequestLimitMessage } from '../../src/domain/future-request-limit';
import { applyCommand, createInitialState, type Envelope } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

test('counts only a singer’s pending, accepted and staged future requests', () => {
  const requests = ['pending', 'accepted', 'staged', 'playing', 'completed', 'skipped', 'removed', 'rejected', 'withdrawn']
    .map(status => ({ singerId: 'singer-a', status }));
  requests.push({ singerId: 'singer-b', status: 'accepted' });
  assert.match(futureRequestLimitMessage(requests, 'singer-a') ?? '', /3 upcoming requests/);
  assert.equal(futureRequestLimitMessage(requests, 'singer-a', 4), null);
  assert.equal(futureRequestLimitMessage(requests, 'singer-a', 0), null);
  assert.match(futureRequestLimitMessage(requests, 'singer-b', 1) ?? '', /1 upcoming request\./);
  assert.equal(futureRequestLimitMessage(requests, 'unrelated', 1), null);
});
test('host-added requests obey a changed limit without removing existing requests', () => {
  let state = createInitialState('show-00001', 'epoch-0001');
  state.singers.push({ id: 'singer-1', name: 'Alice' });
  state.versions.push({ id: 'song-1', title: 'Song', artist: 'Artist', rating: 'clean' });
  const submit = (n: number, limit: number) => {
    const envelope: Envelope = { commandId: `command-${n}`, showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision,
      actor: { role: 'host', id: 'host' }, command: { type: 'request', requestId: `request-${n}`, singerId: 'singer-1', versionId: 'song-1' } };
    const result = applyCommand(state, envelope, { ...DEFAULT_SETTINGS, maxFutureRequestsPerSinger: limit }); state = result.state; return result.outcome;
  };
  assert.equal(submit(1, 0).ok, true); assert.equal(submit(2, 0).ok, true);
  const limited = submit(3, 1); assert.equal(limited.ok, false); if (!limited.ok) assert.equal(limited.code, 'LIMIT');
  assert.equal(state.requests.length, 2); assert.equal(submit(4, 0).ok, true); assert.equal(state.requests.length, 3);
});

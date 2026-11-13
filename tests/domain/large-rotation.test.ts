import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, orderedFuture, type SongRequest } from '../../src/domain/index';

function request(id: string, singerId: string, status: SongRequest['status'], round: number, order: number): SongRequest {
  return { id, singerId, status, round, order, versionId: 'song' };
}

test('fair rotation remains available with a large retained singer history', () => {
  const show = createInitialState('show', 'host');
  show.requests = Array.from({ length: 160_000 }, (_, i) => request(`past-${i}`, 'alice', 'completed', 1, i + 1));
  show.requests.push(request('bob-next', 'bob', 'accepted', 2, 160_002), request('alice-next', 'alice', 'accepted', 2, 160_001));
  assert.deepEqual(orderedFuture(show, 'singer').map(item => item.id), ['alice-next', 'bob-next']);
});

test('staged priority, historical singer order, and FIFO remain unchanged', () => {
  const show = createInitialState('show', 'host');
  show.requests = [request('removed', 'bob', 'removed', 1, 1), request('alice-past', 'alice', 'completed', 1, 2),
    request('bob-next', 'bob', 'accepted', 2, 3), request('alice-next', 'alice', 'accepted', 2, 4),
    request('staged', 'bob', 'staged', 3, 5)];
  assert.deepEqual(orderedFuture(show, 'singer').map(item => item.id), ['staged', 'alice-next', 'bob-next']);
  assert.deepEqual(orderedFuture(show, 'fifo').map(item => item.id), ['staged', 'bob-next', 'alice-next']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateQueueWaits, formatQueueWait } from '../../src/domain/queue-wait';

const timeline = { generation: 'g', position: 90, duration: 210, seekable: true, seeking: false };
const options = { generation: 'g', playing: true, autoAdvance: true, timeline, intervalSeconds: 10,
  items: [{ id: 'staged', ready: true }, { id: 'second', ready: true }, { id: 'third', ready: true }] };

test('estimates locked staged and manually ordered songs from remaining playback, inter-song gaps and four-minute assumptions', () => {
  const result = estimateQueueWaits(options);
  assert.deepEqual([...result], [['staged', 130], ['second', 380], ['third', 630]]);
  assert.equal(formatQueueWait(130), '~3 min');
  assert.equal(formatQueueWait(0), '~1 min');
});

test('does not promise timing after a blocked or preparing song', () => {
  assert.deepEqual([...estimateQueueWaits({ ...options, items: [options.items[0], { id: 'pending', ready: false }, options.items[2]] })],
    [['staged', 130], ['pending', null], ['third', null]]);
});

test('unavailable while paused, manually advanced, seeking, or timeline is missing, invalid or stale', () => {
  for (const change of [{ playing: false }, { autoAdvance: false }, { timeline: null },
    { timeline: { ...timeline, seeking: true } }, { timeline: { ...timeline, generation: 'old' } },
    { timeline: { ...timeline, duration: Infinity } }, { intervalSeconds: -1 }]) {
    assert.deepEqual([...estimateQueueWaits({ ...options, ...change }).values()], [null, null, null]);
  }
});

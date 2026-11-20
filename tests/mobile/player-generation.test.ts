import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerGenerationFence } from '../../src/mobile/player-generation';

test('events from the old media generation are fenced as soon as another turn commits', () => {
  const fence = new PlayerGenerationFence(), events: string[] = [];
  const first = JSON.stringify(['first', 'song-a']), second = JSON.stringify(['second', 'song-b']);
  fence.update(first);
  const oldEvent = (event: string) => { if (fence.matches(first)) events.push(event); };
  oldEvent('first time');
  // This is the interval after layout commit but before old passive cleanup.
  fence.update(second);
  for (const event of ['old time', 'old ended', 'old playback', 'old error', 'old ready']) oldEvent(event);
  if (fence.matches(second)) events.push('new time');
  assert.deepEqual(events, ['first time', 'new time']);
});

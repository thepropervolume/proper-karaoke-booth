import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createInitialState, remainingPauseSeconds, type Command, type ShowState } from '../../src/domain/index';
import { parseSettings } from '../../src/domain/settings';

function setup(seconds: number) {
  let state = createInitialState('show', 'epoch');
  let clock = 1_000; let counter = 0;
  const settings = { autoApprove: true, rotationMode: 'fifo' as const, pauseIntervalSeconds: seconds };
  const send = (command: Command, role: 'host' | 'engine' = 'host') => {
    const result = applyCommand(state, { commandId: String(++counter), showId: 'show', hostEpoch: 'epoch', expectedRevision: state.revision, actor: { role, id: role }, command }, settings, clock);
    state = result.state; return result.outcome;
  };
  const ok = (command: Command, role: 'host' | 'engine' = 'host') => { const result = send(command, role); assert.equal(result.ok, true, JSON.stringify(result)); };
  ok({ type: 'addVersion', version: { id: 'v', title: 'Song', artist: 'Artist', rating: 'clean' } });
  ok({ type: 'addSinger', singer: { id: 'a', name: 'Singer' } });
  ok({ type: 'request', requestId: 'r1', singerId: 'a', versionId: 'v' });
  ok({ type: 'request', requestId: 'r2', singerId: 'a', versionId: 'v' });
  ok({ type: 'stage' }); ok({ type: 'start', generationId: 'g1' });
  return { get: () => state, replace: (value: ShowState) => { state = value; }, at: (value: number) => { clock = value; }, settings, ok, send };
}

test('completion enforces a persisted interval, permits staging and never starts automatically', () => {
  const s = setup(10);
  s.ok({ type: 'complete', generationId: 'g1' }, 'engine');
  assert.equal(s.get().nextStartAtMs, 11_000);
  s.ok({ type: 'stage' });
  assert.equal(remainingPauseSeconds(s.get(), 1_001), 10);
  const blocked = s.send({ type: 'start', generationId: 'g2' });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'PAUSE_INTERVAL');
  assert.equal(s.get().stagedRequestId, 'r2');
  s.ok({ type: 'release' }); // Cancelling the staged song never schedules a start.
  assert.equal(s.get().playback, null);
  s.ok({ type: 'stage' });
  s.settings.pauseIntervalSeconds = 0; // A preference change applies to the next gap.
  s.replace(JSON.parse(JSON.stringify(s.get()))); // Restart with persisted show.
  s.at(10_999);
  assert.equal(s.send({ type: 'start', generationId: 'g2' }).ok, false);
  s.at(11_000);
  assert.equal(remainingPauseSeconds(s.get(), 11_000), 0);
  assert.equal(s.get().playback, null); // Reaching the deadline does not start a track.
  s.ok({ type: 'start', generationId: 'g2' });
  assert.equal(s.get().playback?.requestId, 'r2');
});

test('cancelled skip, pause, resume and stop do not start an interval; confirmed skip does', () => {
  const s = setup(7);
  assert.equal(s.send({ type: 'skip', generationId: 'g1', confirmed: false }).ok, false);
  assert.equal(s.get().nextStartAtMs, undefined);
  s.ok({ type: 'pause' }); s.ok({ type: 'resume' }); s.ok({ type: 'stop' });
  assert.equal(s.get().nextStartAtMs, undefined);
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g2' });
  s.ok({ type: 'skip', generationId: 'g2', confirmed: true });
  assert.equal(s.get().nextStartAtMs, 8_000);
  assert.equal(s.send({ type: 'complete', generationId: 'g2' }, 'engine').ok, false);
  assert.equal(s.get().nextStartAtMs, 8_000);
});

test('interval defaults to zero and settings reject out-of-range values', () => {
  assert.equal(parseSettings({}).pauseIntervalSeconds, 0);
  assert.equal(parseSettings({ pauseIntervalSeconds: 300 }).pauseIntervalSeconds, 300);
  for (const value of [-1, 301, 0.1, '2', null]) assert.throws(() => parseSettings({ pauseIntervalSeconds: value }));
  const s = setup(0); s.ok({ type: 'complete', generationId: 'g1' }, 'engine');
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g2' });
});

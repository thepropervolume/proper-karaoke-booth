import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, createInitialState, type Command } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { stageNextApproved } from '../../src/main/stage-next';

function fixture(autoApprove = true) {
  let state = createInitialState('show', 'epoch'), sequence = 0;
  const settings = { ...DEFAULT_SETTINGS, autoApprove };
  const send = (command: Command) => {
    const result = applyCommand(state, { commandId: String(++sequence), showId: state.showId, hostEpoch: state.hostEpoch,
      expectedRevision: state.revision, actor: { role: 'host', id: 'host' }, command }, settings, 1000);
    assert.equal(result.outcome.ok, true); state = result.state;
  };
  for (const id of ['one', 'two']) send({ type: 'addSinger', singer: { id, name: id } });
  send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated' } });
  return { send, settings, state: () => state, install: (next: typeof state) => { state = next; } };
}

test('automatic staging prepares an approved request, never starts audio, and keeps the staged lock', () => {
  const f = fixture(); f.send({ type: 'request', requestId: 'first', singerId: 'one', versionId: 'song' });
  const staged = stageNextApproved(f.state(), f.settings, 1000); f.install(staged);
  assert.equal(staged.stagedRequestId, 'first'); assert.equal(staged.requests[0].status, 'staged'); assert.equal(staged.playback, null);
  f.send({ type: 'request', requestId: 'second', singerId: 'two', versionId: 'song' });
  assert.equal(stageNextApproved(f.state(), f.settings, 1000), f.state()); assert.equal(f.state().stagedRequestId, 'first');
});

test('moderation is respected; accepting a request prepares it, including while another singer plays', () => {
  const f = fixture(false); f.send({ type: 'request', requestId: 'first', singerId: 'one', versionId: 'song' });
  assert.equal(stageNextApproved(f.state(), f.settings, 1000), f.state());
  f.send({ type: 'accept', requestId: 'first' }); f.install(stageNextApproved(f.state(), f.settings, 1000));
  f.send({ type: 'start', generationId: 'performance' });
  f.send({ type: 'request', requestId: 'second', singerId: 'two', versionId: 'song' }); f.send({ type: 'accept', requestId: 'second' });
  const staged = stageNextApproved(f.state(), f.settings, 1000);
  assert.equal(staged.stagedRequestId, 'second'); assert.equal(staged.playback?.generationId, 'performance');
});

test('held singers and policy-blocked requests are never silently staged', () => {
  const f = fixture(); f.send({ type: 'setSingerAvailability', singerId: 'one', minutes: 5 });
  f.send({ type: 'request', requestId: 'held', singerId: 'one', versionId: 'song' });
  assert.equal(stageNextApproved(f.state(), f.settings, 1000), f.state());
  f.send({ type: 'request', requestId: 'blocked', singerId: 'two', versionId: 'song' });
  const settings = { ...f.settings, artistBlacklist: ['Artist'] };
  assert.equal(stageNextApproved(f.state(), settings, 1000), f.state());
});

test('a downloading song keeps its turn while playing and moves back one song only when its turn arrives', () => {
  for (const rotationMode of ['singer', 'fifo'] as const) {
    const f = fixture();
    const settings = { ...f.settings, rotationMode };
    f.send({ type: 'addVersion', version: { id: 'waiting', title: 'Waiting', artist: 'Artist', rating: 'unrated' } });
    f.send({ type: 'request', requestId: 'current', singerId: null, versionId: 'song' });
    f.install(stageNextApproved(f.state(), settings, 1000));
    f.send({ type: 'start', generationId: 'current-playback' });
    f.send({ type: 'request', requestId: 'waiting-turn', singerId: 'one', versionId: 'waiting' });
    f.send({ type: 'request', requestId: 'ready-turn', singerId: 'two', versionId: 'song' });
    const isReady = (id: string) => id !== 'waiting';
    f.install(stageNextApproved(f.state(), settings, 1000, isReady));
    assert.equal(f.state().stagedRequestId, 'waiting-turn');
    const playing = f.state();
    const completed = applyCommand(playing, { commandId: 'done', showId: playing.showId, hostEpoch: playing.hostEpoch,
      expectedRevision: playing.revision, actor: { role: 'engine', id: 'engine' },
      command: { type: 'complete', generationId: 'current-playback' } }, settings, 1000);
    assert.equal(completed.outcome.ok, true);
    f.install(stageNextApproved(completed.state, settings, 1000, isReady));
    assert.equal(f.state().stagedRequestId, 'ready-turn');
    assert.equal(f.state().requests.find(request => request.id === 'waiting-turn')?.status, 'accepted');
    f.send({ type: 'start', generationId: 'ready-playback' });
    f.install(stageNextApproved(f.state(), settings, 1000, isReady));
    assert.equal(f.state().stagedRequestId, 'waiting-turn');
    const next = f.state();
    const nextCompleted = applyCommand(next, { commandId: 'done2', showId: next.showId, hostEpoch: next.hostEpoch,
      expectedRevision: next.revision, actor: { role: 'engine', id: 'engine' },
      command: { type: 'complete', generationId: 'ready-playback' } }, settings, 1000);
    assert.equal(nextCompleted.outcome.ok, true);
    f.install(stageNextApproved(nextCompleted.state, settings, 1000, isReady));
    assert.equal(f.state().stagedRequestId, 'waiting-turn');
    f.install(stageNextApproved(f.state(), settings, 1000, () => true));
    assert.equal(f.state().stagedRequestId, 'waiting-turn');
  }
});

test('an unavailable download never stages ahead of a ready accepted request', () => {
  const f = fixture();
  f.send({ type: 'addVersion', version: { id: 'waiting', title: 'Waiting', artist: 'Artist', rating: 'unrated' } });
  f.send({ type: 'request', requestId: 'waiting-turn', singerId: 'one', versionId: 'waiting' });
  f.send({ type: 'request', requestId: 'ready-turn', singerId: 'two', versionId: 'song' });
  f.install(stageNextApproved(f.state(), f.settings, 1000, id => id !== 'waiting'));
  assert.equal(f.state().stagedRequestId, 'ready-turn');
  assert.equal(f.state().requests.find(request => request.id === 'waiting-turn')?.status, 'accepted');
});

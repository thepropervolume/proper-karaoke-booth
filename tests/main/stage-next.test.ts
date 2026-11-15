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

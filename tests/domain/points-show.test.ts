import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, createInitialState, type Actor, type Command } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

function fixture() {
  let state = createInitialState('show', 'epoch'), counter = 0;
  const settings = { ...DEFAULT_SETTINGS, pointsEnabled: true, applauseEnabled: true, maxFutureRequestsPerSinger: 0 };
  const send = (command: Command, actor: Actor = { role: 'host', id: 'host' }, seen = false) => {
    const result = applyCommand(state, { showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision,
      commandId: `cmd-${++counter}`, actor, command }, settings, 1000, { songSeenBefore: () => seen });
    assert.equal(result.outcome.ok, true, JSON.stringify(result.outcome));
    state = result.state;
  };
  return { send, settings, current: () => state, singer: (id: string) => state.points?.accounts.find(row => row.singerId === id) };
}

test('show commands award duet queue points and both singers earn credits only after completion', () => {
  const f = fixture();
  for (const id of ['lead', 'duet', 'audience']) f.send({ type: 'addSinger', singer: { id, name: id } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated', isDuet: true } });
  f.send({ type: 'request', requestId: 'audience-song', versionId: 'song', singerId: 'audience' }, undefined, true);
  f.send({ type: 'request', requestId: 'duet-song', versionId: 'song', singerId: 'lead', coSingerId: 'duet' }, undefined, true);
  assert.equal(f.singer('lead')?.points, 32);
  assert.equal(f.singer('duet')?.points, 14);
  f.send({ type: 'stage', requestId: 'duet-song' });
  f.send({ type: 'start', generationId: 'performance' });
  const snapshot = f.current();
  const rejected = applyCommand(snapshot, { showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision,
    commandId: 'self-applause', actor: { role: 'singer', id: 'duet' }, command: { type: 'applause' } }, f.settings, 1000);
  assert.equal(rejected.outcome.ok, false);
  assert.match(rejected.outcome.ok ? '' : rejected.outcome.message, /own performance/);
  assert.equal(rejected.state.points?.accounts.find(row => row.singerId === 'duet')?.credits, 3);
  f.send({ type: 'applause' }, { role: 'singer', id: 'audience' });
  f.send({ type: 'complete', generationId: 'performance' }, { role: 'engine', id: 'engine' });
  assert.equal(f.singer('lead')?.points, 92);
  assert.equal(f.singer('duet')?.points, 74);
  assert.equal(f.singer('lead')?.credits, 4);
  assert.equal(f.singer('duet')?.credits, 4);
  assert.equal(f.singer('audience')?.credits, 2);
});

test('applause during pause uses a credit but does not score the paused song', () => {
  const f = fixture();
  for (const id of ['singer', 'listener']) f.send({ type: 'addSinger', singer: { id, name: id } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated' } });
  f.send({ type: 'request', requestId: 'request', versionId: 'song', singerId: 'singer' });
  f.send({ type: 'stage' });
  f.send({ type: 'start', generationId: 'generation' });
  f.send({ type: 'pause' });
  const previous = f.singer('singer')?.points;
  f.send({ type: 'applause' }, { role: 'singer', id: 'listener' });
  assert.equal(f.singer('singer')?.points, previous);
  assert.equal(f.singer('listener')?.credits, 2);
});

test('unknown all-time history does not award the new-to-library bonus', () => {
  const f = fixture();
  f.send({ type: 'addSinger', singer: { id: 'singer', name: 'Singer' } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated' } });
  const original = f.current();
  const result = applyCommand(original, { showId: 'show', hostEpoch: 'epoch', expectedRevision: original.revision,
    commandId: 'unknown-history', actor: { role: 'host', id: 'host' },
    command: { type: 'request', requestId: 'r', singerId: 'singer', versionId: 'song' } }, f.settings, 1000);
  assert.equal(result.state.points?.accounts.find(row => row.singerId === 'singer')?.points, 18);
});

test('adding a duet partner after queueing awards them once even if reselected', () => {
  const f = fixture();
  for (const id of ['lead', 'partner']) f.send({ type: 'addSinger', singer: { id, name: id } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated', isDuet: true } });
  f.send({ type: 'request', requestId: 'request', versionId: 'song', singerId: 'lead' });
  f.send({ type: 'editRequest', requestId: 'request', singerId: 'lead', versionId: 'song', coSingerId: 'partner' });
  assert.equal(f.singer('partner')?.points, 14);
  f.send({ type: 'editRequest', requestId: 'request', singerId: 'lead', versionId: 'song', coSingerId: null });
  f.send({ type: 'editRequest', requestId: 'request', singerId: 'lead', versionId: 'song', coSingerId: 'partner' });
  assert.equal(f.singer('partner')?.points, 14);
});

test('a singer cannot receive giver points for applauding an unassigned performance', () => {
  const f = fixture();
  f.send({ type: 'addSinger', singer: { id: 'listener', name: 'Listener' } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated' } });
  f.send({ type: 'request', requestId: 'request', versionId: 'song', singerId: null });
  f.send({ type: 'stage' });
  f.send({ type: 'start', generationId: 'performance' });
  f.send({ type: 'applause' }, { role: 'singer', id: 'listener' });
  assert.equal(f.singer('listener')?.points, 0);
  assert.equal(f.singer('listener')?.credits, 2);
});

test('marking a queued song as a duet awards the lead and partner once', () => {
  const f = fixture();
  for (const id of ['lead', 'partner']) f.send({ type: 'addSinger', singer: { id, name: id } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated' } });
  f.send({ type: 'request', requestId: 'request', versionId: 'song', singerId: 'lead' });
  assert.equal(f.singer('lead')?.points, 36);
  f.send({ type: 'editVersion', id: 'song', title: 'Song', artist: 'Artist', isDuet: true });
  assert.equal(f.singer('lead')?.points, 50);
  f.send({ type: 'editRequest', requestId: 'request', singerId: 'lead', versionId: 'song', coSingerId: 'partner' });
  assert.equal(f.singer('lead')?.points, 50);
  assert.equal(f.singer('partner')?.points, 14);
  f.send({ type: 'editVersion', id: 'song', title: 'Song', artist: 'Artist', isDuet: false });
  f.send({ type: 'editVersion', id: 'song', title: 'Song', artist: 'Artist', isDuet: true });
  f.send({ type: 'editRequest', requestId: 'request', singerId: 'lead', versionId: 'song', coSingerId: null });
  f.send({ type: 'editRequest', requestId: 'request', singerId: 'lead', versionId: 'song', coSingerId: 'partner' });
  assert.equal(f.singer('lead')?.points, 50);
  assert.equal(f.singer('partner')?.points, 14);
});

test('selecting a duet at queue time does not award the lead twice when adding a partner', () => {
  const f = fixture();
  for (const id of ['lead', 'partner']) f.send({ type: 'addSinger', singer: { id, name: id } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated', isDuet: true } });
  f.send({ type: 'request', requestId: 'request', versionId: 'song', singerId: 'lead' });
  assert.equal(f.singer('lead')?.points, 50);
  f.send({ type: 'editRequest', requestId: 'request', singerId: 'lead', versionId: 'song', coSingerId: 'partner' });
  assert.equal(f.singer('lead')?.points, 50);
  assert.equal(f.singer('partner')?.points, 14);
});


test('assigning a singer after queueing grants the original history bonuses exactly once per singer', () => {
  const f = fixture();
  for (const id of ['first', 'second']) f.send({ type: 'addSinger', singer: { id, name: id } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated' } });
  f.send({ type: 'request', requestId: 'request', versionId: 'song', singerId: null });
  f.send({ type: 'editRequest', requestId: 'request', versionId: 'song', singerId: 'first' });
  assert.equal(f.singer('first')?.points, 36);
  f.send({ type: 'editRequest', requestId: 'request', versionId: 'song', singerId: 'second' });
  assert.equal(f.singer('second')?.points, 36);
  f.send({ type: 'editRequest', requestId: 'request', versionId: 'song', singerId: 'first' });
  assert.equal(f.singer('first')?.points, 36);
});

test('legacy queue assignments do not invent history bonuses', () => {
  const f = fixture();
  f.send({ type: 'addSinger', singer: { id: 'lead', name: 'Lead' } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated' } });
  f.send({ type: 'request', requestId: 'request', versionId: 'song', singerId: null });
  delete f.current().points!.queueFacts;
  f.send({ type: 'editRequest', requestId: 'request', versionId: 'song', singerId: 'lead' });
  assert.equal(f.singer('lead')?.points, 12);
});


test('different singers can applaud and send a photo from the same stale show revision', () => {
  const f = fixture();
  for (const id of ['performer', 'alice', 'bob']) f.send({ type: 'addSinger', singer: { id, name: id } });
  f.send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'unrated' } });
  f.send({ type: 'request', requestId: 'request', versionId: 'song', singerId: 'performer' });
  f.send({ type: 'stage' }); f.send({ type: 'start', generationId: 'performance' });
  let state = f.current();
  const staleRevision = state.revision;
  const envelope = (id: string, actor: Actor, command: Command) => ({ showId: 'show', hostEpoch: 'epoch',
    expectedRevision: staleRevision, commandId: id, actor, command });
  const first = envelope('clap-alice', { role: 'singer', id: 'alice' }, { type: 'applause' });
  const second = envelope('clap-bob', { role: 'singer', id: 'bob' }, { type: 'applause' });
  const photo = envelope('photo-bob', { role: 'singer', id: 'bob' }, { type: 'photo', photoHash: 'a'.repeat(64) });
  const perform = (item: typeof first) => { const result = applyCommand(state, item, f.settings, 1000); state = result.state; return result.outcome; };
  assert.equal(perform(first).ok, true);
  assert.equal(perform(second).ok, true);
  assert.equal(perform(photo).ok, true);
  assert.equal(state.points?.accounts.find(item => item.singerId === 'performer')?.points, 36 + 10 + 15 + 5 + 50);
  assert.equal(state.points?.accounts.find(item => item.singerId === 'alice')?.credits, 2);
  assert.equal(state.points?.accounts.find(item => item.singerId === 'bob')?.points, 8 + 24);
  assert.equal(perform(second).ok, true);
  assert.equal(perform(photo).ok, true);
  assert.equal(state.points?.accounts.find(item => item.singerId === 'bob')?.points, 32);
  assert.equal(state.points?.accounts.find(item => item.singerId === 'bob')?.credits, 2);
  const changed = perform({ ...second, actor: { role: 'singer', id: 'alice' } });
  assert.equal(changed.ok ? '' : changed.code, 'COMMAND_ID_REUSED');
  const wrongShow = perform({ ...photo, commandId: 'wrong-show', hostEpoch: 'other' });
  assert.equal(wrongShow.ok ? '' : wrongShow.code, 'STALE_SHOW');
  const ordinary = perform(envelope('stale-queue', { role: 'host', id: 'host' },
    { type: 'request', requestId: 'r2', versionId: 'song', singerId: 'alice' }));
  assert.equal(ordinary.ok ? '' : ordinary.code, 'REVISION_CONFLICT');
});

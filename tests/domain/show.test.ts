import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createInitialState, visibleVersions, type Actor, type Command, type Envelope, type ShowState } from '../../src/domain/index';

function setup() {
  let state = createInitialState('show', 'epoch');
  let n = 0;
  const host: Actor = { role: 'host', id: 'host' };
  const send = (command: Command, actor = host) => {
    const envelope: Envelope = { commandId: `c${++n}`, showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision, actor, command };
    const result = applyCommand(state, envelope, { autoApprove: false, rotationMode: 'singer' }); state = result.state;
    return { ...result, envelope };
  };
  const ok = (command: Command, actor = host) => { const r = send(command, actor); assert.equal(r.outcome.ok, true, JSON.stringify(r.outcome)); return r; };
  const get = () => state;
  return { send, ok, get, replace: (next: ShowState) => { state = next; } };
}
function library(s: ReturnType<typeof setup>) {
  s.ok({ type: 'addVersion', version: { id: 'v1', title: 'Song', artist: 'Artist', rating: 'clean' } });
  s.ok({ type: 'addSinger', singer: { id: 'a', name: 'A' } });
  s.ok({ type: 'addSinger', singer: { id: 'b', name: 'B' } });
}
function accept(s: ReturnType<typeof setup>, id: string, singerId: string, versionId = 'v1') {
  s.ok({ type: 'request', requestId: id, singerId, versionId });
  s.ok({ type: 'accept', requestId: id });
}

test('removing a queued request frees its turn and never removes an active performance', () => {
  const s = setup(); library(s); accept(s, 'a1', 'a');
  s.ok({ type: 'stage' });
  s.ok({ type: 'removeRequest', requestId: 'a1' });
  assert.equal(s.get().stagedRequestId, null);
  assert.equal(s.get().requests.find(r => r.id === 'a1')?.status, 'removed');
  accept(s, 'b1', 'b');
  accept(s, 'a2', 'a');
  assert.equal(s.get().requests.find(r => r.id === 'a2')?.round, 1);
  s.ok({ type: 'stage' });
  assert.equal(s.get().stagedRequestId, 'b1');
  s.ok({ type: 'removeRequest', requestId: 'b1' });
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g1' });
  assert.equal(s.send({ type: 'removeRequest', requestId: 'a2' }).outcome.ok, false);
  assert.equal(s.get().playback?.requestId, 'a2');
});

test('rounds schedule one song per singer and lock the staged track', () => {
  const s = setup(); library(s);
  accept(s, 'a1', 'a'); accept(s, 'a2', 'a'); accept(s, 'b1', 'b');
  assert.deepEqual(s.get().requests.map(r => [r.id, r.round]), [['a1', 1], ['a2', 2], ['b1', 1]]);
  s.ok({ type: 'stage' }); assert.equal(s.get().stagedRequestId, 'a1');
  assert.equal(s.send({ type: 'stage' }).outcome.ok, false);
  s.ok({ type: 'start', generationId: 'g1' });
  s.ok({ type: 'stage' }); assert.equal(s.get().stagedRequestId, 'b1');
  s.ok({ type: 'complete', generationId: 'g1' }, { role: 'engine', id: 'engine' });
  s.ok({ type: 'start', generationId: 'g2' });
  s.ok({ type: 'skip', generationId: 'g2', confirmed: true });
  s.ok({ type: 'stage' }); assert.equal(s.get().stagedRequestId, 'a2');
});

test('new singers join the current tail until its last turn starts', () => {
  const s = setup(); library(s); accept(s, 'a1', 'a');
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g1' });
  accept(s, 'b1', 'b'); assert.equal(s.get().requests.find(r => r.id === 'b1')?.round, 2);
  s.ok({ type: 'complete', generationId: 'g1' }, { role: 'engine', id: 'engine' }); s.ok({ type: 'stage' });
  s.ok({ type: 'addSinger', singer: { id: 'c', name: 'C' } }); accept(s, 'c1', 'c');
  assert.equal(s.get().requests.find(r => r.id === 'c1')?.round, 2);
});

test('stopping the final performance reopens its round for a newly arriving singer', () => {
  const s = setup(); library(s); accept(s, 'a1', 'a');
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g1' });
  assert.equal(s.get().finalTurnBegun, true);
  s.ok({ type: 'stop' });
  accept(s, 'b1', 'b');
  assert.equal(s.get().requests.find(r => r.id === 'b1')?.round, 1);
  s.ok({ type: 'stage' });
  assert.equal(s.get().stagedRequestId, 'a1');
});

test('staging a later round does not advance the round before its performance starts', () => {
  const s = setup(); library(s); accept(s, 'a1', 'a'); accept(s, 'a2', 'a');
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g1' });
  s.ok({ type: 'stage' });
  assert.equal(s.get().stagedRequestId, 'a2');
  assert.equal(s.get().currentRound, 1);
  s.ok({ type: 'stop' });
  accept(s, 'b1', 'b');
  assert.equal(s.get().requests.find(r => r.id === 'b1')?.round, 1);
  s.ok({ type: 'release' }); s.ok({ type: 'stage' });
  assert.equal(s.get().stagedRequestId, 'a1');
});

test('command receipts preserve success and failure outcomes and detect changed retries', () => {
  const s = setup();
  const first = s.ok({ type: 'addSinger', singer: { id: 'a', name: 'A' } });
  s.ok({ type: 'addSinger', singer: { id: 'b', name: 'B' } });
  assert.deepEqual(applyCommand(s.get(), first.envelope).outcome, first.outcome);
  const changed = { ...first.envelope, command: { type: 'addSinger', singer: { id: 'c', name: 'C' } } as Command };
  assert.equal((applyCommand(s.get(), changed).outcome as { code: string }).code, 'COMMAND_ID_REUSED');
  const failed = s.send({ type: 'stage' }); const revision = s.get().revision;
  assert.equal(failed.outcome.ok, false); assert.equal(s.get().revision, revision);
  s.ok({ type: 'addSinger', singer: { id: 'c', name: 'C' } });
  assert.deepEqual(applyCommand(s.get(), failed.envelope).outcome, failed.outcome);
  assert.deepEqual(JSON.parse(JSON.stringify(s.get())), s.get());
});

test('stale playback callbacks do not consume a newer turn', () => {
  const s = setup(); library(s); accept(s, 'a1', 'a');
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g1' }); s.ok({ type: 'stop' });
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g2' });
  const stale = s.send({ type: 'complete', generationId: 'g1' }, { role: 'engine', id: 'engine' });
  assert.equal((stale.outcome as { code: string }).code, 'STALE_GENERATION');
  assert.equal(s.get().playback?.generationId, 'g2');
  s.ok({ type: 'complete', generationId: 'g2' }, { role: 'engine', id: 'engine' });
  assert.equal(s.get().requests[0].status, 'completed');
});

test('roles and policies are enforced at request, staging and start boundaries', () => {
  const s = setup(); library(s);
  s.ok({ type: 'addVersion', version: { id: 'v2', title: 'Unrated', artist: '', rating: 'unrated' } });
  const staff: Actor = { role: 'staff', id: 'staff' };
  assert.equal(s.send({ type: 'stage' }, staff).outcome.ok, false);
  assert.equal(s.send({ type: 'request', requestId: 'bad', singerId: 'b', versionId: 'v1' }, { role: 'singer', id: 'a' }).outcome.ok, false);
  accept(s, 'a1', 'a', 'v2'); s.ok({ type: 'stage' });
  s.ok({ type: 'setPolicy', policy: { ageRestricted: true, includeVersionIds: null, excludeVersionIds: [] } });
  assert.equal(s.get().stagedRequestId, null);
  assert.deepEqual(visibleVersions(s.get()).map(v => v.id), ['v1']);
  assert.equal(s.send({ type: 'request', requestId: 'bad2', singerId: 'a', versionId: 'v2' }).outcome.ok, false);
  assert.equal(s.send({ type: 'stage' }).outcome.ok, false);
  assert.equal(s.send({ type: 'start', generationId: 'g1' }).outcome.ok, false);
  s.ok({ type: 'setPolicy', policy: { ageRestricted: true, includeVersionIds: ['v1'], excludeVersionIds: ['v1'] } });
  assert.deepEqual(visibleVersions(s.get()), []);
});


test('later rounds preserve singer rotation when future songs arrive in reverse order', () => {
  const s = setup(); library(s);
  s.ok({ type: 'addSinger', singer: { id: 'c', name: 'C' } });
  accept(s, 'a1', 'a'); accept(s, 'b1', 'b'); accept(s, 'c1', 'c');
  accept(s, 'c2', 'c'); accept(s, 'b2', 'b'); accept(s, 'a2', 'a');
  for (const id of ['a1', 'b1', 'c1', 'a2', 'b2', 'c2']) {
    s.ok({ type: 'stage' });
    assert.equal(s.get().stagedRequestId, id);
    s.ok({ type: 'start', generationId: `generation-${id}` });
    s.ok({ type: 'complete', generationId: `generation-${id}` }, { role: 'engine', id: 'engine' });
  }
});

test('only engine completion and confirmed host skips consume active turns', () => {
  const s = setup(); library(s); accept(s, 'a1', 'a');
  s.ok({ type: 'stage' }); s.ok({ type: 'start', generationId: 'g1' });
  assert.equal(s.send({ type: 'complete', generationId: 'g1' }).outcome.ok, false);
  assert.equal(s.send({ type: 'skip', generationId: 'g1', confirmed: false }).outcome.ok, false);
  assert.equal(s.get().requests[0].status, 'playing');
  s.ok({ type: 'skip', generationId: 'g1', confirmed: true });
  assert.equal(s.get().requests[0].status, 'skipped');
});

test('rejection and singer withdrawal preserve history, ownership and staged playback', () => {
  const s = setup(); library(s);
  const alice: Actor = { role: 'singer', id: 'a' }, bob: Actor = { role: 'singer', id: 'b' };
  s.ok({ type: 'request', requestId: 'reject-1', singerId: 'a', versionId: 'v1' }, alice);
  assert.equal(s.send({ type: 'rejectRequest', requestId: 'reject-1' }, alice).outcome.ok, false);
  s.ok({ type: 'rejectRequest', requestId: 'reject-1' });
  assert.equal(s.get().requests[0].status, 'rejected');
  s.ok({ type: 'request', requestId: 'withdraw-1', singerId: 'a', versionId: 'v1' }, alice);
  assert.equal(s.send({ type: 'withdrawRequest', requestId: 'withdraw-1' }, bob).outcome.ok, false);
  assert.equal(s.send({ type: 'withdrawRequest', requestId: 'withdraw-1' }).outcome.ok, false);
  s.ok({ type: 'accept', requestId: 'withdraw-1' });
  s.ok({ type: 'withdrawRequest', requestId: 'withdraw-1' }, alice);
  assert.equal(s.get().requests[1].status, 'withdrawn');
  accept(s, 'staged-1', 'a');
  assert.equal(s.get().requests[2].round, 1, 'withdrawal returns the turn');
  s.ok({ type: 'stage' });
  assert.equal(s.send({ type: 'withdrawRequest', requestId: 'staged-1' }, alice).outcome.ok, false);
  assert.equal(s.get().stagedRequestId, 'staged-1');
  s.ok({ type: 'start', generationId: 'generation-1' });
  assert.equal(s.send({ type: 'withdrawRequest', requestId: 'staged-1' }, alice).outcome.ok, false);
  assert.equal(s.get().playback?.requestId, 'staged-1');
});

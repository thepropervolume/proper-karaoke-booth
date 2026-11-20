import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCommand, createInitialState, orderedFuture, type Actor, type Command, type ShowState } from '../../src/domain';
import { Store } from '../../src/main/store';

function fixture() {
  let state = createInitialState('show', 'epoch'), seq = 0;
  const send = (command: Command, mode: 'singer' | 'fifo' = 'singer', actor: Actor = { role: 'host', id: 'host' }) => {
    const result = applyCommand(state, { showId: 'show', hostEpoch: 'epoch', commandId: String(++seq), expectedRevision: state.revision, actor, command }, { autoApprove: true, rotationMode: mode });
    state = result.state; return result.outcome;
  };
  const ok = (command: Command, mode?: 'singer' | 'fifo') => assert.equal(send(command, mode).ok, true);
  ok({ type: 'addVersion', version: { id: 'v', title: 'Track', artist: 'Artist', rating: 'clean' } });
  for (const id of ['a', 'b', 'c']) ok({ type: 'addSinger', singer: { id, name: id.toUpperCase() } });
  for (const [id, singerId] of [['a1', 'a'], ['a2', 'a'], ['b1', 'b'], ['c1', 'c']]) ok({ type: 'request', requestId: id, singerId, versionId: 'v' });
  return { send, ok, get: () => state, replace: (next: ShowState) => { state = next; } };
}

test('promotion replaces the prepared next song without changing assigned rounds', () => {
  const f = fixture();
  f.ok({ type: 'stage' });
  const before = f.get().requests.map(({ id, round, order }) => ({ id, round, order }));
  f.ok({ type: 'promoteRequest', requestId: 'a2' });
  assert.equal(f.get().stagedRequestId, null);
  assert.deepEqual(orderedFuture(f.get(), 'singer').map(r => r.id), ['a2', 'a1', 'b1', 'c1']);
  assert.deepEqual(orderedFuture(f.get(), 'fifo').map(r => r.id), ['a2', 'a1', 'b1', 'c1']);
  assert.deepEqual(f.get().requests.map(({ id, round, order }) => ({ id, round, order })), before);
  f.ok({ type: 'stage' }); assert.equal(f.get().stagedRequestId, 'a2');
  f.ok({ type: 'start', generationId: 'g1' });
  f.ok({ type: 'stage' });
  assert.equal(f.get().stagedRequestId, 'a1');
  assert.equal(f.send({ type: 'complete', generationId: 'g1' }, 'singer', { role: 'engine', id: 'engine' }).ok, true);
});

test('a later-round promotion does not advance currentRound past earlier waiting turns', () => {
  const f = fixture();
  f.ok({ type: 'promoteRequest', requestId: 'a2' });
  f.ok({ type: 'stage' });
  assert.equal(f.get().stagedRequestId, 'a2');
  f.ok({ type: 'start', generationId: 'g1' });
  assert.equal(f.get().currentRound, 1);
  assert.equal(f.get().promotedRequestId, 'a2');
  assert.deepEqual(orderedFuture(f.get(), 'singer').map(r => r.id), ['a1', 'b1', 'c1']);
  f.ok({ type: 'request', requestId: 'c2', singerId: 'c', versionId: 'v' });
  assert.equal(f.get().requests.find(r => r.id === 'c2')?.round, 2);
});

test('promotion survives saved-state reopen and release and is cleared on removal', () => {
  const f = fixture(); f.ok({ type: 'promoteRequest', requestId: 'b1' });
  const dir = mkdtempSync(join(tmpdir(), 'tpv-promote-')); let db: Store<ShowState> | undefined;
  try {
    const path = join(dir, 'show.sqlite'); db = new Store(path); db.save(f.get()); db.close();
    db = new Store(path); const loaded = db.load(); assert.ok(loaded); f.replace(loaded);
    assert.equal(orderedFuture(f.get(), 'singer')[0].id, 'b1');
    f.ok({ type: 'stage' }); assert.equal(f.get().stagedRequestId, 'b1');
    f.ok({ type: 'release' }); assert.equal(orderedFuture(f.get(), 'fifo')[0].id, 'b1');
    f.ok({ type: 'removeRequest', requestId: 'b1' });
    assert.equal(f.get().promotedRequestId, null);
    assert.deepEqual(orderedFuture(f.get(), 'singer').map(r => r.id), ['a1', 'c1', 'a2']);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('only the host may promote an eligible accepted request; withdrawal clears promotion', () => {
  const f = fixture();
  assert.equal(f.send({ type: 'promoteRequest', requestId: 'b1' }, 'singer', { role: 'staff', id: 'staff' }).ok, false);
  assert.equal(f.send({ type: 'promoteRequest', requestId: 'b1' }, 'singer', { role: 'singer', id: 'b' }).ok, false);
  assert.equal(f.send({ type: 'promoteRequest', requestId: 'missing' }).ok, false);
  f.ok({ type: 'promoteRequest', requestId: 'b1' });
  assert.equal(f.send({ type: 'withdrawRequest', requestId: 'b1' }, 'singer', { role: 'singer', id: 'b' }).ok, true);
  assert.equal(f.get().promotedRequestId, null);
  f.ok({ type: 'stage' });
  assert.equal(f.send({ type: 'promoteRequest', requestId: f.get().stagedRequestId! }).ok, false);
  f.ok({ type: 'setPolicy', policy: { ageRestricted: false, includeVersionIds: [], excludeVersionIds: [] } });
  assert.equal(f.send({ type: 'promoteRequest', requestId: 'a2' }).ok, false);
});

test('changing policy clears a promotion that has become unavailable', () => {
  const f = fixture(); f.ok({ type: 'promoteRequest', requestId: 'b1' });
  f.ok({ type: 'setPolicy', policy: { ageRestricted: false, includeVersionIds: [], excludeVersionIds: [] } });
  assert.equal(f.get().promotedRequestId, null);
});

test('stopping a promoted performance returns it to its promoted position until its turn is consumed', () => {
  const f = fixture(); f.ok({ type: 'promoteRequest', requestId: 'a2' });
  f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g1' });
  assert.equal(f.get().promotedRequestId, 'a2');
  f.ok({ type: 'stop' });
  assert.equal(orderedFuture(f.get(), 'singer')[0].id, 'a2');
  f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g2' });
  f.ok({ type: 'skip', generationId: 'g2', confirmed: true });
  assert.equal(f.get().promotedRequestId, null);
});

test('a newer promotion survives stopping or completing an older promoted performance', () => {
  for (const end of ['stop', 'complete'] as const) {
    const f = fixture(); f.ok({ type: 'promoteRequest', requestId: 'a2' });
    f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g1' });
    f.ok({ type: 'promoteRequest', requestId: 'c1' });
    if (end === 'stop') f.ok({ type: 'stop' });
    else assert.equal(f.send({ type: 'complete', generationId: 'g1' }, 'singer', { role: 'engine', id: 'engine' }).ok, true);
    assert.equal(f.get().promotedRequestId, 'c1');
    assert.equal(orderedFuture(f.get(), 'singer')[0].id, 'c1');
  }
});

test('a playing promotion survives database reopen and stopped recovery', () => {
  const f = fixture(); f.ok({ type: 'promoteRequest', requestId: 'a2' });
  f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g1' });
  const dir = mkdtempSync(join(tmpdir(), 'tpv-promote-playing-')); let db: Store<ShowState> | undefined;
  try {
    const path = join(dir, 'show.sqlite'); db = new Store(path); db.save(f.get()); db.close();
    db = new Store(path); const loaded = db.load(); assert.ok(loaded);
    // App startup deliberately restores an interrupted performance paused.
    loaded.playback!.status = 'paused'; f.replace(loaded);
    assert.equal(f.get().promotedRequestId, 'a2');
    f.ok({ type: 'stop' });
    assert.equal(orderedFuture(f.get(), 'singer')[0].id, 'a2');
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('tightening policy during a promoted performance clears the override before stop', () => {
  const f = fixture(); f.ok({ type: 'promoteRequest', requestId: 'a2' });
  f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g1' });
  f.ok({ type: 'setPolicy', policy: { ageRestricted: false, includeVersionIds: [], excludeVersionIds: [] } });
  assert.equal(f.get().promotedRequestId, null);
  assert.equal(f.get().playback?.requestId, 'a2', 'Policy must not silently stop an active song');
  f.ok({ type: 'stop' });
  assert.equal(f.get().promotedRequestId, null);
});

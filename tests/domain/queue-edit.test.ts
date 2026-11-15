import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyCommand, createInitialState, orderedFuture, type Actor, type Command, type ShowState } from '../../src/domain';
import { migrateShowSchema } from '../../src/main/schema-migrations';
import { inspectShowSnapshot } from '../../src/main/show-snapshots';

function fixture(mode: 'fifo' | 'singer' = 'singer') {
  let state = createInitialState('show', 'epoch'), seq = 0;
  const send = (command: Command, actor: Actor = { role: 'host', id: 'host' }, limit = 3) => {
    const result = applyCommand(state, { showId: state.showId, hostEpoch: state.hostEpoch,
      expectedRevision: state.revision, commandId: String(++seq), actor, command },
    { autoApprove: true, rotationMode: mode, maxFutureRequestsPerSinger: limit });
    state = result.state; return result.outcome;
  };
  const ok = (command: Command) => assert.equal(send(command).ok, true);
  for (const id of ['v1', 'v2']) ok({ type: 'addVersion', version: { id, title: id, artist: 'Artist', rating: 'clean' } });
  for (const id of ['a', 'b', 'c']) ok({ type: 'addSinger', singer: { id, name: id } });
  for (const [id, singerId] of [['a1', 'a'], ['a2', 'a'], ['b1', 'b'], ['c1', 'c']])
    ok({ type: 'request', requestId: id, singerId, versionId: 'v1' });
  return { send, ok, get: () => state, replace: (value: ShowState) => { state = value; }, ids: () => orderedFuture(state, mode).map(r => r.id) };
}

test('manual moves override FIFO and fair order while preserving staged and active songs', () => {
  for (const mode of ['fifo', 'singer'] as const) {
    const f = fixture(mode); f.ok({ type: 'stage' });
    const assigned = f.get().requests.map(r => [r.id, r.round, r.order]);
    f.ok({ type: 'moveRequest', requestId: 'c1', beforeRequestId: 'a2' });
    assert.equal(f.ids()[0], 'a1');
    assert.ok(f.ids().indexOf('c1') < f.ids().indexOf('a2'));
    assert.deepEqual(f.get().requests.map(r => [r.id, r.round, r.order]), assigned);
    f.ok({ type: 'release' }); assert.equal(f.ids()[0], 'a1', 'releasing the stage retains its place');
    f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g' });
    f.ok({ type: 'moveRequest', requestId: 'c1', beforeRequestId: null });
    assert.equal(f.get().playback?.generationId, 'g');
    f.ok({ type: 'stop' }); assert.equal(f.ids()[0], 'a1', 'Stop returns the active request to its retained place');
  }
});

test('new requests follow manual order; reset restores scheduler order; finished references are pruned', () => {
  const f = fixture(); f.ok({ type: 'moveRequest', requestId: 'a2', beforeRequestId: 'a1' });
  f.ok({ type: 'request', requestId: 'b2', singerId: 'b', versionId: 'v1' });
  assert.deepEqual(f.ids(), ['a2', 'a1', 'b1', 'c1', 'b2']);
  const saved = JSON.parse(JSON.stringify(f.get())); f.replace(saved);
  assert.deepEqual(f.ids(), ['a2', 'a1', 'b1', 'c1', 'b2']);
  f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g' });
  assert.equal(f.send({ type: 'complete', generationId: 'g' }, { role: 'engine', id: 'engine' }).ok, true);
  assert.equal(f.get().manualQueueOrder?.includes('a2'), false);
  f.ok({ type: 'resetQueueOrder' }); assert.deepEqual(f.ids(), ['a1', 'b1', 'c1', 'b2']);
});

test('only hosts can move or edit; staging cannot be displaced by stale edits or drop targets', () => {
  const f = fixture(); const commands: Command[] = [
    { type: 'moveRequest', requestId: 'c1', beforeRequestId: 'a1' },
    { type: 'editRequest', requestId: 'c1', singerId: 'a', versionId: 'v2' }, { type: 'resetQueueOrder' },
  ];
  for (const role of ['staff', 'singer'] as const) for (const command of commands)
    assert.equal(f.send(command, { role, id: 'a' }).ok, false);
  f.ok({ type: 'stage' });
  for (const command of [
    { type: 'moveRequest', requestId: 'c1', beforeRequestId: 'a1' },
    { type: 'moveRequest', requestId: 'a1', beforeRequestId: null },
  ] as Command[]) assert.equal(f.send(command).ok, false);
  assert.equal(f.get().stagedRequestId, 'a1');
});

test('host can correct a prepared request without displacing its locked slot or starting it', () => {
  const f = fixture(); f.ok({ type: 'stage' });
  f.ok({ type: 'editRequest', requestId: 'a1', singerId: 'b', versionId: 'v2' });
  const request = f.get().requests.find(row => row.id === 'a1')!;
  assert.equal(request.status, 'staged'); assert.equal(request.singerId, 'b'); assert.equal(request.versionId, 'v2');
  assert.equal(f.get().stagedRequestId, 'a1'); assert.equal(f.ids()[0], 'a1'); assert.equal(f.get().playback, null);
  assert.equal(request.round, 2, 'recipient already has a first-round song');
  f.ok({ type: 'start', generationId: 'corrected' });
  assert.equal(f.send({ type: 'editRequest', requestId: 'a1', singerId: 'a', versionId: 'v1' }).ok, false);
  assert.equal(f.get().playback?.generationId, 'corrected');
});

test('request edits retain identity and manual slot but assign the recipient a free round', () => {
  const f = fixture(); f.ok({ type: 'moveRequest', requestId: 'c1', beforeRequestId: 'a1' });
  const ids = f.ids();
  f.ok({ type: 'editRequest', requestId: 'c1', singerId: 'a', versionId: 'v2' });
  const changed = f.get().requests.find(r => r.id === 'c1')!;
  assert.equal(changed.singerId, 'a'); assert.equal(changed.versionId, 'v2'); assert.equal(changed.round, 3);
  assert.deepEqual(f.ids(), ids);
  const oldRound = changed.round, oldOrder = changed.order;
  f.ok({ type: 'editRequest', requestId: 'c1', singerId: 'a', versionId: 'v1' });
  assert.equal(f.get().requests.find(r => r.id === 'c1')!.round, oldRound);
  assert.equal(f.get().requests.find(r => r.id === 'c1')!.order, oldOrder);
  assert.equal(f.get().requests.length, 4); assert.equal(f.get().usedGenerationIds.length, 0);
});

test('edits enforce song policy, recipient limits and valid singer without changing an invalid request', () => {
  const f = fixture();
  const original = f.get().requests.find(r => r.id === 'c1');
  assert.equal(f.send({ type: 'editRequest', requestId: 'c1', singerId: 'a', versionId: 'v2' }, undefined, 2).ok, false);
  assert.equal(f.send({ type: 'editRequest', requestId: 'c1', singerId: 'missing', versionId: 'v2' }).ok, false);
  f.ok({ type: 'setPolicy', policy: { ageRestricted: false, includeVersionIds: null, excludeVersionIds: ['v2'] } });
  assert.equal(f.send({ type: 'editRequest', requestId: 'c1', singerId: 'c', versionId: 'v2' }).ok, false);
  assert.deepEqual(f.get().requests.find(r => r.id === 'c1'), original);
});

test('snapshot validation accepts legacy/manual queues and rejects duplicate, stale and pending references', () => {
  const f = fixture(); const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    const save = (state: ShowState) => db.prepare('INSERT OR REPLACE INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    const legacy = f.get(); delete legacy.manualQueueOrder; save(legacy); assert.equal(inspectShowSnapshot(db).requests, 4);
    f.ok({ type: 'moveRequest', requestId: 'c1', beforeRequestId: 'a1' }); save(f.get()); assert.equal(inspectShowSnapshot(db).requests, 4);
    for (const order of [['missing'], ['a1', 'a1'], [123]]) {
      const bad = JSON.parse(JSON.stringify(f.get())); bad.manualQueueOrder = order; save(bad);
      assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/);
    }
    const bad = JSON.parse(JSON.stringify(f.get())); bad.requests.find((r: { id: string }) => r.id === 'c1').status = 'pending'; save(bad);
    assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/);
  } finally { db.close(); }
});

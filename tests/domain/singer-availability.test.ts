import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, createInitialState, orderedFuture, singerAvailable, type Actor, type Command, type ShowState } from '../../src/domain';
import { DatabaseSync } from 'node:sqlite';
import { migrateShowSchema } from '../../src/main/schema-migrations';
import { inspectShowSnapshot } from '../../src/main/show-snapshots';

function fixture(mode: 'singer' | 'fifo' = 'singer') {
  let state = createInitialState('show', 'epoch'), seq = 0, now = 1000;
  const send = (command: Command, actor: Actor = { role: 'host', id: 'host' }) => {
    const result = applyCommand(state, { showId: state.showId, hostEpoch: state.hostEpoch, commandId: String(++seq),
      expectedRevision: state.revision, actor, command }, { autoApprove: true, rotationMode: mode, maxFutureRequestsPerSinger: 0 }, now);
    state = result.state; return result.outcome;
  };
  const ok = (command: Command) => assert.equal(send(command).ok, true);
  ok({ type: 'addVersion', version: { id: 'v', title: 'Song', artist: 'Artist', rating: 'clean' } });
  for (const id of ['a', 'b', 'c']) ok({ type: 'addSinger', singer: { id, name: id } });
  return { send, ok, get: () => state, tick: (ms: number) => { now += ms; }, time: () => now,
    ids: () => orderedFuture(state, mode, now).map(r => r.id), replace: (value: ShowState) => { state = value; } };
}

test('unavailable singers wait until their persisted deadline then rejoin automatically in FIFO and fair modes', () => {
  for (const mode of ['fifo', 'singer'] as const) {
    const f = fixture(mode);
    f.ok({ type: 'request', requestId: 'a1', singerId: 'a', versionId: 'v' });
    f.ok({ type: 'request', requestId: 'b1', singerId: 'b', versionId: 'v' });
    f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 });
    assert.deepEqual(f.ids(), ['b1', 'a1']);
    f.ok({ type: 'stage' }); assert.equal(f.get().stagedRequestId, 'b1');
    f.tick(59999); assert.equal(singerAvailable(f.get(), 'a', f.time()), false);
    f.replace(JSON.parse(JSON.stringify(f.get()))); // A restart retains the absolute deadline.
    f.tick(1); assert.equal(singerAvailable(f.get(), 'a', f.time()), true);
    assert.deepEqual(f.ids(), ['b1', 'a1'], 'return cannot displace an already staged singer');
    assert.equal(f.get().playback, null, 'expiry does not autoplay');
    f.ok({ type: 'release' }); f.ok({ type: 'stage' }); assert.equal(f.get().stagedRequestId, 'a1');
  }
});

test('away request allowance is one even with an unlimited host setting and existing requests are retained', () => {
  const f = fixture(); f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 60 });
  f.ok({ type: 'request', requestId: 'a1', singerId: 'a', versionId: 'v' });
  const denied = f.send({ type: 'request', requestId: 'a2', singerId: 'a', versionId: 'v' });
  assert.equal(denied.ok, false); if (!denied.ok) assert.match(denied.message, /one upcoming/);
  f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 0 });
  f.ok({ type: 'request', requestId: 'a2', singerId: 'a', versionId: 'v' });
  f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 10 });
  assert.equal(f.get().requests.filter(r => r.singerId === 'a').length, 2);
  assert.equal(f.send({ type: 'request', requestId: 'a3', singerId: 'a', versionId: 'v' }).ok, false);
  f.ok({ type: 'request', requestId: 'b1', singerId: 'b', versionId: 'v' });
  assert.equal(f.send({ type: 'editRequest', requestId: 'b1', singerId: 'a', versionId: 'v' }).ok, false);
});

test('availability accepts only minute increments, an existing singer, and host or authenticated self', () => {
  const f = fixture();
  for (const minutes of [-1, 0.5, 61, NaN, Infinity])
    assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes }).ok, false);
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'missing', minutes: 1 }).ok, false);
  assert.equal(f.send({ type: 'addSinger', singer: { id: 'far', name: 'Future', unavailableUntilMs: f.time() + 3600001 } }).ok, false);
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 }, { role: 'staff', id: 'a' }).ok, false);
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 }, { role: 'singer', id: 'b' }).ok, false);
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 }, { role: 'singer', id: 'a' }).ok, true);
  assert.equal(f.get().singers[0].unavailableUntilMs, f.time() + 60000);
});

test('self cannot release staged/playing turns; host release must be explicitly confirmed; active playback is retained', () => {
  const f = fixture(); f.ok({ type: 'request', requestId: 'a1', singerId: 'a', versionId: 'v' }); f.ok({ type: 'stage' });
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 }, { role: 'singer', id: 'a' }).ok, false);
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 }).ok, false);
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1, releaseStaged: true }, { role: 'singer', id: 'a' }).ok, false);
  f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 1, releaseStaged: true });
  assert.equal(f.get().stagedRequestId, null); assert.equal(f.get().requests[0].status, 'accepted');
  assert.equal(f.send({ type: 'stage' }).ok, false, 'no eligible singer before return');
  f.tick(60000); f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g' });
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 }, { role: 'singer', id: 'a' }).ok, false);
  f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 });
  assert.equal(f.get().playback?.generationId, 'g'); assert.equal(f.get().playback?.status, 'playing');
});

test('snapshot validation accepts legacy deadlines and rejects invalid availability values', () => {
  const f = fixture(); const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db); const save = (state: ShowState) => db.prepare('INSERT OR REPLACE INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    save(f.get()); assert.equal(inspectShowSnapshot(db).singers, 3);
    f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 60 }); save(f.get()); assert.equal(inspectShowSnapshot(db).singers, 3);
    for (const value of [-1, 1.5, '60000']) { const bad = JSON.parse(JSON.stringify(f.get())); bad.singers[0].unavailableUntilMs = value; save(bad); assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/); }
  } finally { db.close(); }
});

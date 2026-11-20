import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, createInitialState, orderedFuture, singerAvailable, type Actor, type Command, type ShowState } from '../../src/domain';
import { DatabaseSync } from 'node:sqlite';
import { migrateShowSchema } from '../../src/main/schema-migrations';
import { inspectShowSnapshot } from '../../src/main/show-snapshots';
import { nextSingerReturnAt, SINGER_ON_HOLD, timedSingerReturnAt } from '../../src/domain/singer-availability';

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

test('self can mark a queued singer unavailable, while active playback is retained', () => {
  const f = fixture(); f.ok({ type: 'request', requestId: 'a1', singerId: 'a', versionId: 'v' }); f.ok({ type: 'stage' });
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1, releaseStaged: true }, { role: 'singer', id: 'a' }).ok, false);
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 }, { role: 'singer', id: 'a' }).ok, true);
  assert.equal(f.get().stagedRequestId, null); assert.equal(f.get().requests[0].status, 'accepted');
  assert.equal(f.send({ type: 'stage' }).ok, false, 'no eligible singer before return');
  f.tick(60000); f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g' });
  assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 }, { role: 'singer', id: 'a' }).ok, false);
  f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 1 });
  assert.equal(f.get().playback?.generationId, 'g'); assert.equal(f.get().playback?.status, 'playing');
});

test('a duet co-singer can hold a queued turn but cannot alter an active performance', () => {
  for (const mode of ['fifo', 'singer'] as const) {
    const f = fixture(mode);
    f.ok({ type: 'editVersion', id: 'v', title: 'Song', artist: 'Artist', isDuet: true });
    f.ok({ type: 'request', requestId: 'duet', singerId: 'a', coSingerId: 'b', versionId: 'v' });
    f.ok({ type: 'request', requestId: 'solo', singerId: 'c', versionId: 'v' });
    f.ok({ type: 'stage' }); assert.equal(f.get().stagedRequestId, 'duet');
    assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'b', minutes: 1 }, { role: 'singer', id: 'b' }).ok, true);
    assert.equal(f.get().stagedRequestId, null); assert.deepEqual(f.ids(), ['solo', 'duet']);
    f.ok({ type: 'stage' }); assert.equal(f.get().stagedRequestId, 'solo');
    f.ok({ type: 'release' }); f.tick(60000); f.ok({ type: 'stage', requestId: 'duet' });
    f.ok({ type: 'start', generationId: 'duet-playing' });
    assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'b', minutes: 1 }, { role: 'singer', id: 'b' }).ok, false);
    assert.equal(f.get().playback?.generationId, 'duet-playing');
  }
});

test('snapshot validation accepts legacy deadlines and rejects invalid availability values', () => {
  const f = fixture(); const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db); const save = (state: ShowState) => db.prepare('INSERT OR REPLACE INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    save(f.get()); assert.equal(inspectShowSnapshot(db).singers, 3);
    f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 60 }); save(f.get()); assert.equal(inspectShowSnapshot(db).singers, 3);
    for (const value of [-1, 1.5, '60000']) { const bad = JSON.parse(JSON.stringify(f.get())); bad.singers[0].unavailableUntilMs = value; save(bad); assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/); }
    f.ok({ type: 'holdSinger', singerId: 'a' }); save(f.get());
    assert.equal(inspectShowSnapshot(db).singers, 3);
    db.exec('PRAGMA user_version = 7;');
    assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/);
  } finally { db.close(); }
});

test('only a host can hold or return a singer and their original prepared duet stays in the queue', () => {
  for (const mode of ['fifo', 'singer'] as const) {
    const f = fixture(mode);
    f.ok({ type: 'editVersion', id: 'v', title: 'Song', artist: 'Artist', isDuet: true });
    f.ok({ type: 'request', requestId: 'duet', singerId: 'a', coSingerId: 'b', versionId: 'v' });
    f.ok({ type: 'request', requestId: 'solo', singerId: 'c', versionId: 'v' });
    f.ok({ type: 'stage' });
    const original = f.get().requests.find(r => r.id === 'duet')!;
    for (const role of ['singer', 'staff', 'engine'] as const)
      assert.equal(f.send({ type: 'holdSinger', singerId: 'b' }, { role, id: 'b' }).ok, false);
    f.ok({ type: 'holdSinger', singerId: 'b' });
    assert.deepEqual(f.get().requests.find(r => r.id === 'duet'), { ...original, status: 'accepted' });
    assert.deepEqual(f.ids(), ['solo', 'duet']);
    assert.equal(f.get().stagedRequestId, null);
    f.ok({ type: 'stage' });
    assert.equal(f.get().stagedRequestId, 'solo');
    f.replace(JSON.parse(JSON.stringify(f.get())));
    f.tick(3_600_000 * 24);
    assert.equal(singerAvailable(f.get(), 'b', f.time()), false);
    assert.equal(singerAvailable(f.get(), 'b', SINGER_ON_HOLD), false);
    assert.equal(f.get().singers.find(s => s.id === 'b')?.unavailableUntilMs, SINGER_ON_HOLD);
    for (const minutes of [0, 5])
      assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'b', minutes }, { role: 'singer', id: 'b' }).ok, false);
    assert.equal(f.send({ type: 'setSingerAvailability', singerId: 'b', minutes: 10 }).ok, false);
    f.ok({ type: 'setSingerAvailability', singerId: 'b', minutes: 0 });
    assert.equal(singerAvailable(f.get(), 'b', f.time()), true);
    assert.equal(f.get().stagedRequestId, 'solo', 'return respects the already prepared turn');
    assert.equal(f.get().playback, null);
    f.ok({ type: 'release' }); f.ok({ type: 'stage' });
    assert.equal(f.get().stagedRequestId, 'duet');
    f.ok({ type: 'start', generationId: 'g' });
    f.ok({ type: 'holdSinger', singerId: 'b' });
    assert.deepEqual(f.get().playback, { requestId: 'duet', generationId: 'g', status: 'playing' });
  }
});

test('held requests remain owed without keeping earlier fair rounds open indefinitely', () => {
  const f = fixture();
  f.ok({ type: 'request', requestId: 'owed', singerId: 'a', versionId: 'v' });
  f.ok({ type: 'request', requestId: 'b1', singerId: 'b', versionId: 'v' });
  f.ok({ type: 'request', requestId: 'b2', singerId: 'b', versionId: 'v' });
  f.ok({ type: 'holdSinger', singerId: 'a' });
  assert.equal(f.send({ type: 'request', requestId: 'owed2', singerId: 'a', versionId: 'v' }).ok, false);
  f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g1' });
  assert.equal(f.get().finalTurnBegun, true);
  assert.equal(f.send({ type: 'complete', generationId: 'g1' }, { role: 'engine', id: 'player' }).ok, true);
  f.ok({ type: 'stage' }); f.ok({ type: 'start', generationId: 'g2' });
  assert.equal(f.get().currentRound, 2);
  f.ok({ type: 'request', requestId: 'c1', singerId: 'c', versionId: 'v' });
  assert.equal(f.get().requests.find(r => r.id === 'c1')?.round, 3);
  f.ok({ type: 'setSingerAvailability', singerId: 'a', minutes: 0 });
  assert.deepEqual(f.ids(), ['owed', 'c1']);
  assert.equal(f.get().requests.find(r => r.id === 'owed')?.round, 1);
  assert.equal(f.get().playback?.requestId, 'b2');
});

test('availability refresh only schedules future timed returns', () => {
  const singers = [{ unavailableUntilMs: SINGER_ON_HOLD }, { unavailableUntilMs: 4000 }, { unavailableUntilMs: 6000 }, {}];
  assert.equal(timedSingerReturnAt(SINGER_ON_HOLD), 0);
  assert.equal(nextSingerReturnAt(singers, 3999), 4000);
  assert.equal(nextSingerReturnAt(singers, 4000), 6000);
  assert.equal(nextSingerReturnAt(singers, 6000), null);
  assert.equal(nextSingerReturnAt(singers, 6001), null);
});

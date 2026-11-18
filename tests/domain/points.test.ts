import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPointsEvent, newPointsLedger, type PointsEvent } from '../../src/domain/points';

function fixture() {
  let ledger = newPointsLedger('show');
  const options = { pointsEnabled: true, applauseEnabled: true };
  function send(event: PointsEvent) { const result = applyPointsEvent(ledger, event, options); ledger = result.ledger; return result; }
  function singer(id: string) { return ledger.accounts.find(item => item.singerId === id); }
  return { send, singer, options, current: () => ledger };
}

test('four distinct applauders give the performer 70 points before the full-room bonus', () => {
  const f = fixture();
  f.send({ eventId: 'start', type: 'start', generationId: 'song', performers: ['singer'], participants: ['singer', 'jon', 'jane', 'mark', 'other'] });
  f.send({ eventId: 'a1', type: 'applause', generationId: 'song', actor: { role: 'singer', singerId: 'jon' } });
  f.send({ eventId: 'a2', type: 'applause', generationId: 'song', actor: { role: 'singer', singerId: 'jane' } });
  f.send({ eventId: 'a3', type: 'applause', generationId: 'song', actor: { role: 'singer', singerId: 'mark' } });
  f.send({ eventId: 'a4', type: 'applause', generationId: 'song', actor: { role: 'host' } });
  assert.equal(f.singer('singer')?.points, 70);
  f.send({ eventId: 'finish', type: 'finish', generationId: 'song', completed: true });
  assert.equal(f.singer('singer')?.points, 70);
  assert.equal(f.singer('singer')?.credits, 4);
  assert.equal(f.singer('jon')?.points, 8);
  assert.equal(f.singer('jon')?.credits, 2);
});

test('room bonus uses other singers frozen at start, excludes host and awards each duet performer', () => {
  const f = fixture();
  f.send({ eventId: 'start', type: 'start', generationId: 'song', performers: ['lead', 'duet'], participants: ['lead', 'duet', 'audience'] });
  f.send({ eventId: 'late', type: 'join', singerId: 'late' });
  f.send({ eventId: 'clap', type: 'applause', actor: { role: 'singer', singerId: 'audience' }, generationId: 'song' });
  assert.equal(f.singer('lead')?.points, 60);
  assert.equal(f.singer('duet')?.points, 60);
  f.send({ eventId: 'finish', type: 'finish', generationId: 'song', completed: true });
  assert.equal(f.singer('lead')?.points, 60);
  assert.equal(f.singer('duet')?.points, 60);
  assert.equal(f.singer('lead')?.credits, 4);
  const alone = fixture();
  alone.send({ eventId: 'start', type: 'start', generationId: 'song', performers: ['lead'], participants: ['lead'] });
  alone.send({ eventId: 'clap', type: 'applause', actor: { role: 'host' }, generationId: 'song' });
  alone.send({ eventId: 'finish', type: 'finish', generationId: 'song', completed: true });
  assert.equal(alone.singer('lead')?.points, 10);
});

test('giving applause uses credits and scores 8, 4 and 2 per other performance', () => {
  const f = fixture();
  f.send({ eventId: 's', type: 'start', generationId: 'g', performers: ['lead'], participants: ['lead', 'giver'] });
  for (let n = 1; n <= 3; n++) f.send({ eventId: `a${n}`, type: 'applause', actor: { role: 'singer', singerId: 'giver' }, generationId: 'g' });
  assert.equal(f.singer('giver')?.points, 14);
  assert.equal(f.singer('giver')?.credits, 0);
  const before = f.current();
  assert.throws(() => f.send({ eventId: 'a4', type: 'applause', actor: { role: 'singer', singerId: 'giver' }, generationId: 'g' }), /credits/);
  assert.strictEqual(f.current(), before);
  f.send({ eventId: 'host', type: 'applause', actor: { role: 'host' }, generationId: 'g' });
});

test('completed performances replenish credits up to five and skipped turns do not', () => {
  const f = fixture();
  for (let n = 0; n < 4; n++) {
    f.send({ eventId: `s${n}`, type: 'start', generationId: `g${n}`, performers: ['lead'], participants: ['lead'] });
    f.send({ eventId: `f${n}`, type: 'finish', generationId: `g${n}`, completed: n !== 0 });
    assert.equal(f.singer('lead')?.credits, Math.min(5, 3 + n));
  }
});

test('queue, duet, suggestion and photo awards are idempotent', () => {
  const f = fixture();
  const event = { eventId: 'queue', type: 'queue', singerId: 'lead', sungEarlierThisShow: false, everQueuedOrSung: false, coSingerId: 'duet' } as const;
  f.send(event);
  assert.equal(f.singer('lead')?.points, 50);
  assert.equal(f.singer('duet')?.points, 14);
  assert.equal(f.send(event).applied, false);
  assert.throws(() => f.send({ ...event, singerId: 'another' }), /already in use/);
  f.send({ eventId: 'repeat', type: 'queue', singerId: 'lead', sungEarlierThisShow: true, everQueuedOrSung: true });
  f.send({ eventId: 'suggest', type: 'suggestion', singerId: 'lead' });
  f.send({ eventId: 'photo', type: 'photo', singerId: 'lead' });
  assert.equal(f.singer('lead')?.points, 96);
});

test('disabling points preserves credit use while disabling applause refuses triggers', () => {
  const f = fixture();
  f.send({ eventId: 's', type: 'start', generationId: 'g', performers: ['lead'], participants: ['lead', 'giver'] });
  f.options.pointsEnabled = false;
  f.send({ eventId: 'a', type: 'applause', generationId: 'g', actor: { role: 'singer', singerId: 'giver' } });
  assert.equal(f.singer('lead')?.points, 0);
  assert.equal(f.singer('giver')?.credits, 2);
  f.options.applauseEnabled = false;
  assert.throws(() => f.send({ eventId: 'b', type: 'applause', generationId: 'g', actor: { role: 'host' } }), /turned off/);
});


test('all-listener bonus is immediate, idempotent and remains after a duet is skipped', () => {
  const f = fixture();
  f.send({ eventId: 'start', type: 'start', generationId: 'g', performers: ['lead', 'partner'], participants: ['lead', 'partner', 'alice', 'bob'] });
  f.send({ eventId: 'alice', type: 'applause', generationId: 'g', actor: { role: 'singer', singerId: 'alice' } });
  assert.equal(f.singer('lead')?.points, 10);
  const clap = { eventId: 'bob', type: 'applause', generationId: 'g', actor: { role: 'singer', singerId: 'bob' } } as const;
  f.send(clap);
  assert.equal(f.singer('lead')?.points, 80); // 10 + 15 + 5 distinct + 50 room
  assert.equal(f.singer('partner')?.points, 80);
  assert.equal(f.send(clap).applied, false);
  f.send({ eventId: 'host', type: 'applause', generationId: 'g', actor: { role: 'host' } });
  assert.equal(f.singer('lead')?.points, 110); // +25 and +5 distinct; no second room bonus
  f.send({ eventId: 'skip', type: 'finish', generationId: 'g', completed: false });
  assert.equal(f.singer('lead')?.points, 110);
  assert.equal(f.singer('partner')?.points, 110);
  assert.equal(f.singer('lead')?.credits, 3);
});

test('legacy in-progress ledgers recover a missing room bonus without requiring an extra clap', () => {
  const f = fixture();
  f.send({ eventId: 'start', type: 'start', generationId: 'g', performers: ['lead'], participants: ['lead', 'listener'] });
  f.send({ eventId: 'clap', type: 'applause', generationId: 'g', actor: { role: 'singer', singerId: 'listener' } });
  const legacy = f.current();
  delete legacy.performances[0].allListenerBonusAwarded;
  legacy.accounts.find(item => item.singerId === 'lead')!.points -= 50;
  f.send({ eventId: 'skip', type: 'finish', generationId: 'g', completed: false });
  assert.equal(f.singer('lead')?.points, 60);
});

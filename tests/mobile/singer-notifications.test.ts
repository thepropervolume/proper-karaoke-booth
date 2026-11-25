import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GuestRotationEntry, GuestSongFulfillment } from '../../src/domain/guest-stage';
import type { DiscoveredRoom } from '../../src/mobile/discovery';
import { parseSingerNoticePreferences, SingerNoticeTracker, type SingerNoticePreferences } from '../../src/mobile/singer-notifications';
import type { GuestSnapshot } from '../../src/remote/client';

const preferences: SingerNoticePreferences = { enabled: true, turn: 2, ready: true, nearby: true };
const ownRow = (position: number, status: GuestRotationEntry['status'] = 'queued'): GuestRotationEntry =>
  ({ title: 'My Song', artist: 'Artist', singer: 'Singer', position, status, ownRequestId: 'my-request' });
const snapshot = (revision: number, upcoming?: GuestRotationEntry, fulfilledSuggestions?: GuestSongFulfillment[]): GuestSnapshot =>
  ({ showId: 'show-00001', hostEpoch: 'epoch-0001', singerId: 'singer-001', singerName: 'Singer',
    revision, serverNowMs: revision * 1000, catalog: [], catalogNextOffset: null, requests: [],
    stage: { nowPlaying: null, queue: upcoming ? [upcoming] : [], queueTruncated: false, fulfilledSuggestions } });

test('turn notices use each configured position and do not repeat after a reordering', () => {
  for (const turn of [1, 2, 3] as const) {
    const tracker = new SingerNoticeTracker();
    const observe = (value: GuestSnapshot) => tracker.observe({ snapshot: value, joined: true, nearby: [], active: true }, { ...preferences, turn });
    assert.deepEqual(observe(snapshot(0, ownRow(turn + 2))), []);
    assert.deepEqual(observe(snapshot(1, { ...ownRow(turn + 1), ownRequestId: undefined })), []);
    assert.deepEqual(observe(snapshot(2, ownRow(turn + 1))), []);
    assert.equal(observe(snapshot(3, ownRow(turn)))[0]?.title, turn === 1 ? 'You’re Up Next' : 'Your Turn is Coming Up');
    assert.deepEqual(observe(snapshot(4, ownRow(turn + 5))), []);
    assert.deepEqual(observe(snapshot(5, ownRow(turn))), []);
  }
});

test('room notices ignore stale snapshots, prior fulfillments, and repeated preparation', () => {
  const tracker = new SingerNoticeTracker();
  const observe = (value: GuestSnapshot) => tracker.observe({ snapshot: value, joined: true, nearby: [], active: true }, preferences);
  const previous = { id: 'existing', title: 'Old Request' };
  const fresh = { id: 'new', title: 'My Suggestion' };
  assert.deepEqual(observe(snapshot(5, ownRow(4, 'preparing'), [previous])), []);
  assert.deepEqual(observe(snapshot(4, ownRow(1), [fresh])), []);
  assert.deepEqual(observe(snapshot(6, ownRow(4), [previous, fresh])),
    [{ title: 'Song Request Available', body: '2 of your requests are available.' }]);
  assert.deepEqual(observe(snapshot(7, ownRow(4, 'preparing'), [fresh])), []);
  assert.deepEqual(observe(snapshot(8, ownRow(4), [fresh])), []);
  assert.equal(observe(snapshot(9, ownRow(1), [fresh]))[0]?.title, 'You’re Up Next');
  const nextRoom = { ...snapshot(0, ownRow(1), [fresh]), hostEpoch: 'different' };
  assert.deepEqual(observe(nextRoom), []);
});

test('nearby alerts require fresh visible Bonjour results, permission opt-in, and a new room instance', () => {
  const tracker = new SingerNoticeTracker();
  const room = (instance: string, method: DiscoveredRoom['method'] = 'bonjour'): DiscoveredRoom =>
    ({ slug: 'some-room', name: 'Some Room', instance, method });
  const observe = (nearby: DiscoveredRoom[], active = true, enabled = true) =>
    tracker.observe({ joined: false, nearby, active }, { ...preferences, enabled });
  assert.deepEqual(observe([]), []);
  assert.deepEqual(observe([room('server', 'same-egress')]), []);
  assert.deepEqual(observe([room('live')]),
    [{ title: 'Karaoke Room Nearby', body: 'Some Room is open.' }]);
  assert.deepEqual(observe([room('live')]), []);
  assert.deepEqual(observe([room('hidden')], false), []);
  assert.deepEqual(observe([room('hidden')]), []);
  assert.deepEqual(observe([room('disabled')], true, false), []);
  assert.deepEqual(observe([room('disabled')]), []);
});

test('invalid notification preferences cannot enable device alerts', () => {
  assert.equal(parseSingerNoticePreferences('{broken').enabled, false);
  assert.deepEqual(parseSingerNoticePreferences('{"enabled":"yes","turn":9,"nearby":true,"ready":false}'),
    { enabled: false, turn: 2, nearby: true, ready: false });
  assert.deepEqual(parseSingerNoticePreferences('{"enabled":true,"turn":0,"nearby":true,"ready":false}'),
    { enabled: true, turn: 0, nearby: true, ready: false });
});
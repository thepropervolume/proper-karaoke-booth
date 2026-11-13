import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioOutputRouter } from '../../src/display/audio-output';

test('routes a selected output before unmuting and rejects unavailable outputs', async () => {
  const router = new AudioOutputRouter(async () => [{ kind: 'audiooutput', deviceId: 'speaker' }]);
  const calls: string[] = [];
  const player = { muted: false, pause() {}, async setSinkId(id: string) { assert.equal(this.muted, true); calls.push(id); } };
  assert.equal(await router.prepare(player, 'speaker', () => true), true);
  assert.deepEqual(calls, ['speaker']); assert.equal(player.muted, false);
  await assert.rejects(() => router.prepare(player, 'missing', () => true), /unavailable/);
  assert.equal(player.muted, true);
});

test('device change or newer playback prevents a delayed route from unmuting', async () => {
  let finish!: () => void; let pauses = 0;
  const router = new AudioOutputRouter(async () => [{ kind: 'audiooutput', deviceId: 'speaker' }]);
  const player = { muted: false, pause() { pauses++; }, setSinkId: () => new Promise<void>(resolve => { finish = resolve; }) };
  const pending = router.prepare(player, 'speaker', () => true);
  await new Promise(resolve => setImmediate(resolve));
  router.invalidate(player); finish();
  assert.equal(await pending, false); assert.equal(player.muted, true); assert.equal(pauses, 1);
});

test('failed device selection leaves the player muted', async () => {
  const router = new AudioOutputRouter(async () => [{ kind: 'audiooutput', deviceId: 'speaker' }]);
  const player = { muted: false, pause() {}, async setSinkId() { throw new Error('permission denied'); } };
  await assert.rejects(() => router.prepare(player, 'speaker', () => true), /permission denied/);
  assert.equal(player.muted, true);
});

test('a superseded player remains muted even if output routing succeeds', async () => {
  const router = new AudioOutputRouter(async () => []);
  const player = { muted: false, pause() {}, async setSinkId() {} };
  assert.equal(await router.prepare(player, '', () => false), false);
  assert.equal(player.muted, true);
});

test('a slow older routing call cannot move audio away from a newer output', async () => {
  let finishOld!: () => void; let output = ''; const calls: string[] = [];
  const router = new AudioOutputRouter(async () => [{ kind: 'audiooutput', deviceId: 'old' }, { kind: 'audiooutput', deviceId: 'new' }]);
  const player = { muted: false, pause() {}, async setSinkId(id: string) {
    calls.push(id);
    if (id === 'old') await new Promise<void>(resolve => { finishOld = resolve; });
    output = id;
  } };
  const old = router.prepare(player, 'old', () => true);
  await new Promise(resolve => setImmediate(resolve));
  const newer = router.prepare(player, 'new', () => true);
  await new Promise(resolve => setImmediate(resolve));
  finishOld();
  assert.equal(await old, false);
  assert.equal(await newer, true);
  assert.deepEqual(calls, ['old', 'new']);
  assert.equal(output, 'new');
  assert.equal(player.muted, false);
});

test('a stale device enumeration cannot change the current output', async () => {
  let finishList!: (value: { kind: string; deviceId: string }[]) => void; let lists = 0;
  const devices = [{ kind: 'audiooutput', deviceId: 'old' }, { kind: 'audiooutput', deviceId: 'new' }];
  const router = new AudioOutputRouter(() => ++lists === 1 ? new Promise(resolve => { finishList = resolve; }) : Promise.resolve(devices));
  const calls: string[] = [];
  const player = { muted: false, pause() {}, async setSinkId(id: string) { calls.push(id); } };
  const old = router.prepare(player, 'old', () => true);
  assert.equal(await router.prepare(player, 'new', () => true), true);
  finishList(devices);
  assert.equal(await old, false);
  assert.deepEqual(calls, ['new']);
  assert.equal(player.muted, false);
});

test('a failed earlier routing call does not block a newer selection', async () => {
  let failOld!: (error: Error) => void; let output = '';
  const router = new AudioOutputRouter(async () => [{ kind: 'audiooutput', deviceId: 'old' }, { kind: 'audiooutput', deviceId: 'new' }]);
  const player = { muted: false, pause() {}, async setSinkId(id: string) {
    if (id === 'old') await new Promise<void>((_, reject) => { failOld = reject; });
    output = id;
  } };
  const old = router.prepare(player, 'old', () => true);
  await new Promise(resolve => setImmediate(resolve));
  const newer = router.prepare(player, 'new', () => true);
  failOld(new Error('device disappeared'));
  await assert.rejects(old, /device disappeared/);
  assert.equal(await newer, true);
  assert.equal(output, 'new');
  assert.equal(player.muted, false);
});

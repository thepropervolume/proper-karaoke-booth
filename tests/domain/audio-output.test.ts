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

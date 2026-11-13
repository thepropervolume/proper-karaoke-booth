import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { builtInBumperTracks } from '../../src/main/bumper-builtins';
import { BumperDisplayOutput, type BumperDisplayRequest } from '../../src/main/bumper-display-output';
import { BumperController } from '../../src/main/bumper-controller';
import { createBumperPlayer } from '../../src/display/bumper-player';

test('three original generated WAVs are installed without overwriting existing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-builtins-'));
  try {
    const tracks = builtInBumperTracks(dir);
    assert.equal(tracks.length, 3);
    assert.equal(new Set(tracks.map(t => t.id)).size, 3);
    for (const track of tracks) {
      const bytes = readFileSync(track.path);
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    }
    assert.deepEqual(builtInBumperTracks(dir), tracks);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('explicit sink and a stop acknowledgement are required before karaoke', async () => {
  const messages: BumperDisplayRequest[] = [];
  let sink = '';
  const output = new BumperDisplayOutput(message => messages.push(message), () => .5, () => sink, 40);
  output.displayReady();
  await assert.rejects(output.start({ id: 'x', name: 'X', path: '/x' }, 'g'), /explicit audio output/);
  sink = 'device-id';
  const controller = new BumperController(output, () => [{ id: 'x', name: 'X', path: '/x' }]);
  await controller.setOutputAvailable(true);
  const started = controller.start('x');
  await new Promise(resolve => setTimeout(resolve, 0));
  const start = messages.shift()!;
  assert.equal(start.action, 'start');
  output.acknowledge({ id: start.id, ok: true });
  assert.equal(await started, true);
  await assert.rejects(controller.karaokeStarting(), /did not confirm/);
  assert.equal(controller.getState().status, 'playing');
  const retry = controller.karaokeStarting();
  await new Promise(resolve => setTimeout(resolve, 0));
  const oldStop = messages.shift()!;
  const newStop = messages.shift()!;
  output.acknowledge({ id: oldStop.id, ok: true }); // late acknowledgement cannot satisfy the new request
  output.acknowledge({ id: newStop.id, ok: true });
  await retry;
  assert.equal(controller.getState().status, 'stopped');
});

test('renderer destruction rejects a start and proves pending stop silent', async () => {
  const messages: BumperDisplayRequest[] = [];
  const output = new BumperDisplayOutput(message => messages.push(message), () => .5, () => 'device', 100);
  output.displayReady();
  const stopped = output.stop();
  output.displayDestroyed();
  await stopped;
  output.displayReady();
  const started = output.start({ id: 'x', name: 'X', path: '/x' }, 'g');
  output.displayDestroyed();
  await assert.rejects(started, /display closed/);
});

test('a stop during sink selection cancels start before it can play and acknowledges silence', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  let finishSink!: () => void;
  const sink = new Promise<void>(resolve => { finishSink = resolve; });
  let plays = 0, muted = false;
  class FakeAudio {
    src = ''; volume = 1;
    get muted() { return muted; } set muted(value: boolean) { muted = value; }
    addEventListener() {}
    pause() {} removeAttribute() {} load() {}
    setSinkId() { return sink; }
    play() { plays++; return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'Audio', { value: FakeAudio, configurable: true });
  try {
    const acknowledgements: { id: string; ok: boolean }[] = [];
    const player = createBumperPlayer(value => acknowledgements.push(value), () => {});
    player.handle({ id: 'start', action: 'start', generation: 'g', src: 'tpv-media://bumper/g', volume: .5, deviceId: 'device' });
    await new Promise(resolve => setTimeout(resolve, 0));
    player.handle({ id: 'stop', action: 'stop' });
    finishSink();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(plays, 0);
    assert.equal(muted, true);
    assert.deepEqual(acknowledgements.map(({ id, ok }) => ({ id, ok })), [{ id: 'start', ok: false }, { id: 'stop', ok: true }]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'Audio', original);
    else Reflect.deleteProperty(globalThis, 'Audio');
  }
});


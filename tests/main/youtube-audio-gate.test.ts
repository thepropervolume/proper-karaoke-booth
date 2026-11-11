import { strict as assert } from 'node:assert';
import test from 'node:test';
import { YouTubeAudioGate } from '../../src/main/youtube-audio-gate';

const idle = { playbackActive: false, playbackTransition: false, bumperActive: false };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('a pending bumper start reserves audio before its first await', async () => {
  const gate = new YouTubeAudioGate(() => false);
  const wait = deferred();
  const start = gate.startBumper(() => wait.promise);
  assert.equal(gate.bumperStartPending(), true);
  assert.equal(gate.canOpenPreview(idle), false);
  await assert.rejects(gate.startBumper(async () => {}), /unavailable/);
  wait.resolve(); await start;
  assert.equal(gate.bumperStartPending(), false);
  assert.equal(gate.canOpenPreview(idle), true);
  assert.equal(gate.canOpenPreview({ ...idle, bumperActive: true }), false);
  await assert.rejects(gate.startBumper(async () => { throw new Error('output failed'); }), /output failed/);
  assert.equal(gate.canOpenPreview(idle), true, 'failure must release the reservation');
});

test('an opening or active preview blocks song and bumper starts', async () => {
  let previewActive = false;
  const gate = new YouTubeAudioGate(() => previewActive);
  const wait = deferred();
  const open = async () => {
    assert.equal(gate.canOpenPreview(idle), true);
    previewActive = true; // Real player reserves synchronously before opening its listener.
    await wait.promise;
  };
  const opening = open();
  assert.equal(gate.playbackBlocked(), true);
  let started = false;
  await assert.rejects(gate.startBumper(async () => { started = true; }), /unavailable/);
  assert.equal(started, false);
  wait.resolve(); await opening;
  assert.equal(gate.playbackBlocked(), true);
  previewActive = false;
  assert.equal(gate.playbackBlocked(), false);
  assert.equal(gate.canOpenPreview({ ...idle, playbackActive: true }), false);
  assert.equal(gate.canOpenPreview({ ...idle, playbackTransition: true }), false);
});

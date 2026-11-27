import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { builtInBumperTracks } from '../../src/main/bumper-builtins';
import { BumperDisplayOutput, type BumperDisplayRequest } from '../../src/main/bumper-display-output';
import { BumperController } from '../../src/main/bumper-controller';
import { createBumperPlayer } from '../../src/display/bumper-player';
import { serveBumper } from '../../src/main/bumper-media';

test('Zen is the default built-in and the three original alternatives generate distinct waveforms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-builtins-'));
  try {
    const old = join(dir, 'builtin-ambient-v1.wav');
    writeFileSync(old, 'keep existing file');
    const zenPath = join(import.meta.dirname, '../../assets/audio/bumpers/Zen.ogg');
    const tracks = builtInBumperTracks(dir, zenPath);
    assert.equal(tracks.length, 4);
    assert.equal(new Set(tracks.map(t => t.id)).size, 4);
    assert.equal(tracks[0].id, 'builtin-zen');
    const hashes = new Set<string>();
    for (const track of tracks.slice(1)) {
      const bytes = readFileSync(track.path);
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
    }
    const zen = readFileSync(tracks[0].path);
    assert.equal(createHash('sha256').update(zen).digest('hex'), 'e64206946fceefe2f4a640ae7afe7911041f45fcd01b11b60275180cf1006250');
    const response = await serveBumper(new Request('tpv-media://bumper/demo', { headers: { Range: 'bytes=0-3' } }),
      { generation: 'demo', trackId: 'builtin-zen', status: 'playing' }, tracks);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Type'), 'audio/ogg');
    assert.equal(await response.text(), 'OggS');
    assert.equal(hashes.size, 3);
    assert.equal(readFileSync(old, 'utf8'), 'keep existing file');
    assert.deepEqual(builtInBumperTracks(dir, zenPath), tracks);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('preview switches distinct bumper tracks only after the previous track acknowledges silence', async () => {
  const calls: string[] = [];
  let confirmSilence!: () => void;
  const controller = new BumperController({
    async start(track) { calls.push(track.id); },
    async stop() { calls.push('stop'); await new Promise<void>(resolve => { confirmSilence = resolve; }); },
  }, () => [{ id: 'zen', name: 'Zen', path: '/zen' }, { id: 'keys', name: 'Keys', path: '/keys' }]);
  await controller.setOutputAvailable(true);
  assert.equal(await controller.start('zen'), true);
  assert.equal(await controller.start('keys'), true);
  assert.deepEqual(calls, ['zen']);
  const switched = controller.start('keys', true);
  await Promise.resolve();
  assert.deepEqual(calls, ['zen', 'stop']);
  confirmSilence();
  assert.equal(await switched, true);
  assert.deepEqual(calls, ['zen', 'stop', 'keys']);
  assert.equal(controller.getState().trackId, 'keys');
});

test('the default sink is allowed, and a stop acknowledgement is required before karaoke', async () => {
  const messages: BumperDisplayRequest[] = [];
  let sink = '';
  const output = new BumperDisplayOutput(message => messages.push(message), () => .5, () => sink, 40);
  output.displayReady();
  const defaultStart = output.start({ id: 'x', name: 'X', path: '/x' }, 'g');
  const initial = messages.shift()!;
  assert.equal(initial.action, 'start');
  if (initial.action === 'start') { assert.equal(initial.deviceId, ''); assert.equal(initial.fadeMs, 1000); }
  output.acknowledge({ id: initial.id, ok: true }); await defaultStart;
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


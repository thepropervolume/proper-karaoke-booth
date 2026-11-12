import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AutomaticBumper } from '../../src/main/automatic-bumper';
import { BumperController } from '../../src/main/bumper-controller';

const tracks = [{ id: 'builtin-ambient', name: 'Ambient', path: '/fixture.wav' }];

test('automatic bumper requires explicit opt-in and the matching silence acknowledgement', async () => {
  let enabled = false, starts = 0;
  const automation = new AutomaticBumper(() => enabled, async valid => { assert.equal(valid(), true); starts++; return true; });
  assert.equal(automation.arm('song-1'), false);
  enabled = true;
  assert.equal(automation.arm('song-1'), true);
  assert.equal(await automation.acknowledge('old-song'), false); assert.equal(starts, 0);
  assert.equal(await automation.acknowledge('song-1'), true); assert.equal(starts, 1);
  assert.equal(await automation.acknowledge('song-1'), false); assert.equal(starts, 1);
  automation.close();
});

test('a completed performance starts bumper after silence; next karaoke waits for bumper stop', async () => {
  const actions: string[] = [];
  const controller = new BumperController({ start: async () => { actions.push('bumper-start'); }, stop: async () => { actions.push('bumper-stop'); } }, () => tracks);
  await controller.setOutputAvailable(true); await controller.karaokeStarting();
  controller.karaokeEnded();
  const automation = new AutomaticBumper(() => true, async valid => {
    if (!valid()) return false;
    const started = await controller.start('builtin-ambient');
    if (started && !valid()) await controller.stop();
    return started && valid();
  });
  automation.arm('song-1'); assert.equal(actions.length, 0);
  assert.equal(await automation.acknowledge('song-1'), true); assert.deepEqual(actions, ['bumper-start']);
  automation.cancel(); await controller.karaokeStarting(); actions.push('karaoke-start');
  assert.deepEqual(actions, ['bumper-start', 'bumper-stop', 'karaoke-start']);
  await controller.close(); automation.close();
});

test('output loss, opt-out or cancellation before acknowledgement cannot start bumper', async () => {
  let ready = true, starts = 0;
  const automation = new AutomaticBumper(() => ready, async () => { starts++; return true; });
  automation.arm('song-1'); ready = false;
  assert.equal(await automation.acknowledge('song-1'), false);
  ready = true; assert.equal(starts, 0, 'Output recovery alone must not start anything.');
  automation.arm('song-2'); automation.cancel();
  assert.equal(await automation.acknowledge('song-2'), false); assert.equal(starts, 0);
  automation.close();
});

test('cancelling while a delayed bumper start is in flight requires it to stop before karaoke', async () => {
  let resume!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const inStart = new Promise<void>(resolve => { entered = resolve; });
  const actions: string[] = [];
  const controller = new BumperController({ start: async () => { actions.push('begin'); entered(); await gate; actions.push('started'); }, stop: async () => { actions.push('stopped'); } }, () => tracks);
  await controller.setOutputAvailable(true);
  const automation = new AutomaticBumper(() => true, async valid => {
    if (!valid()) return false;
    const started = await controller.start();
    if (started && !valid()) await controller.stop();
    return started && valid();
  });
  automation.arm('song-1'); const pending = automation.acknowledge('song-1'); await inStart;
  automation.cancel(); const karaoke = controller.karaokeStarting();
  resume(); assert.equal(await pending, false); await karaoke; actions.push('karaoke-start');
  assert.deepEqual(actions, ['begin', 'started', 'stopped', 'karaoke-start']);
  await controller.close(); automation.close();
});

test('missing silence acknowledgement times out without starting audio', async () => {
  let starts = 0; const errors: string[] = [];
  const automation = new AutomaticBumper(() => true, async () => { starts++; return true; }, value => errors.push(value), 5);
  automation.arm('song-1'); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(starts, 0); assert.match(errors[0], /did not confirm silence/);
  assert.equal(await automation.acknowledge('song-1'), false); automation.close();
});

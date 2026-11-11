import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaybackTimeline } from '../../src/main/playback-timeline';
import { formatPlaybackTime } from '../../src/domain/playback-timeline';

function fixture(seek = async (_generation: string, position: number) => position) {
  const checkpoints: { generation: string; position: number }[] = [];
  let published = 0;
  const timeline = new PlaybackTimeline(seek, (generation, position) => checkpoints.push({ generation, position }), () => { published++; });
  timeline.sync('one');
  timeline.report('one', { position: 12, duration: 180, seekable: true });
  return { timeline, checkpoints, published: () => published };
}
test('only current generation finite telemetry enables and updates the timeline', () => {
  const { timeline } = fixture();
  assert.equal(timeline.report('old', { position: 40, duration: 80, seekable: true }), false);
  assert.equal(timeline.report('one', { position: NaN, duration: 80, seekable: true }), false);
  assert.equal(timeline.report('one', { position: 40, duration: Infinity, seekable: true }), false);
  assert.equal(timeline.report('one', { position: -1, duration: 80, seekable: true }), false);
  assert.equal(timeline.snapshot().position, 12);
  timeline.sync('two', 26);
  assert.deepEqual(timeline.snapshot(), { generation: 'two', position: 26, duration: 0, seekable: false, seeking: false });
});
test('seek is generation bound, finite, bounded, and checkpoints the actual acknowledgement', async () => {
  const { timeline, checkpoints, published } = fixture(async (_generation, target) => target + 0.01);
  for (const input of [null, [], { generation: 'old', position: 40 }, { generation: 'one', position: NaN }, { generation: 'one', position: -1 }, { generation: 'one', position: 181 }]) {
    assert.equal((await timeline.seek(input)).ok, false);
  }
  assert.equal(checkpoints.length, 0);
  assert.deepEqual(await timeline.seek({ generation: 'one', position: 40 }), { ok: true });
  assert.deepEqual(checkpoints, [{ generation: 'one', position: 40.01 }]);
  assert.equal(published(), 2);
});
test('concurrent seeks and telemetry cannot overwrite a pending seek', async () => {
  let finish!: (value: number) => void;
  const { timeline, checkpoints } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = timeline.seek({ generation: 'one', position: 70 });
  assert.equal(timeline.snapshot().seeking, true);
  assert.equal((await timeline.seek({ generation: 'one', position: 80 })).ok, false);
  assert.equal(timeline.report('one', { position: 10, duration: 180, seekable: true }), false);
  finish(70); assert.equal((await pending).ok, true);
  assert.equal(timeline.snapshot().position, 70);
  assert.deepEqual(checkpoints, [{ generation: 'one', position: 70 }]);
});
test('a replaced generation cannot receive an old seek acknowledgement or checkpoint', async () => {
  let finish!: (value: number) => void;
  const { timeline, checkpoints } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = timeline.seek({ generation: 'one', position: 70 });
  timeline.sync('two'); finish(70);
  assert.equal((await pending).ok, false);
  assert.equal(timeline.snapshot().generation, 'two');
  assert.equal(checkpoints.length, 0);
});
test('failed or nonfinite media seeks remain retryable and never checkpoint', async () => {
  let reject = true;
  const { timeline, checkpoints } = fixture(async (_generation, position) => { if (reject) throw new Error('decoder'); return position; });
  assert.equal((await timeline.seek({ generation: 'one', position: 60 })).ok, false);
  assert.equal(timeline.snapshot().seeking, false);
  assert.equal(checkpoints.length, 0);
  reject = false;
  assert.equal((await timeline.seek({ generation: 'one', position: 60 })).ok, true);
  const invalid = fixture(async () => Infinity);
  assert.equal((await invalid.timeline.seek({ generation: 'one', position: 60 })).ok, false);
  assert.equal(invalid.checkpoints.length, 0);
});
test('seeking to the end stops just short so dragging does not consume a turn', async () => {
  const { timeline } = fixture();
  assert.equal((await timeline.seek({ generation: 'one', position: 180 })).ok, true);
  assert.equal(timeline.snapshot().position, 179.95);
});
test('elapsed and remaining labels support hours and invalid durations', () => {
  assert.equal(formatPlaybackTime(64.9), '1:04');
  assert.equal(formatPlaybackTime(3723), '1:02:03');
  assert.equal(formatPlaybackTime(-10), '0:00');
  assert.equal(formatPlaybackTime(Infinity), '0:00');
});

test('shutdown wait drains an acknowledged seek and notification errors do not orphan it', async () => {
  let finish!: (position: number) => void;
  const checkpoints: number[] = [];
  const timeline = new PlaybackTimeline(() => new Promise(resolve => { finish = resolve; }), (_generation, position) => checkpoints.push(position), () => { throw Error('host closed'); });
  timeline.sync('one'); timeline.report('one', { position: 5, duration: 90, seekable: true });
  const result = timeline.seek({ generation: 'one', position: 30 });
  let drained = false; void timeline.waitForSeek().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  finish(30); assert.equal((await result).ok, true);
  await timeline.waitForSeek(); assert.equal(drained, true);
  assert.deepEqual(checkpoints, [30]);
});

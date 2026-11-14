import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SingerScreenFrameHub } from '../../src/main/singer-screen-server';
import { SingerScreenCapture, type CapturedSingerScreen, type SingerScreenCaptureScheduler } from '../../src/main/singer-screen-capture';

const frame = (label: string, width = 640): CapturedSingerScreen => ({
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(label), Buffer.from([0xff, 0xd9])]), width, height: 360,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
};
class Scheduler implements SingerScreenCaptureScheduler {
  tasks = new Map<number, { callback: () => void; delay: number }>();
  nextId = 0;
  unrefs = 0;
  schedule(callback: () => void, delay: number) {
    const id = ++this.nextId; this.tasks.set(id, { callback, delay });
    return { cancel: () => { this.tasks.delete(id); }, unref: () => { this.unrefs++; } };
  }
  next() {
    assert.equal(this.tasks.size, 1, 'Only one polling timer should be live.');
    const [id, task] = [...this.tasks][0]; this.tasks.delete(id); task.callback(); return task.delay;
  }
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };
const currentJpeg = (hub: SingerScreenFrameHub) => hub.current?.jpeg;

test('capture polling never overlaps pending captures and timers are unrefed', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler(), pending = deferred<CapturedSingerScreen | null>();
  let calls = 0;
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => true, capture: () => { calls++; return pending.promise; } });
  capture.start(); capture.start(); assert.equal(scheduler.next(), 0); assert.equal(calls, 1);
  assert.equal(scheduler.next(), 125); assert.equal(scheduler.next(), 125); assert.equal(calls, 1);
  pending.resolve(frame('one')); await settled(); assert.equal(hub.current?.sequence, 1);
  assert.ok(scheduler.unrefs >= 3); capture.stop(); assert.equal(scheduler.tasks.size, 0); assert.equal(hub.current, null);
});

test('window invalidation clears old lyrics immediately and fences a pending old-window image', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler(), first = deferred<CapturedSingerScreen | null>(), next = deferred<CapturedSingerScreen | null>();
  hub.publish(frame('old lyrics'));
  let calls = 0;
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => true, capture: () => (++calls === 1 ? first.promise : next.promise) });
  capture.start(); scheduler.next(); capture.invalidate(); assert.equal(hub.current, null);
  first.resolve(frame('stale captured lyrics')); await settled(); assert.equal(hub.current, null);
  assert.equal(scheduler.next(), 0); assert.equal(calls, 2);
  next.resolve(frame('new display')); await settled(); assert.deepEqual(currentJpeg(hub), frame('new display').jpeg);
  capture.stop();
});

test('stop followed by restart waits for the obsolete capture without publishing it or overlapping', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler(), old = deferred<CapturedSingerScreen | null>();
  let calls = 0;
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => true, capture: () => ++calls === 1 ? old.promise : Promise.resolve(frame('fresh')) });
  capture.start(); scheduler.next(); capture.stop(); capture.start(); scheduler.next(); assert.equal(calls, 1);
  old.resolve(frame('old')); await settled(); assert.equal(hub.current, null);
  assert.equal(scheduler.next(), 0); await settled(); assert.equal(calls, 2); assert.deepEqual(currentJpeg(hub), frame('fresh').jpeg);
  capture.stop();
});

test('demand loss is observed during an in-flight capture and rejects its result after demand resumes', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler(), old = deferred<CapturedSingerScreen | null>();
  let demand = true, calls = 0;
  hub.publish(frame('previous lyrics'));
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => demand, capture: () => ++calls === 1 ? old.promise : Promise.resolve(frame('returned')) });
  capture.start(); scheduler.next(); demand = false; scheduler.next(); assert.equal(hub.current, null);
  demand = true; scheduler.next(); assert.equal(calls, 1);
  old.resolve(frame('no longer current')); await settled(); assert.equal(hub.current, null);
  scheduler.next(); await settled(); assert.deepEqual(currentJpeg(hub), frame('returned').jpeg);
  capture.stop();
});

test('demand checked again at completion prevents publication before the next polling tick', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler(), pending = deferred<CapturedSingerScreen | null>();
  let demand = true;
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => demand, capture: () => pending.promise });
  capture.start(); scheduler.next(); demand = false; pending.resolve(frame('not needed')); await settled();
  assert.equal(hub.current, null); capture.stop();
});

test('identical JPEGs and dimensions are deduplicated, but clearing the hub or resizing republishes', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler();
  let current = frame('static'), published = 0;
  hub.subscribe(value => { if (value) published++; });
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => true, capture: async () => current });
  capture.start(); scheduler.next(); await settled(); assert.equal(published, 1);
  scheduler.next(); await settled(); assert.equal(published, 1);
  current = frame('static', 1280); scheduler.next(); await settled(); assert.equal(published, 2);
  hub.clear(); scheduler.next(); await settled(); assert.equal(published, 3);
  current = frame('changed'); scheduler.next(); await settled(); assert.equal(published, 4);
  capture.stop();
});

test('a missing display, rejected capture or invalid frame clears old pixels and later recovers at normal cadence', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler();
  let operation: () => Promise<CapturedSingerScreen | null> = async () => frame('good');
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => true, capture: () => operation() });
  capture.start(); scheduler.next(); await settled(); assert.ok(hub.current);
  for (const failure of [async () => null, async () => { throw new Error('Window closed'); }, async () => ({ ...frame('bad'), width: 0 }), async () => ({ ...frame('oversized'), jpeg: Buffer.alloc(2 * 1024 * 1024 + 1) })]) {
    operation = failure; assert.equal(scheduler.next(), 125); await settled(); assert.equal(hub.current, null);
    assert.equal([...scheduler.tasks.values()][0].delay, 125, 'Errors must not spin an immediate capture loop.');
  }
  operation = async () => frame('recovered'); scheduler.next(); await settled(); assert.deepEqual(hub.current?.jpeg, frame('recovered').jpeg);
  capture.stop();
});

test('demand callback failure fails closed and inactive demand never invokes capture', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler();
  let calls = 0, failing = true;
  hub.publish(frame('old'));
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => { if (failing) throw Error('Lost preview'); return true; }, capture: async () => { calls++; return frame('new'); } });
  capture.start(); scheduler.next(); scheduler.next(); assert.equal(calls, 0); assert.equal(hub.current, null);
  failing = false; scheduler.next(); await settled(); assert.equal(calls, 1); assert.ok(hub.current);
  capture.stop();
});

test('late capture rejection after stop cannot clear a frame owned by a later publisher', async () => {
  const hub = new SingerScreenFrameHub(), scheduler = new Scheduler(), pending = deferred<CapturedSingerScreen | null>();
  const capture = new SingerScreenCapture(hub, { scheduler, hasDemand: () => true, capture: () => pending.promise });
  capture.start(); scheduler.next(); capture.stop(); hub.publish(frame('other publisher'));
  pending.reject(new Error('Late failure')); await settled(); assert.deepEqual(hub.current?.jpeg, frame('other publisher').jpeg);
  assert.equal(scheduler.tasks.size, 0);
});

test('invalid capture intervals are rejected before timers start', () => {
  for (const intervalMs of [0, -1, 49, 5001, NaN, 125.5]) assert.throws(() => new SingerScreenCapture(new SingerScreenFrameHub(), { intervalMs, hasDemand: () => true, capture: async () => null }), /between 50 and 5000/);
});

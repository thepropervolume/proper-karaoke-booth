import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DisplayFullscreen } from '../../src/main/display-fullscreen';
const wait = () => new Promise(resolve => setTimeout(resolve, 30));

test('fullscreen requests wait for completion and honor the latest requested state', () => {
  const calls: boolean[] = [];
  const controller = new DisplayFullscreen(value => calls.push(value), () => false, () => {});
  controller.set(true); controller.toggle(); controller.toggle(); controller.toggle();
  assert.deepEqual(calls, [true]); controller.changed(true); assert.deepEqual(calls, [true, false]);
  controller.changed(false); controller.toggle(); assert.deepEqual(calls, [true, false, true]);
  controller.close(); controller.changed(true); controller.toggle(); assert.deepEqual(calls, [true, false, true]);
});

test('a rejected startup fullscreen warns but keeps the control usable', () => {
  const calls: boolean[] = []; let fail = true, warnings = 0;
  const controller = new DisplayFullscreen(value => { if (fail) { fail = false; throw Error('denied'); } calls.push(value); }, () => false, () => { warnings++; });
  controller.set(true); assert.equal(warnings, 1); controller.toggle(); assert.deepEqual(calls, [true]);
  controller.changed(true); controller.changed(false); controller.toggle(); assert.deepEqual(calls, [true, true]); controller.close();
});

test('missing events reconcile success and recover from an ignored request', async () => {
  const calls: boolean[] = []; let native = false, warnings = 0;
  const controller = new DisplayFullscreen(value => calls.push(value), () => native, () => { warnings++; }, 5);
  controller.set(true); await wait(); assert.equal(warnings, 1); assert.deepEqual(calls, [true]);
  controller.toggle(); native = true; await wait(); assert.equal(warnings, 1);
  controller.toggle(); assert.deepEqual(calls, [true, true, false]); controller.close(); await wait(); assert.equal(warnings, 1);
});

test('a newer request during a lost event is reconciled and applied once', async () => {
  const calls: boolean[] = []; let native = false;
  const controller = new DisplayFullscreen(value => calls.push(value), () => native, () => assert.fail('unexpected warning'), 5);
  controller.set(true); controller.toggle(); native = true; await wait();
  assert.deepEqual(calls, [true, false]); controller.changed(false); controller.close();
});

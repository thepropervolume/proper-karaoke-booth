import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSingerDisplay, type DisplayLike, type Rectangle } from '../../src/main/display-placement';

const monitor = (id: number, bounds: Rectangle): DisplayLike => ({ id, bounds, workArea: { ...bounds, height: bounds.height - 40 } });
const main = monitor(1, { x: 0, y: 0, width: 1920, height: 1080 });
const right = monitor(2, { x: 1920, y: 0, width: 1920, height: 1080 });
const left = monitor(3, { x: -1280, y: 0, width: 1280, height: 1024 });
const host = { x: 100, y: 100, width: 1200, height: 800 };

test('connected saved singer monitor wins, including the same screen as the host', () => {
  assert.equal(selectSingerDisplay([main, right, left], host, 2), right);
  assert.equal(selectSingerDisplay([main, right, left], host, 1), main);
  const zero = monitor(0, { x: 0, y: -1080, width: 1920, height: 1080 });
  assert.equal(selectSingerDisplay([main, right, zero], host, 0), zero);
});

test('missing or absent saved monitor falls back to the nearest non-host screen from the actual host window', () => {
  assert.equal(selectSingerDisplay([main, right, left], host, 99), left);
  assert.equal(selectSingerDisplay([main, right, left], host), left);
  assert.equal(selectSingerDisplay([main, right, left], { x: 1500, y: 300, width: 300, height: 300 }), right);
});

test('the host screen follows largest window overlap, then nearest center if the window is offscreen', () => {
  assert.equal(selectSingerDisplay([main, right, left], { x: 1600, y: 300, width: 800, height: 400 }), main);
  assert.equal(selectSingerDisplay([main, right, left], { x: 4000, y: 200, width: 200, height: 200 }), main);
});

test('one connected monitor remains usable and an empty display list has no placement', () => {
  assert.equal(selectSingerDisplay([left], host, 2), left);
  assert.equal(selectSingerDisplay([], host, 2), undefined);
});

test('equidistant alternatives are deterministic regardless of enumeration order and input remains unchanged', () => {
  const center = monitor(10, { x: -50, y: -50, width: 100, height: 100 });
  const west = monitor(20, { x: -1050, y: -50, width: 100, height: 100 });
  const east = monitor(30, { x: 950, y: -50, width: 100, height: 100 });
  const displays = [east, center, west];
  const before = structuredClone(displays);
  assert.equal(selectSingerDisplay(displays, center.bounds), west);
  assert.equal(selectSingerDisplay([...displays].reverse(), center.bounds), west);
  assert.deepEqual(displays, before);
});

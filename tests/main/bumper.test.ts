import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BumperCatalog } from '../../src/main/bumper-catalog';
import { BumperController, type BumperTrack } from '../../src/main/bumper-controller';

const tracks: BumperTrack[] = [{ id: 'a', name: 'A', path: '/private/a.mp3' }, { id: 'b', name: 'B', path: '/private/b.mp3' }];

test('host catalog stores at most five supplied audio files without exposing or deleting them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-bumpers-'));
  const catalogPath = join(directory, 'bumper.json');
  try {
    const catalog = new BumperCatalog(catalogPath);
    const names = Array.from({ length: 6 }, (_, index) => join(directory, `track-${index}.mp3`));
    names.forEach(path => writeFileSync(path, 'fixture, no playback'));
    for (const path of names.slice(0, 5)) catalog.addSelectedFile(path);
    assert.equal(catalog.list().length, 5);
    assert.equal('path' in catalog.list()[0], false);
    assert.throws(() => catalog.addSelectedFile(names[5]), /five/);
    const reloaded = new BumperCatalog(catalogPath);
    assert.equal(reloaded.list().length, 5);
    assert.equal(reloaded.remove(reloaded.list()[0].id), true);
    assert.equal(readFileSync(names[0], 'utf8'), 'fixture, no playback');
    assert.throws(() => reloaded.addSelectedFile(names[1]), /already/);
    assert.throws(() => reloaded.addSelectedFile(join(directory, 'other.exe')), /local MP3/);
    writeFileSync(catalogPath, '{invalid');
    assert.throws(() => new BumperCatalog(catalogPath));
    assert.equal(readFileSync(catalogPath, 'utf8'), '{invalid');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('bumper requires explicit start, advances through supplied tracks and ignores stale events', async () => {
  const actions: string[] = [];
  const controller = new BumperController({ start: async track => { actions.push(`start:${track.id}`); }, stop: async () => { actions.push('stop'); } }, () => tracks);
  assert.equal(await controller.start(), false);
  await controller.setOutputAvailable(true);
  assert.deepEqual(actions, []);
  assert.equal(await controller.start(), true);
  const generation = controller.getState().generation!;
  await controller.ended('stale');
  assert.equal(controller.getState().trackId, 'a');
  await controller.ended(generation);
  assert.equal(controller.getState().trackId, 'b');
  await controller.karaokeStarting();
  assert.deepEqual(actions, ['start:a', 'start:b', 'stop']);
  assert.equal(await controller.start(), false);
  controller.karaokeEnded();
  assert.deepEqual(actions, ['start:a', 'start:b', 'stop']);
  await controller.setOutputAvailable(false);
  await controller.setOutputAvailable(true);
  assert.equal(controller.getState().status, 'stopped');
  await controller.close();
});

test('karaoke waits for a delayed bumper start to be cancelled and stopped', async () => {
  let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  let resume!: () => void; const gate = new Promise<void>(resolve => { resume = resolve; });
  const actions: string[] = [];
  const controller = new BumperController({ start: async () => { actions.push('start pending'); enter(); await gate; actions.push('audio started'); }, stop: async () => { actions.push('audio stopped'); } }, () => tracks);
  await controller.setOutputAvailable(true);
  const starting = controller.start(); await entered;
  const karaokeReady = controller.karaokeStarting();
  assert.equal(await controller.start(), false);
  resume();
  assert.equal(await starting, false);
  await karaokeReady;
  assert.deepEqual(actions, ['start pending', 'audio started', 'audio stopped']);
  assert.equal(controller.getState().status, 'stopped');
});

test('output loss stops the bumper and does not auto-resume when the output returns', async () => {
  let starts = 0, stops = 0;
  const controller = new BumperController({ start: async () => { starts++; }, stop: async () => { stops++; } }, () => tracks);
  await controller.setOutputAvailable(true); await controller.start();
  assert.equal(controller.isOutputAvailable(), true);
  await controller.setOutputAvailable(false); assert.equal(controller.isOutputAvailable(), false); await controller.setOutputAvailable(true);
  assert.equal(starts, 1); assert.equal(stops, 1); assert.equal(controller.getState().status, 'stopped');
});

test('removal is serialized with advance to prevent a removed file continuing to play', async () => {
  const list = tracks.map(track => ({ ...track }));
  const actions: string[] = [];
  const controller = new BumperController({ start: async track => { actions.push(`start:${track.id}`); }, stop: async () => { actions.push('stop'); } }, () => list);
  await controller.setOutputAvailable(true); await controller.start();
  const advance = controller.ended(controller.getState().generation!);
  const removal = controller.removeTrack('b', () => { list.splice(list.findIndex(track => track.id === 'b'), 1); return true; });
  await advance; assert.equal(await removal, true);
  assert.deepEqual(actions, ['start:a', 'start:b', 'stop']);
  assert.equal(controller.getState().status, 'stopped');
  assert.deepEqual(list.map(track => track.id), ['a']);
});

test('adapter failures are stopped and do not report a running bumper', async () => {
  let stops = 0;
  const controller = new BumperController({ start: async () => { throw new Error('decode'); }, stop: async () => { stops++; } }, () => tracks);
  await controller.setOutputAvailable(true);
  await assert.rejects(controller.start(), /decode/);
  assert.equal(stops, 1); assert.equal(controller.getState().status, 'stopped');
});


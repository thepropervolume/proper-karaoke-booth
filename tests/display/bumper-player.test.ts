import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createBumperPlayer, type BumperRequest } from '../../src/display/bumper-player';

/** Fake decoder retains retired elements so their delayed native events can be delivered. */
test('retired bumper events cannot affect a newer playing generation', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const elements: FakeAudio[] = [];
  class FakeAudio extends EventTarget {
    src = ''; volume = 1; muted = false; paused = true;
    constructor() { super(); elements.push(this); }
    async setSinkId(_id: string) {}
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    load() {}
  }
  Object.defineProperty(globalThis, 'Audio', { value: FakeAudio, configurable: true });
  try {
    const events: { type: 'ended' | 'error'; generation: string }[] = [];
    const outcomes = new Map<string, (value: { id: string; ok: boolean; error?: string }) => void>();
    const player = createBumperPlayer(value => outcomes.get(value.id)?.(value), value => events.push(value));
    const command = (request: BumperRequest) => new Promise<{ id: string; ok: boolean; error?: string }>(resolve => {
      outcomes.set(request.id, resolve);
      player.handle(request);
    });
    assert.equal((await command({ id: 'a', action: 'start', generation: 'a', src: 'a', volume: .5, deviceId: 'speaker' })).ok, true);
    const first = elements.at(-1)!;
    assert.equal((await command({ id: 'b', action: 'start', generation: 'b', src: 'b', volume: .4, deviceId: 'speaker' })).ok, true);
    const second = elements.at(-1)!;
    assert.notEqual(first, second);
    assert.equal(first.muted, true);
    assert.equal(first.paused, true);
    assert.equal(second.muted, false);
    assert.equal(second.paused, false);
    first.dispatchEvent(new Event('ended'));
    first.dispatchEvent(new Event('error'));
    assert.deepEqual(events, []);
    second.dispatchEvent(new Event('ended'));
    assert.deepEqual(events, [{ type: 'ended', generation: 'b' }]);
    player.setVolume(.8);
    assert.equal(second.volume, .8);
    player.muteForOutputChange();
    assert.equal(second.muted, true);
    assert.deepEqual(events, [{ type: 'ended', generation: 'b' }, { type: 'error', generation: 'b' }]);
    second.dispatchEvent(new Event('error'));
    assert.equal(events.length, 2);
    assert.equal((await command({ id: 'stop', action: 'stop' })).ok, true);
    second.dispatchEvent(new Event('error'));
    assert.equal(events.length, 2);
    assert.equal(second.muted, true);
    assert.equal(second.paused, true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'Audio', original);
    else Reflect.deleteProperty(globalThis, 'Audio');
  }
});

test('startup uses the default output, fades to the live volume, and cannot unmute after device loss', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  let audio!: FakeAudio, now = 0;
  const ticks = new Set<() => void>();
  class FakeAudio extends EventTarget {
    src = ''; volume = 1; muted = false; paused = true; sink = 'initial';
    constructor() { super(); audio = this; }
    async setSinkId(id: string) { this.sink = id; }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  }
  Object.defineProperty(globalThis, 'Audio', { value: FakeAudio, configurable: true });
  try {
    let resolve!: (value: { ok: boolean }) => void;
    const events: string[] = [];
    const player = createBumperPlayer(value => resolve(value), value => events.push(value.type), {
      now: () => now, every(tick) { ticks.add(tick); return () => { ticks.delete(tick); }; },
    });
    const started = new Promise<{ ok: boolean }>(done => { resolve = done; });
    player.handle({ id: 'launch', action: 'start', generation: 'launch', src: 'theme', volume: .8, deviceId: 'default', fadeMs: 1000 });
    assert.equal((await started).ok, true);
    assert.equal(audio.sink, ''); assert.equal(audio.volume, 0); assert.equal(audio.paused, false);
    now = 500; for (const tick of [...ticks]) tick(); assert.equal(audio.volume, .4);
    player.setVolume(.6); assert.equal(audio.volume, .3);
    now = 1000; for (const tick of [...ticks]) tick(); assert.equal(audio.volume, .6); assert.equal(ticks.size, 0);
    const next = new Promise<{ ok: boolean }>(done => { resolve = done; });
    player.handle({ id: 'next', action: 'start', generation: 'next', src: 'theme', volume: .8, deviceId: '', fadeMs: 1000 });
    await next; assert.equal(ticks.size, 1);
    player.muteForOutputChange(); assert.equal(ticks.size, 0); assert.equal(audio.muted, true);
    now = 2000; for (const tick of [...ticks]) tick(); assert.equal(audio.volume, 0); assert.equal(audio.muted, true);
    assert.deepEqual(events, ['error']);
  } finally {
    if (original) Object.defineProperty(globalThis, 'Audio', original); else Reflect.deleteProperty(globalThis, 'Audio');
  }
});

test('default output works without sink selection support; an unavailable explicit device fails closed', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  let plays = 0;
  class FakeAudio extends EventTarget {
    src = ''; volume = 1; muted = false;
    async play() { plays++; } pause() {} removeAttribute() {} load() {}
  }
  Object.defineProperty(globalThis, 'Audio', { value: FakeAudio, configurable: true });
  try {
    let resolve!: (value: { ok: boolean; error?: string }) => void;
    const player = createBumperPlayer(value => resolve(value), () => {});
    const run = (deviceId: string) => new Promise<{ ok: boolean; error?: string }>(done => { resolve = done; player.handle({ id: deviceId, action: 'start', generation: deviceId, src: 'theme', volume: .5, deviceId }); });
    assert.equal((await run('')).ok, true); assert.equal(plays, 1);
    const failed = await run('missing-device'); assert.equal(failed.ok, false); assert.match(failed.error!, /cannot be selected/); assert.equal(plays, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'Audio', original); else Reflect.deleteProperty(globalThis, 'Audio');
  }
});

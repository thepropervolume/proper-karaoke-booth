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

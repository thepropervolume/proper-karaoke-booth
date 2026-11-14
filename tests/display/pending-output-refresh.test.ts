import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';

test('metadata updates preserve an in-flight current output route and apply the latest volume', async () => {
  const descriptors = new Map(['window', 'document', 'navigator', 'Audio'].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let video: FakeMedia, publish: ((value: unknown) => Promise<void>) | undefined;
  let release!: () => void, enumerateCalls = 0;
  const enumeration = new Promise<void>(resolve => { release = resolve; });
  class FakeMedia extends EventTarget {
    id = ''; src = ''; muted = false; volume = 1; paused = true; playsInline = false;
    currentTime = 0; duration = 60; seekable = { length: 0 };
    sinkCalls = 0; pauseCalls = 0; playCalls = 0;
    async setSinkId(_id: string) { this.sinkCalls++; }
    async play() { this.playCalls++; this.paused = false; }
    pause() { this.pauseCalls++; this.paused = true; }
    load() {}
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    replaceWith(next: FakeMedia) { video = next; }
  }
  video = new FakeMedia();
  const caption = { textContent: '' }, next = { textContent: '' }, waiting = { hidden: false };
  const document = {
    body: { classList: { toggle() {} } }, querySelectorAll() { return []; },
    querySelector(selector: string) { return ({ '#video': video, '#caption': caption, '#next': next, '#waiting': waiting })[selector]; },
    createElement(tag: string) { assert.equal(tag, 'video'); return new FakeMedia(); },
  };
  const window = {
    addEventListener() {}, tpvDisplay: {
      onSeek() {}, onBumperCommand() {}, ready() {}, shortcut() {}, event() {}, bumperAck() {}, bumperEvent() {}, bumperDeviceChange() {},
      subscribe(callback: (value: unknown) => Promise<void>) { publish = callback; return () => {}; },
    },
  };
  const navigator = { mediaDevices: {
    addEventListener() {},
    async enumerateDevices() { enumerateCalls++; await enumeration; return [{ kind: 'audiooutput', deviceId: 'speaker' }]; },
  } };
  for (const [name, value] of Object.entries({ window, document, navigator, Audio: FakeMedia }))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  let pending: Promise<void> | undefined;
  try {
    await import('../../src/display/index'); assert.ok(publish);
    const playback = { generation: 'g1', src: 'tpv-media://song', status: 'playing', singer: 'Singer', title: 'Song', position: 0, volume: .8, outputId: 'speaker' };
    const view = { playback, next: ['First singer'], logo: null, shortcuts: DEFAULT_SHORTCUTS, bumperVolume: .5 };
    pending = publish(view);
    const playing = video;
    assert.equal(enumerateCalls, 1); assert.equal(playing.muted, true);
    await publish({ ...view, next: ['New singer'], playback: { ...playback, title: 'Corrected Song', volume: .3, position: 12 } });
    assert.equal(enumerateCalls, 1, 'metadata refresh cannot supersede device enumeration');
    assert.equal(playing.volume, .3); assert.equal(caption.textContent, 'Singer · Corrected Song');
    assert.equal(next.textContent, 'Coming up: New singer');
    release(); await pending; pending = undefined;
    assert.equal(playing.muted, false); assert.equal(playing.paused, false);
    assert.equal(playing.sinkCalls, 1); assert.equal(playing.playCalls, 1); assert.equal(playing.pauseCalls, 0);
    assert.equal(playing.volume, .3, 'a completed route keeps the newest volume');
    assert.equal(playing.currentTime, 0, 'checkpoint broadcasts are not implicit seek commands');
  } finally {
    release(); await pending?.catch(() => {});
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

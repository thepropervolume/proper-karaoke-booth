import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';

/** A devicechange models a changed default sink; this does not actuate real hardware. */
test('an output change while paused requires deliberate recovery before resuming', async () => {
  const descriptors = new Map(['window', 'document', 'navigator', 'Audio'].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const events: { type?: string; generation?: string }[] = [];
  let publish: ((value: unknown) => Promise<void>) | undefined;
  let onDeviceChange: (() => void) | undefined;
  let defaultSink = 'speaker-a';
  let audibleSink = '';
  let video: FakeMedia;

  class FakeMedia extends EventTarget {
    id = ''; src = ''; muted = false; volume = 1; paused = true; playsInline = false;
    currentTime = 0; duration = 60; seekable = { length: 0 }; sinkId = '';
    async setSinkId(id: string) { this.sinkId = id; }
    async play() { this.paused = false; if (!this.muted) audibleSink = this.sinkId || defaultSink; }
    pause() { this.paused = true; }
    load() {}
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    replaceWith(next: FakeMedia) { video = next; }
  }
  video = new FakeMedia();
  const waiting = { hidden: false }, caption = { textContent: '' }, next = { textContent: '' };
  const byId: Record<string, unknown> = { '#waiting': waiting, '#caption': caption, '#next': next };
  const fakeDocument = {
    body: { classList: { toggle() {} } },
    querySelector(selector: string) { return selector === '#video' ? video : byId[selector]; },
    querySelectorAll() { return []; },
    createElement(tag: string) { assert.equal(tag, 'video'); return new FakeMedia(); },
  };
  const fakeWindow = {
    addEventListener() {},
    tpvDisplay: {
      onSeek() {}, onBumperCommand() {}, ready() {}, shortcut() {}, bumperAck() {}, bumperEvent() {}, bumperDeviceChange() {},
      event(value: { type?: string; generation?: string }) { events.push(value); },
      subscribe(callback: (value: unknown) => Promise<void>) { publish = callback; return () => {}; },
    },
  };
  const fakeNavigator = { mediaDevices: {
    addEventListener(name: string, callback: () => void) { if (name === 'devicechange') onDeviceChange = callback; },
    async enumerateDevices() { return [{ kind: 'audiooutput', deviceId: defaultSink }]; },
  } };
  for (const [name, value] of Object.entries({ window: fakeWindow, document: fakeDocument, navigator: fakeNavigator, Audio: FakeMedia })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  try {
    await import('../../src/display/index');
    assert.ok(publish, 'display registered its state subscriber');
    assert.ok(onDeviceChange, 'display registered a devicechange handler');
    const playback = { generation: 'g1', src: 'tpv-media://song', status: 'playing', singer: 'Singer', title: 'Song', position: 0, volume: .8, outputId: '' };
    const view = { playback, next: [], logo: null, shortcuts: DEFAULT_SHORTCUTS, bumperVolume: .5 };
    await publish(view);
    assert.equal(audibleSink, 'speaker-a');
    await publish({ ...view, playback: { ...playback, status: 'paused' } });
    assert.equal(video.paused, true);
    assert.equal(video.muted, true);

    // Simulate a default-output change while the performance is already paused.
    defaultSink = 'speaker-b';
    onDeviceChange();
    const hostNotified = events.some(event => event.type === 'output-error' && event.generation === 'g1');
    // This state push models an unguarded host Resume; the test isolates the
    // display boundary, not the separate main-process authorization path.
    await publish(view);
    assert.deepEqual({ hostNotified, paused: video.paused, muted: video.muted, audibleSink },
      { hostNotified: true, paused: true, muted: true, audibleSink: 'speaker-a' },
      'the display must report the changed output and stay silent until deliberate recovery');
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

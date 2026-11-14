import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';

/** A devicechange models a changed default sink; this does not actuate real hardware. */
test('an output change while paused requires deliberate recovery before resuming', async () => {
  const descriptors = new Map(['window', 'document', 'navigator', 'Audio'].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const events: { type?: string; generation?: string; revision?: number }[] = [];
  let publish: ((value: unknown) => Promise<void>) | undefined;
  let onDeviceChange: (() => void) | undefined;
  let recoverOutput: ((value: unknown) => void) | undefined;
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
      onOutputRecovery(callback: (value: unknown) => void) { recoverOutput = callback; return () => {}; },
      event(value: { type?: string; generation?: string; revision?: number }) { events.push(value); },
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
    assert.ok(recoverOutput, 'display registers its trusted recovery callback');
    const firstRevision = events.filter(event => event.type === 'output-error').at(-1)?.revision;
    assert.ok(Number.isSafeInteger(firstRevision));
    recoverOutput({ generation: 'old-generation', revision: firstRevision });
    await publish({ ...view, next: ['Another singer'] });
    assert.equal(video.muted, true, 'stale recovery and queue updates cannot release the output gate');
    recoverOutput({ generation: 'g1', revision: firstRevision });
    await publish(view);
    assert.deepEqual({ paused: video.paused, muted: video.muted, audibleSink },
      { paused: false, muted: false, audibleSink: 'speaker-b' },
      'a deliberate recovery can validate the current default sink and resume this generation');
    await publish({ ...view, playback: { ...playback, status: 'paused' } });
    defaultSink = 'speaker-c'; onDeviceChange();
    const secondRevision = events.filter(event => event.type === 'output-error').at(-1)?.revision;
    recoverOutput({ generation: 'g1', revision: secondRevision });
    const pendingResume = publish(view);
    // A newer device event can arrive after host authorization but before the
    // asynchronous route finishes. Its fresh revision invalidates that intent.
    defaultSink = 'speaker-d'; onDeviceChange();
    await pendingResume;
    assert.equal(video.muted, true); assert.equal(video.paused, true); assert.equal(audibleSink, 'speaker-b');
    recoverOutput({ generation: 'g1', revision: secondRevision });
    await publish(view);
    assert.equal(video.muted, true, 'replaying stale authorization cannot release a newer device event');
    const newestRevision = events.filter(event => event.type === 'output-error').at(-1)?.revision;
    assert.ok(Number(newestRevision) > Number(secondRevision));
    recoverOutput({ generation: 'g1', revision: newestRevision });
    await publish(view);
    assert.equal(video.muted, false); assert.equal(video.paused, false); assert.equal(audibleSink, 'speaker-d');
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

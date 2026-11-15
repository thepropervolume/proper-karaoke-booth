import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';

/** Exercise the actual display subscription and audio-output router without a real device. */
test('queue updates do not interrupt the currently playing output', async () => {
  const descriptors = new Map(['window', 'document', 'navigator', 'Audio'].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let video: FakeMedia;
  let enumerateCount = 0;
  let finishEnumeration: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  const devices = [{ kind: 'audiooutput', deviceId: 'speaker' }];
  let publish: ((value: unknown) => Promise<void>) | undefined;

  class FakeMedia extends EventTarget {
    id = ''; src = ''; muted = false; volume = 1; paused = true; playsInline = false;
    currentTime = 0; duration = 60; seekable = { length: 0 };
    sinkCalls = 0; pauseCalls = 0; playCalls = 0; loadCalls = 0;
    async setSinkId(_id: string) { this.sinkCalls++; }
    async play() { this.playCalls++; this.paused = false; }
    pause() { this.pauseCalls++; this.paused = true; }
    load() { this.loadCalls++; }
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
      onSeek() {}, onBumperCommand() {}, ready() {}, shortcut() {}, event() {}, bumperAck() {}, bumperEvent() {}, bumperDeviceChange() {},
      subscribe(callback: (value: unknown) => Promise<void>) { publish = callback; return () => {}; },
    },
  };
  const fakeNavigator = { mediaDevices: {
    addEventListener() {},
    async enumerateDevices() {
      enumerateCount++;
      if (enumerateCount > 1) await new Promise<void>(resolve => { finishEnumeration = resolve; });
      return devices;
    },
  } };
  for (const [name, value] of Object.entries({ window: fakeWindow, document: fakeDocument, navigator: fakeNavigator, Audio: FakeMedia })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  try {
    await import('../../src/display/index');
    assert.ok(publish, 'display registered its state subscriber');
    const view = { playback: { generation: 'g1', src: 'tpv-media://song', status: 'playing', singer: 'Singer', title: 'Song', position: 0, volume: .8, outputId: 'speaker' },
      next: ['First singer'], logo: null, shortcuts: DEFAULT_SHORTCUTS, bumperVolume: .5 };
    await publish(view);
    const playing = video;
    assert.equal(playing.muted, false);
    assert.equal(playing.paused, false);
    assert.equal(enumerateCount, 1);
    assert.equal(playing.sinkCalls, 1);

    // Changing only the visible queue must not mute, re-enumerate or re-route audio.
    pending = publish({ ...view, next: ['A different upcoming singer'] });
    assert.equal(playing.muted, false, 'an unrelated queue update must not mute the active track');
    assert.equal(enumerateCount, 1, 'an unrelated queue update must not re-enumerate devices');
    assert.equal(playing.sinkCalls, 1, 'an unrelated queue update must not re-route the active track');
    assert.equal(playing.paused, false);
    const before = { pause: playing.pauseCalls, play: playing.playCalls, load: playing.loadCalls };
    playing.currentTime = 23;
    await publish({ ...view, logo: 'data:image/png;base64,AAAA', branding: { boothName: 'Updated Booth', displayLogoSize: 80,
      bannerEnabled: true, bannerText: 'Welcome!', bannerPosition: 'top', bannerExpiresAt: '' } });
    assert.equal(video, playing); assert.equal(playing.currentTime, 23);
    assert.deepEqual({ pause: playing.pauseCalls, play: playing.playCalls, load: playing.loadCalls }, before,
      'Branding updates must not pause, restart or reload a playing song.');
  } finally {
    finishEnumeration?.();
    await pending?.catch(() => {});
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

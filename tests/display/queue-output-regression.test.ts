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
  const events: { type: string; code?: string; generation: string; position?: number }[] = [];
  let publish: ((value: unknown) => Promise<void>) | undefined;

  class FakeMedia extends EventTarget {
    id = ''; src = ''; muted = false; volume = 1; paused = true; playsInline = false;
    currentTime = 0; duration = 60; seekable = { length: 0 }; error: { code: number } | null = null;
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
  const fontWrites: string[] = [];
  const fakeDocument = {
    body: { classList: { toggle() {} } },
    documentElement: { style: { setProperty(name: string, value: string) { if (name === '--booth-font-family') fontWrites.push(value); } } },
    querySelector(selector: string) { return selector === '#video' ? video : byId[selector]; },
    querySelectorAll() { return []; },
    createElement(tag: string) { assert.equal(tag, 'video'); return new FakeMedia(); },
  };
  const fakeWindow = {
    addEventListener() {},
    tpvDisplay: {
      onSeek() {}, onBumperCommand() {}, ready() {}, shortcut() {},
      event(value: typeof events[number]) { events.push(value); }, bumperAck() {}, bumperEvent() {}, bumperDeviceChange() {},
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
    assert.deepEqual(fontWrites, [], 'Default and queue-only updates leave the font untouched.');
    await publish({ ...view, fontFamily: 'serif', logo: 'data:image/png;base64,AAAA', branding: { boothName: 'Updated Booth', displayLogoSize: 80,
      bannerEnabled: true, bannerText: 'Welcome!', bannerPosition: 'top', bannerExpiresAt: '' } });
    assert.deepEqual(fontWrites, ['Georgia, "Times New Roman", serif']);
    assert.equal(video, playing); assert.equal(playing.currentTime, 23);
    assert.deepEqual({ pause: playing.pauseCalls, play: playing.playCalls, load: playing.loadCalls }, before,
      'Appearance updates must not pause, restart or reload a playing song.');

    playing.error = { code: 2 };
    playing.dispatchEvent(new Event('error'));
    assert.equal(playing.muted, true);
    assert.equal(playing.paused, true);
    assert.deepEqual(events.filter(event => event.type === 'error'), [{ type: 'error', generation: 'g1', code: 'MEDIA_ERR_NETWORK', position: 23 }]);
    playing.dispatchEvent(new Event('error'));
    playing.dispatchEvent(new Event('ended'));
    assert.equal(events.filter(event => event.type === 'error').length, 1);
    assert.equal(events.some(event => event.type === 'ended'), false, 'A failed decoder cannot complete the request.');
    await publish({ ...view, next: ['Queue refresh after failure'] });
    assert.equal(video, playing, 'A queue refresh cannot retry the decoder.');
    await publish({ ...view, playback: { ...view.playback, status: 'paused', position: 23 } });
    assert.equal(video, playing, 'Publishing the pause does not create the decoder.');

    // Enumeration is delayed again for the fresh player, as with an actual sink.
    pending = publish({ ...view, playback: { ...view.playback, position: 23 } });
    const resumed = video as FakeMedia;
    assert.notEqual(resumed, playing, 'Authorized Play retries with a fresh element.');
    resumed.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(resumed.currentTime, 23);
    finishEnumeration?.();
    await pending; pending = undefined;
    assert.equal(resumed.playCalls, 1);
    assert.equal(resumed.muted, false);
    playing.dispatchEvent(new Event('ended'));
    assert.equal(events.some(event => event.type === 'ended'), false, 'Late events cannot affect retry on the same generation.');
  } finally {
    finishEnumeration?.();
    await pending?.catch(() => {});
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

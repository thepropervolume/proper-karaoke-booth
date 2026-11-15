import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';

/** Simulates display IPC and audio clocks; it does not actuate the venue mixer. */
test('native display isolates video events, serializes recovery, seeks, and cannot autoplay after a paused decode', async () => {
  const names = ['window', 'document', 'navigator', 'Audio', 'AudioContext', 'fetch'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const events: any[] = [], contexts: FakeContext[] = [];
  let publish!: (view: any) => Promise<void>, seek!: (value: unknown) => void, recover!: (value: unknown) => void, deviceChange!: () => void;
  let video: FakeMedia;
  let releaseFetch: (() => void) | null = null, fetchStarted: (() => void) | null = null, held: Promise<void> | null = null;
  let heldRoute: Promise<void> | null = null, routeStarted: (() => void) | null = null;
  class FakeMedia extends EventTarget {
    id = ''; src = ''; muted = false; volume = 1; paused = true; playsInline = false; loop = false;
    currentTime = 0; duration = 10; seekable = { length: 1, start: () => 0, end: () => 10 };
    async setSinkId(_id: string) {} async play() { this.paused = false; }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    hasAttribute(name: string) { return name === 'src' && !!this.src; }
    getAttribute(name: string) { return name === 'src' ? this.src : null; }
    load() {} replaceWith(next: FakeMedia) { video = next; }
  }
  class FakeContext {
    currentTime = 0; state = 'running'; destination = {}; gains: any[] = []; sources: any[] = [];
    constructor() { contexts.push(this); }
    createGain() { const gain = { gain: { value: 0 }, connect() {}, disconnect() {} }; this.gains.push(gain); return gain; }
    createBufferSource() { const source = { buffer: null, onended: null, started: false, stopped: false,
      connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; this.sources.push(source); return source; }
    async decodeAudioData(_data: ArrayBuffer) { return { duration: 10, length: 48_000 * 10, numberOfChannels: 1 }; }
    async resume() {} async close() {} async setSinkId(_id: string) { if (heldRoute) { routeStarted?.(); await heldRoute; heldRoute = null; } }
  }
  video = new FakeMedia(); const backdrop = new FakeMedia(), waiting = { hidden: false }, caption = { textContent: '' }, next = { textContent: '' };
  const byId: Record<string, unknown> = { '#waiting': waiting, '#caption': caption, '#next': next, '#karafun-backdrop': backdrop, '#karafun-lyrics': null };
  const fakeWindow = { addEventListener() {}, tpvDisplay: {
    onSeek(callback: typeof seek) { seek = callback; return () => {}; }, onOutputRecovery(callback: typeof recover) { recover = callback; return () => {}; },
    subscribe(callback: typeof publish) { publish = callback; return () => {}; }, ready() {}, shortcut() {}, bumperAck() {}, bumperEvent() {}, bumperDeviceChange() {}, onBumperCommand() {},
    event(value: unknown) { events.push(value); },
  } };
  const fakeDocument = { body: { classList: { toggle() {} } }, querySelector(selector: string) { return selector === '#video' ? video : byId[selector]; },
    querySelectorAll() { return []; }, createElement() { return new FakeMedia(); } };
  const fakeNavigator = { mediaDevices: { async enumerateDevices() { return [{ kind: 'audiooutput', deviceId: 'mixer' }]; }, addEventListener(name: string, callback: () => void) { if (name === 'devicechange') deviceChange = callback; } } };
  const fakeFetch = async () => { if (held) { fetchStarted?.(); await held; held = null; } return new Response(Uint8Array.of(1, 2, 3), { headers: { 'content-length': '3' } }); };
  for (const [name, value] of Object.entries({ window: fakeWindow, document: fakeDocument, navigator: fakeNavigator, Audio: FakeMedia, AudioContext: FakeContext, fetch: fakeFetch }))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const view = (playback: any) => ({ playback, next: [], logo: null, shortcuts: DEFAULT_SHORTCUTS, bumperVolume: .5 });
  const common = { generation: 'first', src: 'tpv-media://play/first', status: 'playing', singer: 'QA', title: 'Native', position: 0, volume: .8, outputId: '' };
  const native = { ...common, kind: 'karafun', karaFun: { durationSeconds: 10, timing: { durationSeconds: 10, bounds: { x: 0, y: 0, width: 640, height: 360 }, pages: [], countIns: [], tracks: [], files: [], rightToLeft: false },
    stems: [{ id: 1, role: 'instrumental', src: 'tpv-media://karafun-stem/first/1' }] }, backdropSrc: 'tpv-media://lyric-backdrop/first' };
  try {
    await import('../../src/display/index');
    await publish(view({ ...common, generation: 'legacy' })); const retiredVideo = video;
    await publish(view(native)); const context = contexts[0];
    assert.equal(context.sources.length, 1); assert.equal(context.sources[0].started, true);
    assert.equal(video.muted, true); assert.equal(video.paused, true);
    assert.equal(backdrop.muted, true); assert.equal(backdrop.volume, 0); assert.equal(backdrop.loop, true); assert.equal(backdrop.paused, false);
    const beforeStaleEvent = events.length; retiredVideo.dispatchEvent(new Event('ended')); retiredVideo.dispatchEvent(new Event('error'));
    assert.equal(events.length, beforeStaleEvent);
    await publish({ ...view({ ...native, volume: .4 }), next: ['Another singer'] });
    assert.equal(context.sources.length, 1); assert.equal(context.gains[0].gain.value, .4);
    context.currentTime = 2.025; await publish(view({ ...native, status: 'paused' }));
    assert.equal(context.gains[0].gain.value, 0);
    assert.equal(events.some(event => event.type === 'checkpoint' && event.generation === 'first' && event.position === 2), true);
    deviceChange();
    const firstRevision = events.filter(event => event.type === 'output-error').at(-1).revision;
    await publish(view(native)); assert.equal(context.sources.length, 1, 'state refresh cannot resume after loss');
    recover({ generation: 'first', revision: firstRevision - 1 }); await publish(view(native)); assert.equal(context.sources.length, 1);
    recover({ generation: 'first', revision: firstRevision });
    await publish(view(native));
    assert.equal(context.sources.length, 2, 'same-status state publication must await deliberate recovery');
    seek({ id: 'seek-native', generation: 'first', position: 5 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.some(event => event.type === 'seek-result' && event.id === 'seek-native' && event.ok && event.position === 5), true);
    // A changed selection must revoke even an already-pending recovery route.
    deviceChange(); await publish(view({ ...native, status: 'paused' }));
    const pendingRevision = events.filter(event => event.type === 'output-error').at(-1).revision;
    let releaseRoute!: () => void;
    const beganRoute = new Promise<void>(resolve => { routeStarted = resolve; });
    heldRoute = new Promise<void>(resolve => { releaseRoute = resolve; });
    recover({ generation: 'first', revision: pendingRevision }); await beganRoute;
    const sourceCount = context.sources.length, resuming = publish(view(native));
    const changedSelection = publish(view({ ...native, status: 'paused', outputId: 'mixer' }));
    const newRevision = events.filter(event => event.type === 'output-error').at(-1).revision;
    assert.ok(newRevision > pendingRevision);
    releaseRoute(); await Promise.all([resuming, changedSelection]);
    assert.equal(context.sources.length, sourceCount); assert.equal(context.gains[0].gain.value, 0);
    recover({ generation: 'first', revision: newRevision });
    await publish(view({ ...native, outputId: 'mixer' }));
    assert.equal(context.sources.length, sourceCount + 1);
    context.currentTime = 30; context.sources.at(-1).onended?.();
    assert.equal(events.filter(event => event.type === 'ended' && event.generation === 'first').length, 1);
    await publish(view(null)); assert.equal(context.gains[0].gain.value, 0); assert.equal(backdrop.paused, true);
    assert.equal(events.some(event => event.type === 'silenced' && event.generation === 'first'), true);

    // Pause arrives while the replacement recording is still being fetched.
    const began = new Promise<void>(resolve => { fetchStarted = resolve; });
    held = new Promise<void>(resolve => { releaseFetch = resolve; });
    const replacement = { ...native, generation: 'second', src: 'tpv-media://play/second' };
    const loading = publish(view(replacement)); await began;
    const paused = publish(view({ ...replacement, status: 'paused' }));
    releaseFetch!(); await Promise.all([loading, paused]);
    const afterPausedDecode = context.sources.length;
    assert.equal(context.gains[0].gain.value, 0);
    await publish(view({ ...replacement, status: 'paused', volume: .6 })); assert.equal(context.sources.length, afterPausedDecode);
    await publish(view(replacement)); assert.equal(context.sources.length, afterPausedDecode + 1);
    await publish(view({ ...common, generation: 'new-video', kind: 'video' }));
    assert.equal(context.gains[0].gain.value, 0); assert.equal(video.paused, false); assert.equal(backdrop.paused, true);
    await publish(view(null));
  } finally {
    if (publish) await publish(view(null));
    for (const [name, original] of originals) { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); }
  }
});

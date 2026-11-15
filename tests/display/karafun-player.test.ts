import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KaraFunPlayer, KaraFunPlayerError, type KaraFunAudioContext, type KaraFunPlaybackInput, type KaraFunPlayerEvent } from '../../src/display/karafun-player';

const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class FakeGain {
  gain = { value: 0 }; disconnected = false;
  connect(_destination: unknown) {} disconnect() { this.disconnected = true; }
}
class FakeSource {
  buffer: { duration: number; length: number; numberOfChannels: number } | null = null;
  onended: (() => void) | null = null; started: { when: number; offset: number } | null = null; stopped = false;
  connect(_destination: unknown) {} disconnect() {}
  start(when: number, offset: number) { this.started = { when, offset }; }
  stop() { this.stopped = true; }
}
class FakeContext implements KaraFunAudioContext {
  currentTime = 0; state = 'suspended'; destination = {}; closed = false;
  gains: FakeGain[] = []; sources: FakeSource[] = []; routes: string[] = [];
  resumeOperation: Promise<void> | null = null;
  decodeOperation: ((data: ArrayBuffer) => Promise<{ duration: number; length: number; numberOfChannels: number }>) | null = null;
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  async decodeAudioData(data: ArrayBuffer) { return this.decodeOperation ? this.decodeOperation(data) : { duration: new Uint8Array(data)[0] || 60, length: 48_000 * 60, numberOfChannels: 2 }; }
  async resume() { if (this.resumeOperation) await this.resumeOperation; this.state = 'running'; }
  async close() { this.closed = true; this.state = 'closed'; }
  async setSinkId(id: string) { this.routes.push(id); }
}
const input = (generation = 'show:1'): KaraFunPlaybackInput => ({ generation, durationSeconds: 60, volume: .8, outputId: '', stems: [
  { id: 1, role: 'instrumental', src: 'tpv-media://karafun-stem/show/1' },
  { id: 2, role: 'backing', src: 'tpv-media://karafun-stem/show/2' },
  { id: 3, role: 'lead', src: 'tpv-media://karafun-stem/show/3' },
] });
function setup(extra: { maximumDecodedBytes?: number; fetchAudio?: (src: string, signal: AbortSignal) => Promise<ArrayBuffer>; listOutputs?: () => Promise<readonly { kind: string; deviceId: string }[]> } = {}) {
  const context = new FakeContext(), events: KaraFunPlayerEvent[] = [];
  const player = new KaraFunPlayer({ createContext: () => context, onEvent: event => events.push(event), autoTick: false,
    fetchAudio: async () => Uint8Array.of(60).buffer, listOutputs: async () => [{ kind: 'audiooutput', deviceId: 'mixer' }], ...extra });
  return { context, player, events };
}

test('loading stays silent; every stem shares one start clock and preserves pause/seek position', async () => {
  const { player, context, events } = setup();
  await player.load(input());
  assert.equal(context.sources.length, 0);
  assert.equal(player.snapshot()?.status, 'paused');
  assert.equal(await player.play('show:1'), true);
  assert.deepEqual(context.sources.map(source => source.started), Array(3).fill({ when: .025, offset: 0 }));
  assert.deepEqual(context.gains.slice(1).map(gain => gain.gain.value), [1, 1, 0]);
  assert.equal(context.gains[0].gain.value, .8);
  context.currentTime = 2.025;
  assert.equal(player.snapshot()?.position, 2);
  const old = [...context.sources];
  assert.equal(await player.seek('show:1', 30), true);
  assert.ok(old.every(source => source.stopped && source.buffer === null));
  assert.ok(context.sources.slice(3).every(source => source.started?.offset === 30 && source.started?.when === 2.05));
  context.currentTime = 2.55; player.pause('show:1');
  assert.equal(player.snapshot()?.position, 30.5);
  context.currentTime = 20;
  assert.equal(player.snapshot()?.position, 30.5);
  assert.equal(context.gains[0].gain.value, 0);
  await player.play('show:1');
  player.setMix('show:1', { lead: .4, backing: .7 });
  assert.deepEqual(context.gains.slice(-3).map(gain => gain.gain.value), [1, .7, .4]);
  player.setVolume('show:1', .3); assert.equal(context.gains[0].gain.value, .3);
  context.currentTime = 60; player.tick(); player.tick();
  assert.equal(player.snapshot()?.status, 'ended');
  assert.equal(player.snapshot()?.position, 60);
  assert.equal(events.filter(event => event.type === 'ended').length, 1);
  assert.equal(context.gains[0].gain.value, 0);
  assert.equal(await player.seek('show:1', 0), true);
  assert.equal(player.snapshot()?.status, 'paused');
  await player.dispose(); assert.equal(context.closed, true);
});

test('output loss while paused requires matching explicit recovery and never resumes itself', async () => {
  const { player, context, events } = setup();
  await player.load(input()); await player.play('show:1'); context.currentTime = 5.025;
  player.pause('show:1'); const revision = player.invalidateOutput();
  assert.equal(await player.play('show:1'), false);
  assert.equal(player.snapshot()?.position, 5);
  assert.equal(await player.recoverOutput('show:1', revision - 1, 'mixer'), false);
  assert.equal(await player.recoverOutput('old', revision, 'mixer'), false);
  assert.equal(await player.recoverOutput('show:1', revision, 'mixer'), true);
  assert.equal(player.snapshot()?.status, 'paused');
  assert.equal(context.gains[0].gain.value, 0);
  assert.deepEqual(context.routes, ['', 'mixer']);
  assert.equal(events.filter(event => event.type === 'output-error').length, 1);
  await player.play('show:1'); assert.equal(player.snapshot()?.status, 'playing');
  await player.dispose();
});

test('missing selected output blocks even a prepared recording until valid recovery', async () => {
  const { player, events } = setup();
  await player.load({ ...input(), outputId: 'disconnected' });
  assert.equal(player.snapshot()?.ready, true);
  assert.equal(player.snapshot()?.outputBlocked, true);
  assert.equal(await player.play('show:1'), false);
  const revision = player.snapshot()!.outputRevision;
  assert.equal(await player.recoverOutput('show:1', revision, 'still-missing'), false);
  assert.equal(await player.recoverOutput('show:1', revision, 'mixer'), true);
  assert.equal(player.snapshot()?.status, 'paused');
  assert.equal(events.filter(event => event.type === 'output-error').length, 1);
  await player.dispose();
});

test('a delayed resume cannot play after Pause or a generation replacement', async () => {
  const { player, context } = setup(), resume = deferred<void>();
  await player.load(input()); context.resumeOperation = resume.promise;
  const playing = player.play('show:1'); player.pause('show:1'); resume.resolve();
  assert.equal(await playing, false); assert.equal(context.sources.length, 0);
  const again = deferred<void>(); context.resumeOperation = again.promise;
  const stale = player.play('show:1'); await player.load(input('show:2')); again.resolve();
  assert.equal(await stale, false); assert.equal(player.snapshot()?.generation, 'show:2');
  assert.equal(context.sources.length, 0);
  await player.dispose();
});

test('replaced asynchronous decode cannot overwrite the new generation or emit its errors', async () => {
  const { player, context, events } = setup(), decode = deferred<{ duration: number; length: number; numberOfChannels: number }>();
  let first = true;
  context.decodeOperation = async () => { if (first) { first = false; return decode.promise; } return { duration: 60, length: 100, numberOfChannels: 1 }; };
  const loading = player.load(input('old'));
  await Promise.resolve(); await Promise.resolve();
  const rejected = assert.rejects(loading, { name: 'AbortError' });
  await player.load(input('new'));
  decode.resolve({ duration: 60, length: 100, numberOfChannels: 1 }); await rejected;
  assert.equal(player.snapshot()?.generation, 'new'); assert.equal(player.snapshot()?.ready, true);
  assert.equal(events.some(event => event.type === 'error'), false);
  await player.dispose();
});

test('decoded memory budget fails the entire mix explicitly instead of silently dropping stems', async () => {
  const { player, context, events } = setup({ maximumDecodedBytes: 1000 });
  context.decodeOperation = async () => ({ duration: 60, length: 200, numberOfChannels: 1 });
  await assert.rejects(player.load(input()), (error: unknown) => error instanceof KaraFunPlayerError && error.code === 'requires-premix');
  assert.equal(player.snapshot()?.status, 'error'); assert.equal(player.snapshot()?.ready, false);
  assert.equal(await player.play('show:1'), false); assert.equal(context.sources.length, 0);
  assert.equal(events.some(event => event.type === 'error' && event.code === 'requires-premix'), true);
  await player.dispose();
});

test('decode failure and resume rejection remain silent with actionable separate errors', async () => {
  const failed = setup(); failed.context.decodeOperation = async () => { throw new Error('private decoder detail'); };
  await assert.rejects(failed.player.load(input()), /Prepared KaraFun audio could not be read or decoded/);
  assert.equal(failed.context.sources.length, 0);
  assert.equal(failed.events.some(event => JSON.stringify(event).includes('private decoder')), false);
  await failed.player.dispose();
  const routed = setup(); await routed.player.load(input());
  routed.context.resumeOperation = Promise.reject(new Error('output rejected'));
  assert.equal(await routed.player.play('show:1'), false);
  assert.equal(routed.player.snapshot()?.outputBlocked, true);
  assert.equal(routed.events.some(event => event.type === 'output-error'), true);
  await routed.player.dispose();
});

test('stop aborts pending fetch and invalid identities cannot mutate a generation', async () => {
  let aborted = false;
  const fetchStarted = deferred<void>();
  const { player } = setup({ fetchAudio: async (_src, signal) => new Promise((_resolve, reject) => {
    fetchStarted.resolve(); signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Cancelled', 'AbortError')); });
  }) });
  const loading = player.load(input()); const rejected = assert.rejects(loading, { name: 'AbortError' });
  await fetchStarted.promise; player.stop(); await rejected;
  assert.equal(aborted, true); assert.equal(player.snapshot(), null);
  const fresh = setup(); await fresh.player.load(input());
  await assert.rejects(fresh.player.load({ ...input(), stems: [{ ...input().stems[0], src: 'tpv-media://changed' }] }), /generation cannot change/);
  await assert.rejects(fresh.player.load({ ...input('bad'), stems: [input().stems[0], input().stems[0]] }), /Invalid prepared/);
  assert.equal(fresh.player.snapshot()?.generation, 'show:1');
  assert.equal(fresh.player.pause('other'), false); assert.equal(fresh.player.stop('other'), false);
  await fresh.player.dispose();
});

test('duet and backing voices change independently without restarting, seeking or changing global volume', async () => {
  const { player, context } = setup();
  const duet = { ...input(), stems: [...input().stems,
    { id: 4, role: 'lead' as const, voice: 'Second Voice', src: 'tpv-media://karafun-stem/show/4' },
    { id: 5, role: 'backing' as const, voice: 'Second Choir', src: 'tpv-media://karafun-stem/show/5' }] };
  await player.load(duet); await player.play('show:1'); context.currentTime = 7.025;
  const sources = [...context.sources];
  player.setStemVolumes('show:1', { 3: .6, 4: .2, 2: .4 });
  assert.deepEqual(context.gains.slice(1).map(gain => gain.gain.value), [1, .4, .6, .2, 1]);
  assert.equal(context.gains[0].gain.value, .8); assert.equal(player.snapshot()?.position, 7);
  assert.deepEqual(context.sources, sources); assert.ok(sources.every(source => !source.stopped));
  // Stale and malformed projections cannot partly modify the live mix.
  player.setStemVolumes('old-performance', { 3: 1 });
  const invalidVolumes: Record<string, number>[] = [{ 3: .1, 99: 1 }, { 3: NaN }, { 3: 2 }, { '03': .5 }];
  for (const value of invalidVolumes)
    assert.throws(() => player.setStemVolumes('show:1', value), /Invalid prepared/);
  assert.deepEqual(context.gains.slice(1).map(gain => gain.gain.value), [1, .4, .6, .2, 1]);
  player.pause('show:1'); player.setStemVolumes('show:1', { 3: .7, 4: .3 });
  assert.equal(context.gains[0].gain.value, 0);
  await player.seek('show:1', 12); await player.play('show:1');
  assert.deepEqual(context.gains.slice(-5).map(gain => gain.gain.value), [1, 1, .7, .3, 1]);
  assert.ok(context.sources.slice(-5).every(source => source.started?.offset === 12));
  player.setStemVolumes('show:1', {});
  assert.deepEqual(context.gains.slice(-5).map(gain => gain.gain.value), [1, 1, 0, 0, 1]);
  await player.load({ ...duet, generation: 'show:2' }); await player.play('show:2');
  assert.deepEqual(context.gains.slice(-5).map(gain => gain.gain.value), [1, 1, 0, 0, 1]);
  await player.dispose();
});

test('a mix arriving during decode is applied on first play and a same-generation refresh never reloads audio', async () => {
  const gate = deferred<ArrayBuffer>(); let reads = 0;
  const { player, context } = setup({ fetchAudio: async () => { ++reads; return reads === 1 ? gate.promise : Uint8Array.of(60).buffer; } });
  const loading = player.load({ ...input(), stemVolumes: { 3: .1 } });
  player.setStemVolumes('show:1', { 2: .5, 3: .9 }); gate.resolve(Uint8Array.of(60).buffer); await loading;
  assert.equal(context.sources.length, 0);
  await player.play('show:1'); assert.deepEqual(context.gains.slice(1).map(gain => gain.gain.value), [1, .5, .9]);
  await player.load({ ...input(), stemVolumes: { 3: .4 } });
  assert.equal(reads, 3); assert.equal(context.sources.length, 3);
  assert.deepEqual(context.gains.slice(1).map(gain => gain.gain.value), [1, 1, .4]);
  await player.dispose();
});

test('live channel adjustments ramp over 15 ms on the existing audio clock', async () => {
  const { player, context } = setup(); const calls: [string, number, number?][] = [];
  const gain = context.createGain.bind(context);
  context.createGain = () => {
    const node = gain();
    Object.assign(node.gain, { cancelAndHoldAtTime: (time: number) => calls.push(['hold', time]),
      linearRampToValueAtTime: (value: number, time: number) => calls.push(['ramp', value, time]) });
    return node;
  };
  await player.load(input()); await player.play('show:1'); context.currentTime = 2;
  player.setStemVolumes('show:1', { 3: .5 });
  assert.deepEqual(calls, [['hold', 2], ['ramp', 1, 2.015], ['hold', 2], ['ramp', 1, 2.015], ['hold', 2], ['ramp', .5, 2.015]]);
  assert.equal(context.sources.length, 3); assert.equal(player.snapshot()?.status, 'playing'); await player.dispose();
});

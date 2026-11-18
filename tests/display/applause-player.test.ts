import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplausePlayer } from '../../src/display/applause-player';

function fixture() {
  const sources: { onended: (() => void) | null; stopped: boolean; buffer?: AudioBuffer }[] = [];
  const gains: { gain: { value: number } }[] = [];
  const routes: string[] = [];
  const context = {
    sampleRate: 2000,
    state: 'running',
    destination: {},
    async resume() {},
    async setSinkId(id: string) { routes.push(id); },
    createBuffer(channels: number, length: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (channel: number) => data[channel] } as unknown as AudioBuffer;
    },
    createBufferSource() {
      const source = { onended: null as (() => void) | null, stopped: false, buffer: undefined as AudioBuffer | undefined,
        connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; } };
      sources.push(source);
      return source as unknown as AudioBufferSourceNode;
    },
    createGain() {
      const gain = { gain: { value: 0 }, connect() {}, disconnect() {} };
      gains.push(gain);
      return gain as unknown as GainNode;
    },
  };
  return { player: createApplausePlayer(() => context as unknown as AudioContext), sources, gains, routes };
}

test('applause cycles through ten lengths, overlaps three clips, and uses the selected output', async () => {
  const f = fixture();
  const request = (id: string) => ({ id, volume: 0.5, outputId: 'speakers' });
  const first = await Promise.all([f.player.play(request('a')), f.player.play(request('b')), f.player.play(request('c'))]);
  assert.deepEqual(first.map(result => result.durationMs), [3000, 3500, 4000]);
  assert.deepEqual(f.routes, ['speakers']);
  assert.equal((await f.player.play(request('d'))).ok, false);
  assert.ok(f.gains.every(gain => gain.gain.value === 0.08));
  for (const source of f.sources) source.onended?.();
  const remaining: number[] = [];
  for (let index = 0; index < 8; index++) {
    const result = await f.player.play(request(String(index)));
    assert.equal(result.ok, true);
    remaining.push(result.durationMs!);
    f.sources.at(-1)!.onended?.();
  }
  assert.deepEqual(remaining, [4500, 5000, 5500, 6000, 6500, 7000, 8000, 3000]);
});

test('stopping silences active clips and an output failure does not take a slot', async () => {
  const f = fixture();
  await f.player.play({ id: 'a', volume: 1, outputId: '' });
  f.player.setVolume(0.25);
  assert.equal(f.gains[0].gain.value, 0.04);
  f.player.stop();
  assert.equal(f.gains[0].gain.value, 0);
  assert.equal(f.sources[0].stopped, true);
  assert.equal((await f.player.play({ id: 'b', volume: 1, outputId: 'new-output' })).ok, true);
});

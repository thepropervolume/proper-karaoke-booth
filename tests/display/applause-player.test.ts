import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplausePlayer } from '../../src/display/applause-player';

function fixture() {
  const sources: { onended: (() => void) | null; stopped: boolean; buffer?: AudioBuffer }[] = [];
  const gains: { gain: { value: number } }[] = [];
  const routes: string[] = [];
  const decoded: number[] = [];
  const durations = [9.096, 9.024, 4.032, 5.329, 11.184, 5.064];
  const context = {
    sampleRate: 2000,
    state: 'running',
    destination: {},
    async resume() {},
    async setSinkId(id: string) { routes.push(id); },
    async decodeAudioData(bytes: ArrayBuffer) {
      const index = new Uint8Array(bytes)[0];
      decoded.push(index);
      return { duration: durations[index] } as AudioBuffer;
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
  const recordings = durations.map((_, index) => `data:audio/mpeg;base64,${Buffer.from([index]).toString('base64')}`);
  return { player: createApplausePlayer(recordings, () => context as unknown as AudioContext), sources, gains, routes, decoded };
}

test('applause cycles through six recordings, overlaps three clips, and uses the selected output', async () => {
  const f = fixture();
  const request = (id: string) => ({ id, volume: 0.5, outputId: 'speakers' });
  const first = await Promise.all([f.player.play(request('a')), f.player.play(request('b')), f.player.play(request('c'))]);
  assert.deepEqual(first.map(result => result.durationMs), [9096, 9024, 4032]);
  assert.deepEqual(f.routes, ['speakers']);
  assert.equal((await f.player.play(request('d'))).ok, false);
  assert.deepEqual(f.gains.map(gain => gain.gain.value), [0.5 * 0.45 * 2.3, 0.5 * 0.45 * 0.82, 0.5 * 0.45 * 1.35]);
  for (const source of f.sources) source.onended?.();
  const remaining: number[] = [];
  for (let index = 0; index < 4; index++) {
    const result = await f.player.play(request(String(index)));
    assert.equal(result.ok, true);
    remaining.push(result.durationMs!);
    f.sources.at(-1)!.onended?.();
  }
  assert.deepEqual(remaining, [5329, 11184, 5064, 9096]);
  assert.deepEqual(f.decoded, [0, 1, 2, 3, 4, 5]);
});

test('stopping silences active clips and an output failure does not take a slot', async () => {
  const f = fixture();
  await f.player.play({ id: 'a', volume: 1, outputId: '' });
  f.player.setVolume(0.25);
  assert.equal(f.gains[0].gain.value, 0.25 * 0.45 * 2.3);
  f.player.stop();
  assert.equal(f.gains[0].gain.value, 0);
  assert.equal(f.sources[0].stopped, true);
  assert.equal((await f.player.play({ id: 'b', volume: 1, outputId: 'new-output' })).ok, true);
});

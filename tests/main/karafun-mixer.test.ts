import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KaraFunMixer, type ActiveKaraFunMix } from '../../src/main/karafun-mixer';

const song = (generation = 'performance-1'): ActiveKaraFunMix => ({ generation, versionId: 'karafun-song-1', stems: [
  { id: 3, role: 'lead', voice: 'Singer A' }, { id: 4, role: 'lead', voice: 'Singer B' },
  { id: 5, role: 'backing', voice: 'High' }, { id: 6, role: 'backing', voice: 'Low' },
  { id: 7, role: 'instrumental', voice: null }, { id: 8, role: 'other', voice: null },
] });

test('every supplied duet voice has an independent exact level, with no audio or private paths in host status', () => {
  const mixer = new KaraFunMixer(() => song());
  const before = mixer.status()!;
  assert.deepEqual(before.stems.map(stem => stem.volume), [0, 0, 1, 1, 1, 1]);
  assert.deepEqual(before.stems.slice(0, 2).map(stem => stem.label), ['Lead Vocals 1 · Singer A', 'Lead Vocals 2 · Singer B']);
  const after = mixer.set({ generation: before.generation, stemId: 3, volume: .75 });
  assert.deepEqual(after.stems.map(stem => stem.volume), [.75, 0, 1, 1, 1, 1]);
  assert.equal(JSON.stringify(after).includes('src'), false);
  // A caller cannot mutate the authority's next snapshot through a returned DTO.
  after.stems[0].volume = 0; assert.equal(mixer.status()!.stems[0].volume, .75);
  assert.deepEqual(mixer.set({ generation: before.generation, reset: true }), before);
});

test('mix survives republishing the same performance but resets on a new song, stop or revoked authorization', () => {
  let active: ActiveKaraFunMix | null = song(); const mixer = new KaraFunMixer(() => active);
  mixer.set({ generation: 'performance-1', stemId: 5, volume: .2 });
  active = song(); assert.equal(mixer.status()!.stems[2].volume, .2);
  active = song('performance-2'); assert.equal(mixer.status()!.stems[2].volume, 1);
  const before = mixer.status();
  assert.throws(() => mixer.set({ generation: 'performance-1', reset: true }), /song changed/);
  assert.deepEqual(mixer.status(), before);
  active = null; assert.equal(mixer.status(), null);
  assert.throws(() => mixer.set({ generation: 'performance-2', stemId: 5, volume: .5 }), /song changed/);
  active = song('performance-2'); assert.equal(mixer.status()!.stems[2].volume, 1);
});

test('invalid, excessive, unknown and stale commands are rejected atomically', () => {
  const mixer = new KaraFunMixer(() => song()); const before = mixer.status();
  for (const input of [null, [], 'reset', {}, { generation: 'old', reset: true },
    ...[-1, 1.1, NaN, Infinity, '0.5', null].map(volume => ({ generation: 'performance-1', stemId: 3, volume })),
    { generation: 'performance-1', stemId: 99, volume: .5 }, { generation: 'performance-1', stemId: '3', volume: .5 },
    { generation: 'performance-1', stemId: 3, volume: .5, path: 'ignored' },
    { generation: 'performance-1', reset: true, volume: .5 }, { generation: 'performance-1', reset: false }]) {
    assert.throws(() => mixer.set(input)); assert.deepEqual(mixer.status(), before);
  }
});

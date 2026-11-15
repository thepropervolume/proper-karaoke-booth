import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKaraFunKit, KaraFunKitError } from '../../src/domain/karafun-kit';

const encode = (value: string) => new TextEncoder().encode(value);
const xml = encode('<?xml version="1.0"?><root><files><file index="7" label="ins.ogg"/><file index="3" label="ld_A.ogg"/><file index="4" label="bv.ogg"/></files><karaoke duration="5"><kfntracks><kfntrack id="1" caption="Singer A" file_index="3"/></kfntracks><page><line><word><syllabe><start>00:00:01,000</start><end>00:00:02,000</end><text>Test lyric</text></syllabe></word></line></page></karaoke></root>');
function ogg(codec = 'vorbis'): Uint8Array {
  const packet = codec === 'vorbis' ? new Uint8Array([1, ...encode('vorbis'), ...new Uint8Array(23)]) : encode(codec === 'opus' ? 'OpusHead\x01\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00' : codec);
  const data = new Uint8Array(28 + packet.length);
  data.set(encode('OggS')); data[5] = 2; data[26] = 1; data[27] = packet.length; data.set(packet, 28);
  return data;
}
function kit(parts: [number, Uint8Array][], reserved = 0): Uint8Array {
  const ids = [...new Set(parts.map(part => part[0]))];
  const data = new Uint8Array(4 + ids.length * 5 + parts.reduce((total, [, bytes]) => total + 9 + bytes.length, 0));
  const view = new DataView(data.buffer); data.set([1, 0xce, 0xd7, ids.length]);
  let at = 4;
  for (const id of ids) { data[at] = id; view.setUint32(at + 1, parts.filter(part => part[0] === id).reduce((sum, part) => sum + part[1].length, 0)); at += 5; }
  for (const [id, bytes] of parts) { data[at] = id; view.setUint32(at + 1, bytes.length); view.setUint32(at + 5, reserved); data.set(bytes, at + 9); at += 9 + bytes.length; }
  return data;
}
function refuses(data: Uint8Array, code = 'invalid-container'): void {
  assert.throws(() => parseKaraFunKit(data), (error: unknown) => error instanceof KaraFunKitError && error.code === code);
}
test('KIT reassembles interleaved chunks by indexed ID, preserving metadata roles rather than guessing IDs', () => {
  const music = ogg(), lead = ogg('opus'), backing = ogg();
  const source = kit([[7, music.subarray(0, 10)], [1, xml.subarray(0, 80)], [3, lead], [7, music.subarray(10)], [4, backing], [1, xml.subarray(80)]]);
  const parsed = parseKaraFunKit(source);
  assert.deepEqual(parsed.stems.map(({ id, role, voice }) => ({ id, role, voice })), [
    { id: 3, role: 'lead', voice: 'Singer A' }, { id: 4, role: 'backing', voice: null }, { id: 7, role: 'instrumental', voice: null },
  ]);
  assert.deepEqual(parsed.stems[2].data, music); assert.equal(parsed.timing.durationSeconds, 5);
  source.fill(0); assert.deepEqual(parsed.stems[0].data, lead, 'the caller cannot mutate returned streams through its input');
});
test('KIT honors byte offsets and carries bounded art while ignoring uninterpreted ancillary members and reserved words', () => {
  const original = kit([[1, xml], [7, ogg()], [8, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], [9, encode('unused ancillary value')]], 0xffffffff);
  const wrapped = new Uint8Array(original.length + 6); wrapped.set(original, 3);
  const parsed = parseKaraFunKit(wrapped.subarray(3, -3));
  assert.equal(parsed.artwork[0].mimeType, 'image/png'); assert.equal(parsed.stems.length, 1);
});
test('KIT rejects every truncation, trailing garbage, inconsistent totals and duplicate/unindexed stream IDs', () => {
  const complete = kit([[1, xml], [7, ogg()]]);
  for (let length = 0; length < complete.length; length++) assert.throws(() => parseKaraFunKit(complete.subarray(0, length)), KaraFunKitError, `prefix ${length}`);
  const extra = new Uint8Array(complete.length + 1); extra.set(complete); refuses(extra);
  const duplicate = complete.slice(); duplicate[9] = duplicate[4]; refuses(duplicate);
  const high = complete.slice(); new DataView(high.buffer).setUint32(5, xml.length + 1); refuses(high);
  const low = complete.slice(); new DataView(low.buffer).setUint32(5, xml.length - 1); refuses(low);
  const unknown = complete.slice(); unknown[14] = 42; refuses(unknown);
});
test('KIT rejects a missing timing stream, malformed UTF-8/XML and an audio-free recording', () => {
  refuses(kit([[2, xml], [7, ogg()]]));
  refuses(kit([[1, new Uint8Array([0xff])], [7, ogg()]]), 'invalid-timing');
  refuses(kit([[1, encode('<root>')], [7, ogg()]]), 'invalid-timing');
  refuses(kit([[1, xml]]), 'unsupported-audio');
});
test('KIT checks declared member/chunk/total/art/audio budgets before decoding', () => {
  const source = kit([[1, xml], [7, ogg()]]);
  assert.throws(() => parseKaraFunKit(source, { bytes: source.length - 1 }), { code: 'container-limit' });
  assert.throws(() => parseKaraFunKit(source, { members: 1 }), { code: 'container-limit' });
  assert.throws(() => parseKaraFunKit(source, { chunks: 1 }), { code: 'container-limit' });
  assert.throws(() => parseKaraFunKit(source, { memberBytes: xml.length - 1 }), { code: 'container-limit' });
  assert.throws(() => parseKaraFunKit(kit([[1, xml], [7, ogg()], [4, ogg()]]), { audioMembers: 1 }), { code: 'container-limit' });
  assert.throws(() => parseKaraFunKit(kit([[1, xml], [7, ogg()], [8, new Uint8Array([255, 216, 255, 1, 2])]]), { artworkBytes: 4 }), { code: 'container-limit' });
  for (const bytes of [NaN, 0, -1, Number.MAX_SAFE_INTEGER]) assert.throws(() => parseKaraFunKit(source, { bytes }), { code: 'container-limit' });
});
test('KIT rejects unsupported Ogg codecs, malformed first pages and incomplete packets before browser decode', () => {
  refuses(kit([[1, xml], [7, ogg('theora')]]), 'unsupported-audio');
  for (const mutate of [(data: Uint8Array) => { data[4] = 1; }, (data: Uint8Array) => { data[5] = 0; }, (data: Uint8Array) => { data[26] = 255; }, (data: Uint8Array) => { data[27] = 255; }]) {
    const data = ogg(); mutate(data); refuses(kit([[1, xml], [7, data]]), 'unsupported-audio');
  }
});

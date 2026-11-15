import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeKaraFunStemLabel, parseKaraFunCue, parseKaraFunTiming } from '../../src/domain/karafun-kit-timing';

const timing = (inside: string, attributes = 'duration="20"') => `<root><files><file index="3" label="ld_duet.ogg"/></files><karaoke ${attributes}>${inside}</karaoke></root>`;
const syllable = (text = 'Hello &amp; goodbye', start = '00:00:01,250', end = '00:00:02,500') => `<syllabe><start>${start}</start><end>${end}</end><text>${text}</text></syllabe>`;
test('timing retains page layout, syllable cues/text, duet identity, fades and count-ins', () => {
  const result = parseKaraFunTiming(timing(`<kfntracks><kfntrack id="2" caption="Singer Two" file_index="3"/></kfntracks>
    <page id="5" activecolor="00AAFF" inactivecolor="#F0F0F0" isrighttoleft="1" kfntrackid="2">
      <fadeinstart>00:00:01,000</fadeinstart><fadeinduration>00:00:00,250</fadeinduration><fadeoutstart>00:00:04,000</fadeoutstart><fadeoutduration>00:00:00,500</fadeoutduration>
      <line id="7"><position x="20" y="30" width="600" height="60"/><progressivebar x="9"><start>00:00:00,500</start></progressivebar>
        <word id="1">${syllable()}</word><word id="2">${syllable('world', '00:00:02,500', '00:00:03,000')}</word></line></page>
    <silence step="00:00:00,500" count="4" activecolor="00AAFF" inactivecolor="333333" activebordercolor="FFFFFF" bordersize="2"><start>00:00:05,000</start><end>00:00:09,000</end><position x="10" y="100" width="620" height="30"/></silence>`));
  assert.equal(result.durationSeconds, 20);
  const page = result.pages[0]; assert.equal(page.voice, 'Singer Two'); assert.equal(page.trackId, 2); assert.equal(page.rightToLeft, true);
  assert.equal(page.activeColor, '#00AAFF'); assert.equal(page.startSeconds, 1); assert.equal(page.endSeconds, 4.5);
  assert.deepEqual(page.lines[0].box, { x: 20, y: 30, width: 600, height: 60 });
  assert.deepEqual(page.lines[0].leadIn, { x: 9, startSeconds: .5 });
  assert.deepEqual(page.lines[0].syllables, [ { startSeconds: 1.25, endSeconds: 2.5, text: 'Hello & goodbye' }, { startSeconds: 2.5, endSeconds: 3, text: ' world' } ]);
  assert.equal(result.countIns[0].steps, 4); assert.equal(result.countIns[0].stepSeconds, .5); assert.equal(result.countIns[0].borderWidth, 2);
});
test('timing fallback derives useful page bounds and duration, ignores nested alternate modifications', () => {
  const result = parseKaraFunTiming(timing(`<mods><karaoke duration="99"><page/></karaoke></mods><page><line><word>${syllable('Clean')}</word></line></page>`, ''));
  assert.equal(result.durationSeconds, 4.5); assert.equal(result.pages.length, 1); assert.equal(result.pages[0].startSeconds, .75); assert.equal(result.pages[0].endSeconds, 3.5);
  assert.deepEqual(result.bounds, { x: 0, y: 0, width: 640, height: 360 });
});
test('eight-digit producer colors retain RGB rather than turning an opaque lyric transparent', () => {
  const result = parseKaraFunTiming(timing('<page activecolor="FF00AA00" inactivecolor="112233FF"><line><word>' + syllable() + '</word></line></page>'));
  assert.equal(result.pages[0].activeColor, '#FF00AA'); assert.equal(result.pages[0].inactiveColor, '#112233');
});
test('timing does not infer stem roles from member numbers and sanitizes labels as text', () => {
  assert.deepEqual(describeKaraFunStemLabel('C:/arbitrary/ins.ogg'), { role: 'instrumental', voice: null });
  assert.deepEqual(describeKaraFunStemLabel('ld_Two.ogg'), { role: 'lead', voice: 'Two' });
  assert.deepEqual(describeKaraFunStemLabel('ld.ogg', 'User Caption'), { role: 'lead', voice: 'User Caption' });
  assert.deepEqual(describeKaraFunStemLabel('bv.ogg'), { role: 'backing', voice: null });
  assert.deepEqual(describeKaraFunStemLabel('unknown.ogg'), { role: 'other', voice: null });
});
test('timing rejects DTDs, external/custom entities, malformed XML, duplicate XML attributes and duplicate IDs', () => {
  for (const xml of ['<!DOCTYPE root [<!ENTITY x "expanded">]><root><karaoke duration="1">&x;</karaoke></root>', '<!DOCTYPE root SYSTEM "file:///secret"><root><karaoke duration="1"/></root>', timing('<page>&custom;</page>'), timing('<page>'), timing('<page id="1" id="2"/>'), '<root><files><file index="2" label="ins"/><file index="2" label="ld"/></files><karaoke duration="1"/></root>', timing('<kfntracks><kfntrack id="2"/><kfntrack id="2"/></kfntracks>')]) {
    assert.throws(() => parseKaraFunTiming(xml), { code: 'invalid-timing' });
  }
});
test('timing rejects invalid or nonfinite time/geometry values and backwards lyric intervals', () => {
  for (const value of ['1.25', '00:60:00,000', '00:00:60,000', '00:00:01.001', '-01:00:00,000', '999:00:00,000']) assert.throws(() => parseKaraFunCue(value), { code: 'invalid-timing' });
  assert.equal(parseKaraFunCue('00:01:02,345'), 62.345);
  for (const xml of [timing('', 'duration="NaN"'), timing('', 'duration="Infinity"'), timing('<page><line><position x="NaN" width="2" height="1"/></line></page>'), timing(`<page><line><word>${syllable('a', '00:00:03,000', '00:00:01,000')}</word></line></page>`), timing('<page activecolor="url(evil)"/>')]) assert.throws(() => parseKaraFunTiming(xml), { code: 'invalid-timing' });
});
test('timing enforces XML/node/depth/attribute/text/syllable limits without expanding entities', () => {
  const data = timing(`<page><line><word>${syllable()}</word></line></page>`);
  for (const limits of [{ xmlBytes: 20 }, { nodes: 3 }, { depth: 2 }, { textLength: 3 }]) assert.throws(() => parseKaraFunTiming(data, limits), { code: 'timing-limit' });
  assert.throws(() => parseKaraFunTiming(timing(`<page><line><word>${syllable()}${syllable()}</word></line></page>`), { syllables: 1 }), { code: 'timing-limit' });
  assert.throws(() => parseKaraFunTiming(timing('<page id="1" activecolor="FFFFFF"/>'), { attributes: 1 }), { code: 'timing-limit' });
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseLrc, type ParsedLrc } from '../../src/domain/lrc';
import { exportLrcWebVtt } from '../../src/domain/lrc-vtt';

const sheet = (cues: ParsedLrc['cues'], timing: ParsedLrc['timing'] = 'line'): ParsedLrc => ({
  metadata: {}, offsetMs: 0, timing, cues,
});

test('WebVTT follows line timing, blank gaps and the explicit media duration', () => {
  const parsed = parseLrc('[00:01.001]First\n[00:03.50]\n[00:07.00]Second\n[00:20.00]At end\n[00:21.00]After end');
  const result = exportLrcWebVtt(parsed, 20000);
  assert.equal(result.sourceTiming, 'line');
  assert.equal(result.enhancedTimingOmitted, false);
  assert.equal(result.text, 'WEBVTT\n\n00:00:01.001 --> 00:00:03.500\nFirst\n\n00:00:07.000 --> 00:00:20.000\nSecond\n\n');
});

test('a shifted cue active at zero is the latest eligible cue, not a merged earlier cue', () => {
  const parsed = parseLrc('[offset:+2000]\n[00:00.50]Earlier\n[00:01.00]Current\n[00:03.25]Next');
  assert.equal(exportLrcWebVtt(parsed, 2000).text,
    'WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nCurrent\n\n00:00:01.250 --> 00:00:02.000\nNext\n\n');
  const clear = parseLrc('[offset:+2000]\n[00:00.50]Earlier\n[00:01.00]\n[00:03.25]Next');
  assert.equal(exportLrcWebVtt(clear, 2000).text, 'WEBVTT\n\n00:00:01.250 --> 00:00:02.000\nNext\n\n');
  assert.equal(exportLrcWebVtt(parseLrc('[00:05.00]After'), 5000).text, 'WEBVTT\n\n');
});

test('simultaneous lines and duplicate timestamps retain source order without breaking blocks', () => {
  const parsed = sheet([
    { startMs: 0, lines: ['First', ''] }, { startMs: 0, lines: ['Second'] },
    { startMs: 1000, lines: [''] }, { startMs: 1500, lines: ['Again'] },
  ]);
  assert.equal(exportLrcWebVtt(parsed, 2000).text,
    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFirst\n&nbsp;\nSecond\n\n00:00:01.500 --> 00:00:02.000\nAgain\n\n');
});

test('untrusted markup and cue timing-like text are escaped while Unicode survives', () => {
  const parsed = sheet([{ startMs: 0, lines: ['<v Speaker>& text --> <script>漢字 🎵</script>', '&lt;not a tag&gt;', 'Tab\tseparated'] }]);
  assert.equal(exportLrcWebVtt(parsed, 1000).text,
    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n&lt;v Speaker&gt;&amp; text --&gt; &lt;script&gt;漢字 🎵&lt;/script&gt;\n&amp;lt;not a tag&amp;gt;\nTab\tseparated\n\n');
  for (const value of ['Injected\n\n00:00:00.000 --> 00:00:01.000', 'bad\rline', 'bad\u2028line', 'bad\u0000line', 'bad\u0008line', 'bad\ud800', 'bad\udc00']) {
    assert.throws(() => exportLrcWebVtt(sheet([{ startMs: 0, lines: [value] }]), 1000), /Invalid or excessive LRC lyric text/);
  }
});

test('enhanced marker timing stays explicit and is not fabricated into WebVTT highlighting', () => {
  const parsed = parseLrc('[00:01.00]前<00:01.20>半<00:01.50>\n[00:02.00]Plain');
  const originalParts = structuredClone(parsed.cues[0].timedParts);
  const result = exportLrcWebVtt(parsed, 3000);
  assert.equal(result.sourceTiming, 'mixed');
  assert.equal(result.enhancedTimingOmitted, true);
  assert.equal(result.text, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n前半\n\n00:00:02.000 --> 00:00:03.000\nPlain\n\n');
  assert.deepEqual(parsed.cues[0].timedParts, originalParts);
});

test('invalid duration, ordering and unbounded cue input fail before any export', () => {
  const valid = sheet([{ startMs: 0, lines: ['Safe'] }]);
  for (const duration of [0, -1, NaN, Infinity, 1000.5, 86400001]) assert.throws(() => exportLrcWebVtt(valid, duration));
  for (const cues of [
    [], [{ startMs: 100, lines: ['x'] }, { startMs: 0, lines: ['y'] }],
    [{ startMs: Infinity, lines: ['x'] }], [{ startMs: 0.5, lines: ['x'] }],
    [{ startMs: -86400001, lines: ['x'] }], [{ startMs: 172800001, lines: ['x'] }],
    [{ startMs: 0, lines: [] }], [{ startMs: 0, lines: ['x'.repeat(4097)] }],
    [{ startMs: 0, lines: ['okay'] }, { startMs: 9999, lines: ['bad\nlate'] }],
    Array.from({ length: 10001 }, (_, index) => ({ startMs: index, lines: ['x'] })),
  ]) assert.throws(() => exportLrcWebVtt(sheet(cues), 1000));
  const inconsistent = sheet([{ startMs: 0, lines: ['x'], timedParts: [[{ type: 'time', timeMs: 0 }]] }]);
  assert.throws(() => exportLrcWebVtt(inconsistent, 1000), /conflicts/);
});

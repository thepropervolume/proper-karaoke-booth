import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lyricsAt, parseLrc } from '../../src/domain/lrc';

test('timed lyrics preserve metadata, source text, multiple timestamps and simultaneous lines', () => {
  const parsed = parseLrc('\uFEFF[ar:Example Artist]\r\n[ti:Example Title]\r\n[ar:Second Artist]\r\n' +
    '[00:04.25][00:08.500] Repeated line \r\n[00:04.250]Translated line\r\n[00:06.1]\r\n' +
    '[00:02]First <b>literal</b> line\r\n[00:08.500] <script>literal text</script>');
  assert.deepEqual({ ...parsed.metadata }, { ar: ['Example Artist', 'Second Artist'], ti: ['Example Title'] });
  assert.equal(parsed.offsetMs, 0);
  assert.equal(parsed.timing, 'line');
  assert.deepEqual(parsed.cues, [
    { startMs: 2000, lines: ['First <b>literal</b> line'] },
    { startMs: 4250, lines: ['Repeated line', 'Translated line'] },
    { startMs: 6100, lines: [''] },
    { startMs: 8500, lines: ['Repeated line', '<script>literal text</script>'] },
  ]);
});

test('playback clock lookup handles boundaries, blank gaps and seeking in both directions', () => {
  const { cues } = parseLrc('[00:01.250]One\n[00:03.50]\n[00:07.000]Two');
  assert.equal(lyricsAt(cues, 0), null);
  assert.equal(lyricsAt(cues, 1.249), null);
  assert.deepEqual(lyricsAt(cues, 1.25), { startMs: 1250, lines: ['One'] });
  assert.deepEqual(lyricsAt(cues, 3.5), { startMs: 3500, lines: [''] });
  assert.deepEqual(lyricsAt(cues, 6.99), { startMs: 3500, lines: [''] });
  assert.deepEqual(lyricsAt(cues, 7), { startMs: 7000, lines: ['Two'] });
  assert.deepEqual(lyricsAt(cues, 1.26), { startMs: 1250, lines: ['One'] });
  assert.equal(lyricsAt(cues, Number.NaN), null);
  assert.equal(lyricsAt(cues, Infinity), null);
  assert.equal(lyricsAt(cues, -1), null);
  assert.equal(lyricsAt([], 0), null);
});

test('millisecond boundaries are displayed at the exact media clock time', () => {
  const { cues } = parseLrc('[00:01.001]One millisecond after one second');
  assert.equal(lyricsAt(cues, 1.000999), null);
  assert.deepEqual(lyricsAt(cues, 1.001)?.lines, ['One millisecond after one second']);
});

test('offset advances or delays cues in milliseconds without collapsing negative timestamps', () => {
  const advanced = parseLrc('[offset:+2000]\n[00:00.50]Already started\n[00:01.000]Latest before zero\n[00:03.25]Next');
  assert.equal(advanced.offsetMs, 2000);
  assert.deepEqual(advanced.cues.map(c => c.startMs), [-1500, -1000, 1250]);
  assert.deepEqual(lyricsAt(advanced.cues, 0)?.lines, ['Latest before zero']);
  assert.deepEqual(lyricsAt(advanced.cues, 1.25)?.lines, ['Next']);
  const delayed = parseLrc('[00:01.00]Words\n[offset:-250]');
  assert.equal(delayed.offsetMs, -250);
  assert.equal(delayed.cues[0].startMs, 1250);
  assert.equal(lyricsAt(delayed.cues, 1.249), null);
  assert.deepEqual(lyricsAt(delayed.cues, 1.25)?.lines, ['Words']);
});

test('malformed, unsupported and unsafe lyric inputs are rejected without returning partial cues', () => {
  for (const source of [
    '', '[ar:Metadata only]', 'An untimed lyric', '[00:10.00]Timed\nUntimed',
    '[00:60.00]Bad seconds', '[9999:00.00]Too late', '[00:00.1234]Extra precision',
    '[00:01.00][00:garbage]Words', '[00:01.00]one\n[offset:not-a-number]',
    '[offset:100]\n[offset:200]\n[00:01.00]one', '[offset:86400001]\n[00:01.00]one',
    `[00:01.00]${'x'.repeat(4097)}`, ' '.repeat(1024 * 1024 + 1),
    Array.from({ length: 10001 }, () => '[00:01.00]line').join('\n'),
  ]) assert.throws(() => parseLrc(source), Error, `Expected a rejection for ${source.slice(0, 40)}`);
  assert.throws(() => parseLrc('[00:01.00]Word<00:01.10'), /Invalid enhanced LRC timestamp/);
  assert.throws(() => parseLrc('[00:01.00]Word<00:01.1234>'), /Invalid enhanced LRC timestamp/);
  assert.throws(() => parseLrc('[00:01.00]Word<00:60.10>'), /out of order or range/);
  assert.throws(() => parseLrc('[00:02.00]Word<00:01.50>'), /out of order or range/);
  assert.throws(() => parseLrc('[00:01.00]Word<00:03.00>more<00:02.00>'), /out of order or range/);
  assert.throws(() => parseLrc('[00:01.00][00:02.00]Word<00:02.50>'), /ambiguous multiple line timestamps/);
});

test('enhanced lyric markers retain exact ordered text and time without guessing boundary meanings', () => {
  const parsed = parseLrc('[offset:+500]\n[00:01.00]  前<00:01.20>半  🎵<00:01.750>\n' +
    '[00:01.000]<00:01.000>Second <00:01.25>line\n[00:03.00]\n[00:04.00]Plain line');
  assert.equal(parsed.timing, 'mixed');
  assert.deepEqual(parsed.cues, [
    { startMs: 500, lines: ['前半  🎵', 'Second line'], timedParts: [
      [ { type: 'text', text: '  前' }, { type: 'time', timeMs: 700 }, { type: 'text', text: '半  🎵' }, { type: 'time', timeMs: 1250 } ],
      [ { type: 'time', timeMs: 500 }, { type: 'text', text: 'Second ' }, { type: 'time', timeMs: 750 }, { type: 'text', text: 'line' } ],
    ] },
    { startMs: 2500, lines: [''] },
    { startMs: 3500, lines: ['Plain line'] },
  ]);
  assert.deepEqual(lyricsAt(parsed.cues, .5)?.lines, ['前半  🎵', 'Second line']);
  assert.deepEqual(lyricsAt(parsed.cues, 3)?.lines, ['']);
});

test('enhanced and plain simultaneous lyric rows stay aligned, including negative adjusted times', () => {
  const parsed = parseLrc('[offset:+2000]\n[00:01.00]Plain\n[00:01.00] A<00:01.3>B<00:02.000>\n[00:01.00]More');
  assert.equal(parsed.timing, 'mixed');
  assert.deepEqual(parsed.cues[0].lines, ['Plain', 'AB', 'More']);
  assert.deepEqual(parsed.cues[0].timedParts, [null, [
    { type: 'text', text: ' A' }, { type: 'time', timeMs: -700 }, { type: 'text', text: 'B' }, { type: 'time', timeMs: 0 },
  ], null]);
  assert.equal(lyricsAt(parsed.cues, 0), parsed.cues[0]);
  assert.equal(parseLrc('[00:01.00]Word<00:01.10>').timing, 'enhanced');
});

test('enhanced markers overlapping the next line remain available without guessing word synchronization', () => {
  const parsed = parseLrc('[00:01.00]First<00:03.00>finish\n[00:02.00]Second<00:02.50>finish');
  assert.deepEqual(parsed.cues[0].timedParts, [[
    { type: 'text', text: 'First' }, { type: 'time', timeMs: 3000 }, { type: 'text', text: 'finish' },
  ]]);
  assert.deepEqual(parsed.cues[1].timedParts, [[
    { type: 'text', text: 'Second' }, { type: 'time', timeMs: 2500 }, { type: 'text', text: 'finish' },
  ]]);
  // Line lookup intentionally selects the latest cue; it does not interpret
  // markers as word starts/ends or discard markers from the earlier line.
  assert.deepEqual(lyricsAt(parsed.cues, 2.25)?.lines, ['Secondfinish']);
  assert.deepEqual(parsed.cues[0].timedParts?.[0]?.[1], { type: 'time', timeMs: 3000 });
});

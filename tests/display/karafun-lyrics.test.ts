import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { appearanceFontStack } from '../../src/domain/appearance-font';
import type { KaraFunTiming } from '../../src/domain/karafun-kit-timing';
import { karaFunLyricFrame, paintKaraFunLyrics } from '../../src/display/karafun-lyrics';

const timing = (): KaraFunTiming => ({ durationSeconds: 12, bounds: { x: 0, y: 0, width: 640, height: 360 }, rightToLeft: false, tracks: [], files: [],
  pages: [{ id: 1, startSeconds: 0, endSeconds: 10, fadeIn: { startSeconds: 0, durationSeconds: 2 }, fadeOut: { startSeconds: 8, durationSeconds: 2 },
    activeColor: '#00FFFF', inactiveColor: '#FFFFFF', rightToLeft: false, trackId: null, voice: null,
    lines: [{ id: 1, box: { x: 100, y: 200, width: 300, height: 40 }, leadIn: null, words: [], syllables: [
      { startSeconds: 1, endSeconds: 3, text: 'Hel' }, { startSeconds: 3, endSeconds: 4, text: 'lo' },
    ] }],
  }],
  countIns: [{ startSeconds: 4, endSeconds: 8, stepSeconds: 1, steps: 4, box: { x: 200, y: 300, width: 100, height: 10 },
    activeColor: '#00FFFF', inactiveColor: '#FFFFFF', activeBorderColor: '#000000', inactiveBorderColor: '#000000', borderWidth: 1 }],
});

class FakeContext {
  globalAlpha = 1; direction = 'ltr'; textAlign = 'left'; textBaseline = ''; lineJoin = ''; lineWidth = 1;
  font = ''; strokeStyle = ''; fillStyle = '';
  draws: { text: string; x: number; y: number; color: string; alpha: number; direction: string }[] = [];
  clips: number[][] = []; transforms: number[][] = []; clears: number[][] = []; bars: { color: string; args: number[] }[] = [];
  stack: { alpha: number; fill: string; stroke: string }[] = [];
  setTransform(...args: number[]) { this.transforms.push(args); }
  clearRect(...args: number[]) { this.clears.push(args); }
  save() { this.stack.push({ alpha: this.globalAlpha, fill: this.fillStyle, stroke: this.strokeStyle }); }
  restore() { const state = this.stack.pop()!; this.globalAlpha = state.alpha; this.fillStyle = state.fill; this.strokeStyle = state.stroke; }
  measureText(text: string) { return { width: text.length * 10 }; }
  strokeText(_text: string, _x: number, _y: number) {}
  fillText(text: string, x: number, y: number) { this.draws.push({ text, x, y, color: this.fillStyle, alpha: this.globalAlpha, direction: this.direction }); }
  beginPath() {} rect(...args: number[]) { this.clips.push(args); } clip() {}
  fillRect(...args: number[]) { this.bars.push({ color: this.fillStyle, args }); }
  strokeRect(..._args: number[]) {}
}
function canvas() { const context = new FakeContext(); const element = { width: 640, height: 360, clientWidth: 640, clientHeight: 360, getContext: () => context }; return { context, element: element as unknown as HTMLCanvasElement }; }

test('lyrics visibility, fades and count-ins derive only from absolute clock, including reverse seeks', () => {
  const value = timing();
  assert.equal(karaFunLyricFrame(value, 1).pages[0].opacity, .5);
  assert.equal(karaFunLyricFrame(value, 5).pages[0].opacity, 1);
  assert.equal(karaFunLyricFrame(value, 9).pages[0].opacity, .5);
  assert.equal(karaFunLyricFrame(value, 10).pages.length, 0);
  assert.equal(karaFunLyricFrame(value, 5).countIns[0].progress, .25);
  assert.equal(karaFunLyricFrame(value, 8).countIns.length, 0);
  assert.equal(karaFunLyricFrame(value, 1).pages[0].opacity, .5);
  assert.deepEqual(karaFunLyricFrame(value, NaN), { pages: [], countIns: [] });
  assert.deepEqual(karaFunLyricFrame(value, -1), { pages: [], countIns: [] });
});

test('canvas draws literal provider text and clips progressive highlight at the current syllable fraction', () => {
  const { context, element } = canvas();
  paintKaraFunLyrics(element, timing(), 2, { pixelRatio: 1 });
  assert.deepEqual(context.draws.map(draw => [draw.text, draw.color]), [['Hello', '#FFFFFF'], ['Hello', '#d5167a']]);
  assert.equal(context.clips.length, 1); assert.equal(context.clips[0][2], 15);
  const text = timing(); text.pages[0].lines[0].syllables = [{ startSeconds: 1, endSeconds: 3, text: '<script> & "' }];
  paintKaraFunLyrics(element, text, 2, { pixelRatio: 1 });
  assert.equal(context.draws.at(-1)?.text, '<script> & "');
  assert.equal(context.stack.length, 0);
});

test('native lyrics use the selected font and restore their established default', () => {
  const { context, element } = canvas();
  paintKaraFunLyrics(element, timing(), 2, { pixelRatio: 1, fontFamily: appearanceFontStack('serif') });
  assert.equal(context.font, '700 32px Georgia, "Times New Roman", serif');
  paintKaraFunLyrics(element, timing(), 2, { pixelRatio: 1, fontFamily: appearanceFontStack('default') });
  assert.equal(context.font, '700 32px Arial, sans-serif');
});

test('reverse seek removes later highlights and RTL clips from the right edge', () => {
  const { context, element } = canvas(), value = timing();
  paintKaraFunLyrics(element, value, 3.5, { pixelRatio: 1 }); assert.equal(context.clips.length, 2);
  context.clips = []; context.draws = [];
  paintKaraFunLyrics(element, value, .5, { pixelRatio: 1 }); assert.equal(context.clips.length, 0); assert.equal(context.draws.length, 1);
  value.pages[0].rightToLeft = true; context.clips = []; context.draws = [];
  paintKaraFunLyrics(element, value, 2, { pixelRatio: 1 });
  assert.equal(context.draws[0].direction, 'rtl');
  assert.equal(context.clips[0][0], context.draws[0].x - 15);
});

test('high-DPI canvas contains its original aspect ratio and clears the old frame', () => {
  const { context, element } = canvas();
  paintKaraFunLyrics(element, timing(), 2, { width: 900, height: 900, pixelRatio: 2 });
  assert.equal(element.width, 1800); assert.equal(element.height, 1800);
  assert.deepEqual(context.clears[0], [0, 0, 1800, 1800]);
  assert.deepEqual(context.transforms[1], [2.8125, 0, 0, 2.8125, 0, 393.75]);
  context.draws = [];
  paintKaraFunLyrics(element, timing(), 11, { width: 900, height: 900, pixelRatio: 2 });
  assert.equal(context.draws.length, 0); assert.equal(context.clears.length, 2);
});

test('count-in boxes advance with song time and remain within their supplied bounds', () => {
  const { context, element } = canvas();
  paintKaraFunLyrics(element, timing(), 5, { pixelRatio: 1 });
  assert.equal(context.bars.length, 4);
  assert.deepEqual(context.bars.map(bar => bar.color), ['#d5167a', '#FFFFFF', '#FFFFFF', '#FFFFFF']);
  assert.ok(context.bars.every(bar => bar.args[0] >= 200 && bar.args[0] + bar.args[2] <= 300));
});

test('the primary singer uses KaraFun pink while another singer retains their provider color', () => {
  const { context, element } = canvas(), value = timing(), page = value.pages[0];
  value.tracks = [{ id: 7, caption: 'Primary', fileIndex: null }, { id: 42, caption: 'Second', fileIndex: null }];
  // The second singer can begin first; declared track order defines the primary.
  value.pages = [{ ...page, id: 2, trackId: 42, voice: 'Second', activeColor: '#007bff' },
    { ...page, trackId: 7, voice: 'Primary', activeColor: '#AADD66' }];
  value.countIns = [];
  paintKaraFunLyrics(element, value, 2, { pixelRatio: 1 });
  assert.deepEqual(context.draws.map(draw => draw.color), ['#FFFFFF', '#007bff', '#FFFFFF', '#d5167a']);
});

test('unidentified older duet pages keep distinct secondary colors and lead-in bars follow the primary color', () => {
  const { context, element } = canvas(), value = timing(), page = value.pages[0];
  page.lines[0].leadIn = { x: 50, startSeconds: 0 };
  value.pages.push({ ...page, id: 2, activeColor: '#007bff' }); value.countIns = [];
  paintKaraFunLyrics(element, value, .5, { pixelRatio: 1 });
  assert.deepEqual(context.bars.map(bar => bar.color), ['#d5167a', '#007bff']);
});

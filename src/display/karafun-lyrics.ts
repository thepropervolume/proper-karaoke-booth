import type { KaraFunCountIn, KaraFunLine, KaraFunPage, KaraFunTiming } from '../domain/karafun-kit-timing';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export type KaraFunLyricFrame = {
  pages: { page: KaraFunPage; opacity: number }[];
  countIns: { cue: KaraFunCountIn; progress: number }[];
};

/** Derive every visual from the shared audio position, including backward seeks. */
export function karaFunLyricFrame(timing: KaraFunTiming, position: number): KaraFunLyricFrame {
  if (!Number.isFinite(position) || position < 0) return { pages: [], countIns: [] };
  return {
    pages: timing.pages.filter(page => position >= page.startSeconds && position < page.endSeconds).map(page => {
      const fadeIn = page.fadeIn.durationSeconds > 0 ? clamp((position - page.fadeIn.startSeconds) / page.fadeIn.durationSeconds) : 1;
      const fadeOut = page.fadeOut.durationSeconds > 0 ? 1 - clamp((position - page.fadeOut.startSeconds) / page.fadeOut.durationSeconds) : 1;
      return { page, opacity: Math.min(fadeIn, fadeOut) };
    }),
    countIns: timing.countIns.filter(cue => position >= cue.startSeconds && position < cue.endSeconds).map(cue => ({
      cue, progress: clamp((position - cue.startSeconds) / (cue.stepSeconds > 0 && cue.steps > 0 ? cue.stepSeconds * cue.steps : cue.endSeconds - cue.startSeconds)),
    })),
  };
}

export type KaraFunLyricsOptions = {
  width?: number; height?: number; pixelRatio?: number; fontFamily?: string;
  activeColor?: string; inactiveColor?: string; outlineColor?: string;
};

function paintLine(context: CanvasRenderingContext2D, line: KaraFunLine, page: KaraFunPage, lineIndex: number,
  timing: KaraFunTiming, position: number, options: KaraFunLyricsOptions): void {
  const box = line.box ?? { x: timing.bounds.width * .05, y: timing.bounds.height * (.58 + lineIndex * .12), width: timing.bounds.width * .9, height: timing.bounds.height * .11 };
  const text = line.syllables.map(syllable => syllable.text).join('');
  if (!text || box.width <= 0 || box.height <= 0) return;
  const rtl = page.rightToLeft, family = options.fontFamily || 'Arial, sans-serif';
  let size = box.height * .8;
  context.font = `700 ${size}px ${family}`;
  let measured = context.measureText(text).width;
  if (measured > box.width) { size *= box.width / measured; context.font = `700 ${size}px ${family}`; measured = context.measureText(text).width; }
  const x = box.x + box.width / 2 + (rtl ? measured / 2 : -measured / 2), y = box.y + box.height / 2;
  context.direction = rtl ? 'rtl' : 'ltr'; context.textAlign = rtl ? 'right' : 'left'; context.textBaseline = 'middle';
  context.lineJoin = 'round'; context.lineWidth = Math.max(1, size * .085);
  context.strokeStyle = options.outlineColor || '#101020';
  context.strokeText(text, x, y);
  context.fillStyle = page.inactiveColor || options.inactiveColor || '#FFFFF3'; context.fillText(text, x, y);
  context.fillStyle = page.activeColor || options.activeColor || '#0EB7FF';
  let before = '';
  for (const syllable of line.syllables) {
    const priorWidth = context.measureText(before).width;
    before += syllable.text;
    const nextWidth = context.measureText(before).width;
    const progress = position < syllable.startSeconds ? 0 : syllable.endSeconds <= syllable.startSeconds ? 1 : clamp((position - syllable.startSeconds) / (syllable.endSeconds - syllable.startSeconds));
    if (!progress) continue;
    const width = Math.max(0, nextWidth - priorWidth) * progress;
    if (!width) continue;
    context.save(); context.beginPath();
    context.rect(rtl ? x - priorWidth - width : x + priorWidth, box.y - size * .15, width, box.height + size * .3);
    context.clip(); context.fillText(text, x, y); context.restore();
  }
  if (line.leadIn && position < (line.syllables[0]?.startSeconds ?? 0) && position >= line.leadIn.startSeconds) {
    const duration = (line.syllables[0]?.startSeconds ?? 0) - line.leadIn.startSeconds;
    if (duration > 0) {
      const progress = clamp((position - line.leadIn.startSeconds) / duration);
      context.fillStyle = page.activeColor || options.activeColor || '#0EB7FF';
      const left = Math.min(line.leadIn.x, box.x), width = Math.max(0, box.x - left);
      context.fillRect(left, box.y + box.height * .85, width * progress, Math.max(2, size * .06));
    }
  }
}

/** Draw provider text as canvas text only; no provider markup enters the DOM. */
export function paintKaraFunLyrics(canvas: HTMLCanvasElement, timing: KaraFunTiming, position: number,
  options: KaraFunLyricsOptions = {}): void {
  const width = Math.max(1, Math.min(8192, options.width ?? (canvas.clientWidth || canvas.width || 640)));
  const height = Math.max(1, Math.min(8192, options.height ?? (canvas.clientHeight || canvas.height || 360)));
  const ratio = Math.max(1, Math.min(2, options.pixelRatio ?? (globalThis.devicePixelRatio || 1)));
  const bitmapWidth = Math.round(width * ratio), bitmapHeight = Math.round(height * ratio);
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  const context = canvas.getContext('2d'); if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(width / timing.bounds.width, height / timing.bounds.height);
  context.setTransform(scale * ratio, 0, 0, scale * ratio,
    (width - timing.bounds.width * scale) / 2 * ratio - timing.bounds.x * scale * ratio,
    (height - timing.bounds.height * scale) / 2 * ratio - timing.bounds.y * scale * ratio);
  context.save();
  const frame = karaFunLyricFrame(timing, position);
  for (const { page, opacity } of frame.pages) {
    context.globalAlpha = opacity;
    for (let index = 0; index < page.lines.length; index++) paintLine(context, page.lines[index], page, index, timing, position, options);
  }
  context.globalAlpha = 1;
  for (const { cue, progress } of frame.countIns) {
    const box = cue.box ?? { x: timing.bounds.width * .3, y: timing.bounds.height * .8, width: timing.bounds.width * .4, height: timing.bounds.height * .06 };
    const steps = Math.max(1, Math.min(32, cue.steps || 4)), gap = box.width / steps * .18, stepWidth = box.width / steps;
    for (let index = 0; index < steps; index++) {
      const active = progress * steps >= index + 1;
      context.fillStyle = (active ? cue.activeColor : cue.inactiveColor) || (active ? options.activeColor || '#0EB7FF' : options.inactiveColor || '#FFFFF3');
      context.fillRect(box.x + index * stepWidth + gap / 2, box.y, Math.max(0, stepWidth - gap), box.height);
      if (cue.borderWidth > 0) {
        context.strokeStyle = (active ? cue.activeBorderColor : cue.inactiveBorderColor) || options.outlineColor || '#101020';
        context.lineWidth = cue.borderWidth; context.strokeRect(box.x + index * stepWidth + gap / 2, box.y, Math.max(0, stepWidth - gap), box.height);
      }
    }
  }
  context.restore();
}

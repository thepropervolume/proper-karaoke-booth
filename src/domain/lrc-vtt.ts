import type { LrcCue, ParsedLrc } from './lrc';

export type LrcWebVtt = {
  text: string;
  sourceTiming: ParsedLrc['timing'];
  /** Enhanced markers are retained by the parser but omitted from this line-level export. */
  enhancedTimingOmitted: boolean;
};

// Match parser limits: raw timestamps and offsets may each reach 24 hours.
const MAX_TIME_MS = 24 * 60 * 60 * 1000;
const MAX_CUE_GROUPS = 10000;
const MAX_LINES = 10000;
const MAX_LINE_CHARS = 4096;
const MAX_TEXT_CHARS = 1024 * 1024;
const MAX_PARTS = 100000;

function validText(value: unknown): value is string {
  // Horizontal tab is valid WebVTT text; other C0 controls, line breaks,
  // C1 controls and Unicode line/paragraph separators are not accepted.
  if (typeof value !== 'string' || value.length > MAX_LINE_CHARS || /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) return false;
  // Reject isolated UTF-16 surrogate halves rather than silently replacing them
  // when this string is encoded as UTF-8 by an eventual file or transport.
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}
function validStart(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -MAX_TIME_MS && value <= 2 * MAX_TIME_MS;
}
function clock(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
function escapeCueText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Export line-level WebVTT from already parsed, media-clock-adjusted LRC cues.
 * mediaDurationMs must be the explicit bounded duration of the actual media,
 * as a positive whole number of milliseconds. A caller converting fractional
 * media seconds should round down so that an exported cue never outlives it.
 *
 * A clear cue ends the preceding display interval but emits no empty VTT cue.
 * Empty rows simultaneous with text use the standard &nbsp; escape: WebVTT
 * cannot express an empty payload line because it terminates the cue block.
 * Enhanced markers are deliberately omitted; this is not word highlighting.
 */
export function exportLrcWebVtt(parsed: ParsedLrc, mediaDurationMs: number): LrcWebVtt {
  if (!Number.isSafeInteger(mediaDurationMs) || mediaDurationMs <= 0 || mediaDurationMs > MAX_TIME_MS)
    throw new Error('The media duration must be a positive whole number of milliseconds within 24 hours.');
  if (!parsed || !['line', 'enhanced', 'mixed'].includes(parsed.timing) || !Array.isArray(parsed.cues) || parsed.cues.length < 1 || parsed.cues.length > MAX_CUE_GROUPS)
    throw new Error('Invalid or excessive LRC cues.');

  const groups: { startMs: number; lines: string[] }[] = [];
  let previousStart = -Infinity, lineCount = 0, textChars = 0, partChars = 0, partCount = 0, hasEnhanced = false, hasPlainLyrics = false;
  for (const cue of parsed.cues as readonly LrcCue[]) {
    if (!cue || !validStart(cue.startMs) || cue.startMs < previousStart || !Array.isArray(cue.lines) || !cue.lines.length)
      throw new Error('Invalid, unbounded or unsorted LRC cue.');
    previousStart = cue.startMs;
    if (cue.timedParts !== undefined && (!Array.isArray(cue.timedParts) || cue.timedParts.length !== cue.lines.length))
      throw new Error('Invalid enhanced LRC timing.');
    for (let index = 0; index < cue.lines.length; index++) {
      const line = cue.lines[index];
      if (!validText(line) || ++lineCount > MAX_LINES || (textChars += line.length) > MAX_TEXT_CHARS)
        throw new Error('Invalid or excessive LRC lyric text.');
      const parts = cue.timedParts?.[index];
      if (cue.timedParts !== undefined && parts === undefined) throw new Error('Invalid enhanced LRC timing.');
      if (parts !== null && parts !== undefined) {
        if (!Array.isArray(parts) || !parts.length) throw new Error('Invalid enhanced LRC timing.');
        hasEnhanced = true;
        let previousMarker = cue.startMs;
        for (const part of parts) {
          if (++partCount > MAX_PARTS || !part || typeof part !== 'object') throw new Error('Invalid or excessive enhanced LRC timing.');
          if (part.type === 'time') {
            if (!validStart(part.timeMs) || part.timeMs < previousMarker) throw new Error('Invalid enhanced LRC timestamp.');
            previousMarker = part.timeMs;
          } else if (part.type === 'text') {
            if (!validText(part.text) || (partChars += part.text.length) > MAX_TEXT_CHARS) throw new Error('Invalid enhanced LRC text.');
          } else throw new Error('Invalid enhanced LRC timing.');
        }
      } else if (line.trim()) hasPlainLyrics = true;
    }
    const existing = groups.at(-1);
    if (existing?.startMs === cue.startMs) existing.lines.push(...cue.lines);
    else groups.push({ startMs: cue.startMs, lines: [...cue.lines] });
  }
  if ((parsed.timing === 'line' && hasEnhanced) ||
      (parsed.timing === 'enhanced' && (!hasEnhanced || hasPlainLyrics)) ||
      (parsed.timing === 'mixed' && (!hasEnhanced || !hasPlainLyrics)))
    throw new Error('Enhanced timing conflicts with the LRC capability.');

  // Of cues at or before zero, only the latest timestamp is active when media
  // begins. Equal timestamps were grouped above in their original order.
  let first = 0;
  while (first + 1 < groups.length && groups[first + 1].startMs <= 0) first++;
  const blocks: string[] = [];
  for (let index = first; index < groups.length; index++) {
    const cue = groups[index];
    if (cue.startMs >= mediaDurationMs) break;
    const start = Math.max(0, cue.startMs);
    const end = Math.min(mediaDurationMs, groups[index + 1]?.startMs ?? mediaDurationMs);
    if (end <= start || cue.lines.every(line => !line.trim())) continue;
    const lines = cue.lines.map(line => line.trim() ? escapeCueText(line) : '&nbsp;');
    blocks.push(`${clock(start)} --> ${clock(end)}\n${lines.join('\n')}`);
  }
  return { text: `WEBVTT\n\n${blocks.length ? `${blocks.join('\n\n')}\n\n` : ''}`,
    sourceTiming: parsed.timing, enhancedTimingOmitted: parsed.timing !== 'line' || hasEnhanced };
}

/** A marker is preserved as a timestamp, without deciding whether it starts or ends a word. */
export type LrcTimedPart = { type: 'text'; text: string } | { type: 'time'; timeMs: number };
/** A timestamped group. Text is plain text, never markup; an empty line is a clear cue. */
export type LrcCue = { startMs: number; lines: string[]; timedParts?: (LrcTimedPart[] | null)[] };
export type ParsedLrc = { metadata: Record<string, string[]>; offsetMs: number; timing: 'line' | 'enhanced' | 'mixed'; cues: LrcCue[] };

// These bounds constrain parsing work, not the maximum supported song duration.
// File importers must also bound bytes before decoding the file.
const MAX_SOURCE_CHARS = 1024 * 1024;
const MAX_LINE_CHARS = 4096;
const MAX_CUES = 10000;
const MAX_TIME_MS = 24 * 60 * 60 * 1000;

/**
 * Parse line-synchronized LRC text. A positive [offset] advances lyrics, so
 * 1000 ms is subtracted from each timestamp for [offset:+1000]. This follows
 * FFmpeg's timestamp-minus-offset convention; a local ffprobe rehearsal with
 * [offset:500] and [00:02.00] produced 1.500 seconds. Other LRC tools can
 * disagree about offset signs: verify producer files before
 * relying on this convention. Negative adjusted timestamps are retained so
 * cues before the start do not collapse into a single simultaneous group.
 *
 * Bare untagged words and malformed timing are rejected. Enhanced inline
 * markers are kept in source order without assigning start/end semantics.
 * Plain lyric text, including HTML-like text, is never interpreted.
 */
export function parseLrc(input: string): ParsedLrc {
  if (typeof input !== 'string' || input.length > MAX_SOURCE_CHARS) throw new Error('LRC text is missing or exceeds the size limit.');
  const metadata: Record<string, string[]> = Object.create(null);
  const entries: { startMs: number; text: string; parts: LrcTimedPart[] | null; sequence: number }[] = [];
  let offsetMs = 0, offsetSeen = false;
  let hasEnhanced = false, hasPlainLyrics = false;
  const source = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const lines = source.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];
    if (line.length > MAX_LINE_CHARS) throw new Error(`LRC line ${lineNumber} exceeds the length limit.`);
    if (!line.trim()) continue;
    const trimmed = line.trimStart();
    const metadataMatch = /^\[([a-z][a-z0-9_-]*):([^\]]*)\]\s*$/i.exec(trimmed);
    if (metadataMatch) {
      const key = metadataMatch[1].toLowerCase();
      const value = metadataMatch[2].trim();
      if (key === 'offset') {
        if (offsetSeen || !/^[+-]?\d+$/.test(value)) throw new Error(`Invalid or repeated LRC offset on line ${lineNumber}.`);
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > MAX_TIME_MS) throw new Error(`LRC offset on line ${lineNumber} exceeds the limit.`);
        offsetMs = parsed;
        offsetSeen = true;
      } else {
        (metadata[key] ??= []).push(value);
      }
      continue;
    }
    let remaining = trimmed;
    const times: number[] = [];
    while (remaining.startsWith('[')) {
      const match = /^\[(\d{1,4}):(\d{2})(?:\.(\d{1,3}))?\]/.exec(remaining);
      if (!match) {
        // Bracketed plain words can be part of a lyric, but a numeric or
        // metadata-like tag here must not silently become untimed text.
        if (!times.length || /^\[(?:\d|[a-z][a-z0-9_-]*:)/i.test(remaining)) throw new Error(`Invalid LRC timestamp on line ${lineNumber}.`);
        break;
      }
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? '').padEnd(3, '0'));
      const startMs = Number(match[1]) * 60000 + seconds * 1000 + fraction;
      if (seconds >= 60 || startMs > MAX_TIME_MS) throw new Error(`LRC timestamp on line ${lineNumber} is out of range.`);
      times.push(startMs);
      if (entries.length + times.length > MAX_CUES) throw new Error('LRC has too many timestamped lines.');
      remaining = remaining.slice(match[0].length);
      // Spaces between multiple leading timestamps are permitted; preserve
      // lyric whitespace except the separator before the first lyric.
      if (/^\s+\[\d/.test(remaining)) remaining = remaining.trimStart();
    }
    if (!times.length) throw new Error(`LRC line ${lineNumber} has no timestamp.`);
    let text = remaining.trim();
    let parts: LrcTimedPart[] | null = null;
    if (/<\d+:/.test(remaining)) {
      if (times.length !== 1) throw new Error(`Enhanced LRC on line ${lineNumber} has ambiguous multiple line timestamps.`);
      parts = [];
      let position = 0, lastTime = times[0];
      while (position < remaining.length) {
        const marker = /<\d+:/.exec(remaining.slice(position));
        if (!marker) { parts.push({ type: 'text', text: remaining.slice(position) }); break; }
        const markerAt = position + marker.index;
        if (markerAt > position) parts.push({ type: 'text', text: remaining.slice(position, markerAt) });
        const tag = /^<(\d{1,4}):(\d{2})(?:\.(\d{1,3}))?>/.exec(remaining.slice(markerAt));
        if (!tag) throw new Error(`Invalid enhanced LRC timestamp on line ${lineNumber}.`);
        const seconds = Number(tag[2]);
        const timeMs = Number(tag[1]) * 60000 + seconds * 1000 + Number((tag[3] ?? '').padEnd(3, '0'));
        if (seconds >= 60 || timeMs > MAX_TIME_MS || timeMs < lastTime) throw new Error(`Enhanced LRC timestamp on line ${lineNumber} is out of order or range.`);
        parts.push({ type: 'time', timeMs });
        lastTime = timeMs;
        position = markerAt + tag[0].length;
      }
      text = parts.filter((part): part is Extract<LrcTimedPart, { type: 'text' }> => part.type === 'text').map(part => part.text).join('').trim();
      hasEnhanced = true;
    } else if (text) hasPlainLyrics = true;
    for (const startMs of times) entries.push({ startMs, text, parts, sequence: entries.length });
  }
  if (!entries.length) throw new Error('LRC contains no timed lyric lines.');
  entries.sort((a, b) => a.startMs - b.startMs || a.sequence - b.sequence);
  const cues: LrcCue[] = [];
  for (const entry of entries) {
    const startMs = entry.startMs - offsetMs;
    const previous = cues.at(-1);
    const shiftedParts = entry.parts?.map(part => part.type === 'time' ? { ...part, timeMs: part.timeMs - offsetMs } : part) ?? null;
    if (previous?.startMs === startMs) {
      previous.lines.push(entry.text);
      if (previous.timedParts) previous.timedParts.push(shiftedParts);
      else if (shiftedParts) previous.timedParts = [...Array(previous.lines.length - 1).fill(null), shiftedParts];
    } else cues.push(shiftedParts ? { startMs, lines: [entry.text], timedParts: [shiftedParts] } : { startMs, lines: [entry.text] });
  }
  return { metadata, offsetMs, timing: hasEnhanced ? (hasPlainLyrics ? 'mixed' : 'enhanced') : 'line', cues };
}

/** Return the latest line-level cue at the media engine's clock, in seconds.
 * Call after clock ticks and seeks; a cue containing only empty lines clears
 * the display. Returns null before the first cue or for an invalid clock.
 * Markers may extend beyond the next line cue; no word synchronization or
 * marker-to-word boundary semantics are inferred by this line lookup. */
export function lyricsAt(cues: readonly LrcCue[], mediaTimeSeconds: number): LrcCue | null {
  if (!Number.isFinite(mediaTimeSeconds) || mediaTimeSeconds < 0) return null;
  let low = 0, high = cues.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    // Compare in clock seconds. Multiplying 1.001 by 1000 can yield
    // 1000.9999999999999, incorrectly delaying a cue at exactly 1001 ms.
    if (cues[middle].startMs / 1000 <= mediaTimeSeconds) low = middle + 1;
    else high = middle;
  }
  return low ? cues[low - 1] : null;
}

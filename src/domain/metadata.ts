export type MetadataFormat = 'artist-title' | 'title-artist' | 'filename';
type Field = 'artist' | 'title' | 'djCode' | 'trackNumber';
/** An unnamed field consumes an unused/custom placeholder without storing it. */
type Part = { literal: string } | { field: Field | undefined };
type Fields = Partial<Record<Field, string>>;

export type ParsedMetadata = {
  title: string;
  artist: string;
  djCode?: string;
  trackNumber?: string;
  /** The first matching template wins; null indicates legacy fallback. */
  matchedTemplate: string | null;
  /** True if another parsing or a lower-priority template yields different metadata. */
  ambiguous: boolean;
};

/** Preserves the original filename-only behavior for existing settings. */
export function metadataFromFilename(stem: string, format: MetadataFormat): { title: string; artist: string } {
  const label = stem.trim();
  const split = label.indexOf(' - ');
  if (format === 'filename' || split <= 0 || !label.slice(split + 3).trim()) return { title: label, artist: '' };
  const first = label.slice(0, split).trim();
  const second = label.slice(split + 3).trim();
  return format === 'title-artist' ? { title: first, artist: second } : { title: second, artist: first };
}

function fieldName(name: string): Field | undefined {
  switch (name.replace(/[\s_-]/g, '').toLowerCase()) {
    case 'artist': return 'artist';
    case 'title': case 'track': case 'trackname': return 'title';
    case 'djcode': return 'djCode';
    case 'tracknumber': return 'trackNumber';
    default: return undefined;
  }
}

function compileTemplate(template: string): Part[] {
  if (!template || template.length > 512 || template !== template.trim() || template.includes('\\'))
    throw new Error('Each template must be 1–512 characters, without surrounding whitespace or backslashes. Use / between folders.');
  // MP4 is the supported input format; templates may include or omit its extension.
  const pattern = template.replace(/\.mp4$/i, '');
  const parts: Part[] = [];
  let hasTitle = false;
  let index = 0;
  while (index < pattern.length) {
    const open = pattern.indexOf('{', index);
    if (open < 0) {
      const literal = pattern.slice(index);
      if (literal.includes('}')) throw new Error('Unmatched brace in metadata template.');
      if (literal) parts.push({ literal });
      break;
    }
    // Both ${Artist} and {Artist} denote a field; $ is not a literal prefix.
    const literal = pattern.slice(index, open > index && pattern[open - 1] === '$' ? open - 1 : open);
    if (literal.includes('}')) throw new Error('Unmatched brace in metadata template.');
    if (literal) parts.push({ literal });
    const close = pattern.indexOf('}', open + 1);
    if (close < 0) throw new Error('Unmatched brace in metadata template.');
    const name = pattern.slice(open + 1, close);
    if (!name.trim() || /[{}\/\x00-\x1f\x7f]/.test(name)) throw new Error('Metadata placeholders need a nonempty name without braces, slashes or control characters.');
    const field = fieldName(name);
    if (parts.length && 'field' in parts[parts.length - 1]) throw new Error('Metadata fields must be separated by a literal.');
    hasTitle ||= field === 'title';
    parts.push({ field }); index = close + 1;
  }
  if (!hasTitle) throw new Error('Each template must include {title} or {trackName}.');
  if (template.startsWith('/') || template.endsWith('/') || template.includes('//'))
    throw new Error('Templates must describe complete path components separated by single slashes.');
  return parts;
}

/** Validate ordered templates at the settings boundary; an empty list uses the legacy format. */
export function validateMetadataTemplates(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || !value.every(item => typeof item === 'string'))
    throw new Error('Metadata templates must be a list of at most 32 strings.');
  for (const template of value) compileTemplate(template);
  return [...value];
}

function matches(parts: Part[], input: string): { results: Fields[]; truncated: boolean } {
  const results: Fields[] = [];
  const resultKeys = new Set<string>();
  let steps = 0, truncated = false;
  const visit = (partIndex: number, offset: number, fields: Fields): void => {
    if (results.length >= 2) return;
    if (++steps > 4096) { truncated = true; return; }
    if (partIndex === parts.length) {
      if (offset === input.length) {
        // Different splits of ignored variables must not hide a later distinct
        // artist/title result by exhausting the two-result ambiguity limit.
        const key = metadataKey(fields);
        if (!resultKeys.has(key)) { resultKeys.add(key); results.push(fields); }
      }
      return;
    }
    const part = parts[partIndex];
    if ('literal' in part) {
      if (input.startsWith(part.literal, offset)) visit(partIndex + 1, offset + part.literal.length, fields);
      return;
    }
    const following = parts[partIndex + 1];
    const literal = following && 'literal' in following ? following.literal : null;
    let end = literal === null ? input.length : input.indexOf(literal, offset);
    while (end >= 0) {
      const captured = input.slice(offset, end).trim();
      if (captured && !captured.includes('/') && (part.field !== 'trackNumber' || /^\d+$/.test(captured))) {
        const previous = part.field ? fields[part.field] : undefined;
        // Repeated known fields constrain the match rather than overwriting
        // one another. Preserve the first spelling, ignoring case differences.
        if (previous === undefined || previous.toLocaleLowerCase('en-US') === captured.toLocaleLowerCase('en-US'))
          visit(partIndex + 1, end, part.field && previous === undefined ? { ...fields, [part.field]: captured } : fields);
      }
      if (literal === null || results.length >= 2 || truncated) break;
      end = input.indexOf(literal, end + 1);
    }
  };
  visit(0, 0, {});
  return { results, truncated };
}

function metadataKey(fields: Fields): string {
  return JSON.stringify([fields.title ?? '', fields.artist ?? '', fields.djCode ?? '', fields.trackNumber ?? '']);
}

/** Match against the path suffix; / or \\ in a source path both delimit folders.
 * The first matching template and first valid split win. Ambiguity is exposed,
 * so callers may offer a review instead of treating inferred values as certain. */
export function metadataFromPath(path: string, templates: readonly string[], fallback: MetadataFormat): ParsedMetadata {
  const components = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const filename = (components.pop() ?? '').replace(/\.mp4$/i, '');
  const stem = filename.trim();
  components.push(filename);
  let winner: { fields: Fields; template: string } | undefined;
  let ambiguous = false;
  for (const template of templates) {
    const count = template.split('/').length;
    if (components.length < count) continue;
    const parts = compileTemplate(template);
    const input = components.slice(-count).join('/');
    const match = matches(parts, input);
    if (match.truncated) ambiguous = true;
    for (const fields of match.results) {
      if (!winner) winner = { fields, template };
      else if (metadataKey(fields) !== metadataKey(winner.fields)) ambiguous = true;
    }
  }
  if (!winner) return { ...metadataFromFilename(stem, fallback), matchedTemplate: null, ambiguous };
  return { title: winner.fields.title!, artist: winner.fields.artist ?? '',
    ...(winner.fields.djCode ? { djCode: winner.fields.djCode } : {}),
    ...(winner.fields.trackNumber ? { trackNumber: winner.fields.trackNumber } : {}),
    matchedTemplate: winner.template, ambiguous };
}

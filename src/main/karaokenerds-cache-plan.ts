import path from 'node:path';

/** Metadata for a video which a separately authorized provider can supply. */
export interface CacheVideo {
  id: string;
  provider: string;
  brandPrefix: string;
  trackCode: string;
  artist: string;
  title: string;
  extension: string;
  publishedAt?: string | null;
}

export interface LatestSelection {
  selected: CacheVideo[];
  unresolved: { artist: string; title: string; videoIds: string[]; reason: 'missing-publication-date' }[];
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function groupKey(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/** Select the newest known video per artist/title; never guess around undated alternatives. */
export function selectLatestByArtistTrack(videos: readonly CacheVideo[]): LatestSelection {
  const groups = new Map<string, CacheVideo[]>();
  const ids = new Set<string>();
  for (const video of videos) {
    if (!video.id.trim() || !groupKey(video.artist) || !groupKey(video.title)) throw new Error('Video ID, artist and title are required.');
    if (ids.has(video.id)) throw new Error('Video IDs must be unique.');
    ids.add(video.id);
    const key = JSON.stringify([groupKey(video.artist), groupKey(video.title)]);
    const group = groups.get(key) ?? [];
    group.push(video);
    groups.set(key, group);
  }
  const selected: CacheVideo[] = [];
  const unresolved: LatestSelection['unresolved'] = [];
  for (const [, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
    const byId = [...group].sort((a, b) => compare(a.id, b.id));
    const dates = byId.map(video => video.publishedAt ? Date.parse(video.publishedAt) : NaN);
    if (group.length > 1 && dates.some(date => !Number.isFinite(date))) {
      unresolved.push({ artist: byId[0].artist, title: byId[0].title, videoIds: byId.map(video => video.id), reason: 'missing-publication-date' });
      continue;
    }
    // Equal dates resolve by ID, not input order. One undated candidate is unambiguous.
    let latest = 0;
    for (let index = 1; index < byId.length; index++) if (dates[index] > dates[latest]) latest = index;
    selected.push(byId[latest]);
  }
  return { selected, unresolved };
}

/** Keep components safe for Windows, macOS and Linux without assuming the host OS. */
function safeComponent(raw: string, limit = 80): string {
  let value = raw.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '_').trim().replace(/[. ]+$/u, '');
  if (!value || value === '.' || value === '..') throw new Error('A path component is empty after sanitization.');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value)) value = `_${value}`;
  let result = '';
  // Windows counts UTF-16 code units, so avoid splitting surrogate pairs or exceeding the limit.
  for (const character of value) {
    if (result.length + character.length > limit) break;
    result += character;
  }
  result = result.replace(/[. ]+$/u, '');
  if (!result) throw new Error('A path component is empty after sanitization.');
  return result;
}

export function cachedVideoPath(baseDirectory: string, video: CacheVideo, paths: typeof path = path): string {
  if (!paths.isAbsolute(baseDirectory)) throw new Error('The cache base directory must be absolute.');
  const provider = safeComponent(video.provider);
  const prefix = safeComponent(video.brandPrefix);
  const artist = safeComponent(video.artist);
  let code = safeComponent(video.trackCode);
  const title = safeComponent(video.title);
  const extension = video.extension.replace(/^\./u, '').toLowerCase();
  if (!/^[a-z0-9]{1,10}$/u.test(extension)) throw new Error('Invalid video file extension.');
  if (code.toLowerCase().startsWith(`${prefix.toLowerCase()}-`)) code = code.slice(prefix.length + 1);
  if (!code) throw new Error('Track code is required.');
  const file = safeComponent(`${prefix}-${code} - ${artist} - ${title}`, 235) + `.${extension}`;
  const root = paths.resolve(baseDirectory);
  const result = paths.resolve(root, provider, 'Brands', prefix, artist, file);
  const relative = paths.relative(root, result);
  if (!relative || paths.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${paths.sep}`)) throw new Error('Cache path escapes its base directory.');
  return result;
}

export interface CachePathPlan {
  ready: { video: CacheVideo; path: string }[];
  collisions: { path: string; videoIds: string[] }[];
}

/** Report collisions conservatively on every platform; callers must not overwrite them. */
export function planCachePaths(baseDirectory: string, videos: readonly CacheVideo[], paths: typeof path = path): CachePathPlan {
  const groups = new Map<string, { video: CacheVideo; path: string }[]>();
  for (const video of videos) {
    const destination = cachedVideoPath(baseDirectory, video, paths);
    const key = destination.normalize('NFC').toLowerCase();
    const group = groups.get(key) ?? [];
    group.push({ video, path: destination });
    groups.set(key, group);
  }
  const ready: CachePathPlan['ready'] = [];
  const collisions: CachePathPlan['collisions'] = [];
  for (const [, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
    group.sort((a, b) => compare(a.video.id, b.video.id));
    if (group.length === 1) ready.push(group[0]);
    else collisions.push({ path: group[0].path, videoIds: group.map(item => item.video.id) });
  }
  return { ready, collisions };
}

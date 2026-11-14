import { compileSongBlacklist, type GlobalSongBlacklist } from './song-blacklist';

export type YouTubeSearchMode = 'karaoke-channels' | 'approved-channels';
export type YouTubeSearchPreferences = { youtubeSearchEnabled: boolean; youtubeSearchMode: YouTubeSearchMode;
  youtubeApprovedChannels: string[]; youtubeBlockedChannels: string[] };
export const MAX_YOUTUBE_SEARCH_RESULTS = 20;
export const MAX_YOUTUBE_CHANNELS = 1000;
export const MAX_YOUTUBE_SEARCH_OUTPUT_BYTES = 2 * 1024 * 1024;
export const YOUTUBE_KARAOKE_QUALITY_NOTE = 'Karaoke titles and channel hints are filters, not a guarantee of audio quality or accurate lyrics.';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[\p{L}\p{N}\p{M}._\u00b7\u0387-]{1,30}$/u;
const KARAOKE = /(?:^|[^\p{L}\p{N}])karaoke(?:$|[^\p{L}\p{N}])/iu;

export function normalizeYouTubeChannel(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) return null;
  const entry = value.trim();
  if (CHANNEL_ID.test(entry)) return entry; // Channel IDs are case sensitive.
  const handle = entry.normalize('NFKC');
  if (HANDLE.test(handle)) return handle.toLocaleLowerCase('en-US');
  try {
    const url = new URL(entry);
    if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) ||
        url.username || url.password || url.port || url.hash || url.search || /%2f|%5c/i.test(url.pathname)) return null;
    const path = decodeURIComponent(url.pathname);
    const match = /^\/(channel\/[^/]+|@[^/]+)(?:\/(?:videos|featured|shorts|streams|playlists))?\/?$/.exec(path);
    if (!match) return null;
    return normalizeYouTubeChannel(match[1].startsWith('channel/') ? match[1].slice(8) : match[1]);
  } catch { return null; }
}

export function parseYouTubeChannels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_YOUTUBE_CHANNELS)
    throw new Error(`Use an array of at most ${MAX_YOUTUBE_CHANNELS} YouTube channel IDs or @handles.`);
  const seen = new Set<string>();
  return value.map(entry => {
    const channel = normalizeYouTubeChannel(entry);
    if (!channel) throw new Error('Invalid YouTube channel: use a UC channel ID, @handle or canonical HTTPS channel URL. Display names and legacy user URLs are not stable identities.');
    if (seen.has(channel)) throw new Error('Duplicate YouTube channel ID or @handle.');
    seen.add(channel); return channel;
  });
}

export function validYouTubeSearchQuery(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
}

export function youtubeKaraokeQuery(value: unknown): string {
  if (!validYouTubeSearchQuery(value)) throw new Error('Enter 2–200 characters to search YouTube karaoke.');
  const query = value.trim().replace(/\s+/gu, ' ');
  return KARAOKE.test(query) ? query : `${query} karaoke`;
}

export type YouTubeKaraokeSong = { provider: 'youtube'; videoId: string; title: string; artist: string | null;
  videoTitle: string; watchUrl: string; channelId: string; channelHandle: string | null; channelName: string;
  channelUrl: string; durationSeconds: number; channelApproval: 'host-approved' | 'karaoke-hint';
  metadataSource: 'youtube-metadata' | 'video-title' | 'unparsed-video-title' };
export type YouTubeSearchFilterCounts = { examined: number; returned: number; invalid: number; duplicate: number;
  live: number; duration: number; notKaraoke: number; channelNotApproved: number; blockedChannel: number; blockedSong: number; restricted: number };
export const emptyYouTubeSearchCounts = (): YouTubeSearchFilterCounts => ({ examined: 0, returned: 0, invalid: 0,
  duplicate: 0, live: 0, duration: 0, notKaraoke: 0, channelNotApproved: 0, blockedChannel: 0, blockedSong: 0, restricted: 0 });
export type YouTubeSearchStatus = 'ok' | 'disabled' | 'invalid-input' | 'configuration-error' | 'dependency-missing' |
  'unavailable' | 'invalid-response' | 'timed-out' | 'cancelled';
export type YouTubeSearchResult = { provider: 'youtube'; status: YouTubeSearchStatus; searchId: string | null;
  songs: YouTubeKaraokeSong[]; counts: YouTubeSearchFilterCounts; message: string; qualityNote: string };

const safeText = (value: unknown, maximum = 500): string | null => typeof value === 'string' && value.trim() &&
  value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;

/** This is a display suggestion, not verified musical metadata. Do not discard
 * the original title or use the suggestion as a cross-provider recording ID. */
export function youtubeSongMetadata(videoTitle: string, artist: unknown, track: unknown): Pick<YouTubeKaraokeSong, 'artist' | 'title' | 'metadataSource'> {
  const metadataArtist = safeText(artist), metadataTitle = safeText(track);
  if (metadataArtist && metadataTitle) return { artist: metadataArtist, title: metadataTitle, metadataSource: 'youtube-metadata' };
  const cleaned = videoTitle.replace(/^\s*karaoke(?:\s+version)?\s*[:|\-–—]\s*/i, '')
    .replace(/\s*[([\-–—|]*\s*karaoke(?:\s+(?:version|instrumental|with lyrics|lyrics|cover))*\s*[)\]]?\s*$/i, '').trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length === 2 && parts.every(part => !!safeText(part))) return { artist: parts[0].trim(), title: parts[1].trim(), metadataSource: 'video-title' };
  return { artist: null, title: cleaned || videoTitle, metadataSource: 'unparsed-video-title' };
}

/** Accept metadata from yt-dlp only, reconstruct every URL, and explain filtered
 * results without returning raw tool output, cookies or private paths. */
export function filterYouTubeSearchEntries(value: unknown, preferences: YouTubeSearchPreferences & GlobalSongBlacklist): { songs: YouTubeKaraokeSong[]; counts: YouTubeSearchFilterCounts } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid YouTube search response.');
  const entries = (value as Record<string, unknown>).entries;
  if (!Array.isArray(entries) || entries.length > MAX_YOUTUBE_SEARCH_RESULTS) throw new Error('Invalid YouTube search response.');
  const approved = new Set(parseYouTubeChannels(preferences.youtubeApprovedChannels));
  const blocked = new Set(parseYouTubeChannels(preferences.youtubeBlockedChannels));
  const blacklist = compileSongBlacklist(preferences), seen = new Set<string>(), songs: YouTubeKaraokeSong[] = [], counts = emptyYouTubeSearchCounts();
  for (const entry of entries) {
    ++counts.examined;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { ++counts.invalid; continue; }
    const record = entry as Record<string, unknown>, id = safeText(record.id), channelId = safeText(record.channel_id),
      title = safeText(record.title), channelName = safeText(record.channel) ?? safeText(record.uploader);
    if (!id || !VIDEO_ID.test(id) || !channelId || !CHANNEL_ID.test(channelId) || !title || !channelName) { ++counts.invalid; continue; }
    if (record.age_limit != null && (typeof record.age_limit !== 'number' || !Number.isFinite(record.age_limit) || record.age_limit < 0)) { ++counts.invalid; continue; }
    if (seen.has(id)) { ++counts.duplicate; continue; } seen.add(id);
    if (record.is_live === true || record.is_upcoming === true || ['is_live', 'is_upcoming', 'post_live'].includes(String(record.live_status))) { ++counts.live; continue; }
    const duration = record.duration;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 45 || duration > 1800) { ++counts.duration; continue; }
    if ((typeof record.age_limit === 'number' && record.age_limit > 0) || ['private', 'premium_only', 'subscriber_only', 'needs_auth'].includes(String(record.availability))) { ++counts.restricted; continue; }
    const handles = [record.uploader_id, record.uploader_url, record.channel_url].map(normalizeYouTubeChannel).filter((ref): ref is string => !!ref && ref.startsWith('@'));
    const channelHandle = handles[0] ?? null;
    if (blocked.has(channelId) || handles.some(handle => blocked.has(handle))) { ++counts.blockedChannel; continue; }
    if (!KARAOKE.test(title)) { ++counts.notKaraoke; continue; }
    const hostApproved = approved.has(channelId) || handles.some(handle => approved.has(handle));
    const karaokeHint = KARAOKE.test(channelName) || handles.some(handle => /karaoke/i.test(handle));
    if (!hostApproved && (preferences.youtubeSearchMode === 'approved-channels' || !karaokeHint)) { ++counts.channelNotApproved; continue; }
    const metadata = youtubeSongMetadata(title, record.artist, record.track);
    // Common video titles put artist and title in either order. Check both exact
    // candidates for exclusion while preserving the explicitly labelled display guess.
    const reverse = metadata.metadataSource === 'video-title' ? { artist: metadata.title, title: metadata.artist } : null;
    if (blacklist.isBlocked(metadata) || (reverse && blacklist.isBlocked(reverse))) { ++counts.blockedSong; continue; }
    songs.push({ provider: 'youtube', videoId: id, ...metadata, videoTitle: title,
      watchUrl: `https://www.youtube.com/watch?v=${id}`, channelId, channelHandle, channelName,
      channelUrl: `https://www.youtube.com/channel/${channelId}`, durationSeconds: duration,
      channelApproval: hostApproved ? 'host-approved' : 'karaoke-hint' }); ++counts.returned;
  }
  return { songs, counts };
}

type SubscriptionImport = { channels: string[]; ignored: number };
/** Import only the selected Takeout text; this never signs into Google or reads a browser. */
export function parseYouTubeSubscriptions(value: unknown): SubscriptionImport {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > MAX_YOUTUBE_SEARCH_OUTPUT_BYTES)
    throw new Error('Use a YouTube subscriptions CSV or JSON export smaller than 2 MiB.');
  const input = value.replace(/^\uFEFF/, '').trim(), channels: string[] = [], seen = new Set<string>(); let ignored = 0;
  const add = (candidate: unknown) => {
    const channel = normalizeYouTubeChannel(candidate);
    if (!channel || !CHANNEL_ID.test(channel) || seen.has(channel)) { ++ignored; return; }
    if (channels.length >= MAX_YOUTUBE_CHANNELS) throw new Error(`Import at most ${MAX_YOUTUBE_CHANNELS} subscriptions at once.`);
    seen.add(channel); channels.push(channel);
  };
  if (/^[\[{]/.test(input)) {
    let data: unknown; try { data = JSON.parse(input); } catch { throw new Error('The subscriptions JSON is invalid.'); }
    const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as Record<string, unknown>).items ?? (data as Record<string, unknown>).subscriptions : null;
    if (!Array.isArray(rows) || rows.length > 5000) throw new Error('Use a subscriptions JSON array or items/subscriptions collection.');
    for (const row of rows) {
      if (typeof row === 'string') { add(row); continue; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) { ++ignored; continue; }
      const entry = row as Record<string, unknown>;
      const snippet = entry.snippet && typeof entry.snippet === 'object' ? entry.snippet as Record<string, unknown> : null;
      const resource = snippet?.resourceId && typeof snippet.resourceId === 'object' ? snippet.resourceId as Record<string, unknown> : null;
      add(resource?.channelId ?? entry.channelId ?? entry.channel_id);
    }
  } else {
    const rows: string[][] = [], row: string[] = []; let field = '', quoted = false, closed = false;
    const finishField = () => { if (field.length > 4096) throw new Error('Subscriptions CSV fields are too long.'); row.push(field); field = ''; closed = false; };
    for (let i = 0; i < input.length; ++i) {
      const character = input[i];
      if (quoted) { if (character === '"') { if (input[i + 1] === '"') { field += '"'; ++i; } else { quoted = false; closed = true; } } else field += character; }
      else if (character === ',' || character === '\n' || character === '\r') {
        finishField();
        if (character !== ',') { rows.push(row.splice(0)); if (character === '\r' && input[i + 1] === '\n') ++i; }
      } else if (character === '"' && !field && !closed) quoted = true;
      else { if (closed) throw new Error('Subscriptions CSV quoting is invalid.'); field += character; }
      if (field.length > 4096 || row.length > 20 || rows.length > 5001) throw new Error('Subscriptions CSV is too large.');
    }
    if (quoted) throw new Error('Subscriptions CSV quoting is incomplete.'); finishField(); rows.push(row);
    const header = rows.shift() ?? [], column = header.findIndex(name => name.trim().toLowerCase().replace(/[ _-]/g, '') === 'channelid');
    if (column < 0) throw new Error('Subscriptions CSV must include a Channel Id column from Google Takeout.');
    for (const row of rows) if (row.some(cell => cell.trim())) add(row[column]);
  }
  if (!channels.length) throw new Error('No valid UC channel IDs were found in the subscriptions export.');
  return { channels, ignored };
}

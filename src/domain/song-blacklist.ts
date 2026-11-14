/** Host-wide metadata identities, independent of providers and recording versions. */
export type BlacklistedSong = { artist: string; title: string };
export type GlobalSongBlacklist = { songBlacklist: readonly BlacklistedSong[]; artistBlacklist: readonly string[] };
export type SongIdentity = { artist?: string | null; title?: string | null; artists?: readonly string[] };
export type BlacklistMatch = 'artist' | 'song' | null;
export const MAX_BLACKLIST_SONGS = 2000;
export const MAX_BLACKLIST_ARTISTS = 1000;
export const MAX_BLACKLIST_TEXT = 500;

/** Fold typographical equivalents, but retain meaningful punctuation, accents
 * and complete words. A blacklist entry never performs a substring or regex match. */
export function normalizeBlacklistIdentity(value: string): string {
  return value.normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US').normalize('NFC');
}

function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > MAX_BLACKLIST_TEXT || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(`Invalid ${label}: use text of at most ${MAX_BLACKLIST_TEXT} characters without control characters.`);
  const trimmed = value.trim();
  if (!allowEmpty && !normalizeBlacklistIdentity(trimmed)) throw new Error(`Invalid ${label}: enter a name.`);
  return trimmed;
}

const songKey = (artist: string, title: string) => JSON.stringify([normalizeBlacklistIdentity(artist), normalizeBlacklistIdentity(title)]);

export function parseSongBlacklist(value: unknown): BlacklistedSong[] {
  if (!Array.isArray(value) || value.length > MAX_BLACKLIST_SONGS)
    throw new Error(`Invalid song blacklist: use an array of at most ${MAX_BLACKLIST_SONGS} artist/title entries.`);
  const seen = new Set<string>();
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !Object.hasOwn(entry, 'artist') || !Object.hasOwn(entry, 'title') ||
        Object.keys(entry).some(key => key !== 'artist' && key !== 'title'))
      throw new Error('Invalid song blacklist entry: provide only artist and title.');
    const song = {
      // An empty artist means unknown-artist metadata, never every artist.
      artist: text(entry.artist, 'blacklisted song artist', true),
      title: text(entry.title, 'blacklisted song title'),
    };
    const key = songKey(song.artist, song.title);
    if (seen.has(key)) throw new Error('Duplicate song blacklist entry: the artist and title already occur in the list.');
    seen.add(key);
    return song;
  });
}

export function parseArtistBlacklist(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_BLACKLIST_ARTISTS)
    throw new Error(`Invalid artist blacklist: use an array of at most ${MAX_BLACKLIST_ARTISTS} names.`);
  const seen = new Set<string>();
  return value.map(entry => {
    const artist = text(entry, 'blacklisted artist'), key = normalizeBlacklistIdentity(artist);
    if (seen.has(key)) throw new Error('Duplicate artist blacklist entry: the artist already occurs in the list.');
    seen.add(key);
    return artist;
  });
}

export type SongBlacklistMatcher = { match: (song: SongIdentity) => BlacklistMatch; isBlocked: (song: SongIdentity) => boolean };

/** Compile when settings change, then share this immutable lookup across search,
 * request and playback boundaries. Later mutations cannot change an installed policy. */
export function compileSongBlacklist(value: GlobalSongBlacklist): SongBlacklistMatcher {
  const artists = new Set(parseArtistBlacklist(value.artistBlacklist).map(normalizeBlacklistIdentity));
  const songs = new Set(parseSongBlacklist(value.songBlacklist).map(song => songKey(song.artist, song.title)));
  const match = (song: SongIdentity): BlacklistMatch => {
    const artist = typeof song.artist === 'string' ? song.artist : '';
    if (artists.has(normalizeBlacklistIdentity(artist)) ||
        song.artists?.some(name => typeof name === 'string' && artists.has(normalizeBlacklistIdentity(name)))) return 'artist';
    if (typeof song.title !== 'string' || !normalizeBlacklistIdentity(song.title)) return null;
    return songs.has(songKey(artist, song.title)) ? 'song' : null;
  };
  return Object.freeze({ match, isBlocked: (song: SongIdentity) => match(song) !== null });
}

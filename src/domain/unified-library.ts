import { visibleVersions, type ShowState, type Version } from './index';
import type { CatalogRequestTrack } from './catalog-request';
import { libraryView, type LibraryFilter, type LibrarySort } from './library-view';
import { libraryDate } from './library-result-fields';

export type LibraryCatalogTrack = { youtubeId: string | null; title: string; artist: string; brandSlug?: string; dateAdded?: string };
/** A catalog-only row is a selection, never a persisted show version. */
export type LibrarySearchVersion = Version & { catalogTrack?: CatalogRequestTrack; dateAdded?: string };
const validText = (value: unknown, required = false): value is string => typeof value === 'string' && value.length <= 500 &&
  (!required || !!value.trim()) && !/[\x00-\x1f\x7f\ufffd]/u.test(value);

/** Merge exact recording identities while preserving local metadata and show policy. */
export function unifiedLibrary(state: ShowState, query: string, filenames: Readonly<Record<string, string>>,
  sort: LibrarySort, filter: LibraryFilter, matches: readonly LibraryCatalogTrack[], allowedVersions: readonly Version[] = visibleVersions(state)): LibrarySearchVersion[] {
  const rows: LibrarySearchVersion[] = [];
  const seenVideos = new Set<string>();
  const append = (version: LibrarySearchVersion) => {
    const videoId = version.source?.provider === 'youtube' ? version.source.videoId : undefined;
    if (videoId && seenVideos.has(videoId)) return;
    if (videoId) seenVideos.add(videoId);
    rows.push(version);
  };
  // Sort once after merging, so newest-first does not reverse local rows twice.
  const catalogDates = new Map(matches.map(track => [track.youtubeId, libraryDate(track.dateAdded)]));
  for (const version of libraryView(allowedVersions, query, filenames, 'import-oldest', filter)) {
    const dateAdded = version.source?.provider === 'youtube' && catalogDates.get(version.source.videoId);
    append(dateAdded ? { ...version, dateAdded } : version);
  }
  const knownVideos = new Set<string>(), allowedByVideo = new Map<string, Version>();
  if (matches.length) {
    for (const version of state.versions) if (version.source?.provider === 'youtube') knownVideos.add(version.source.videoId);
    for (const version of allowedVersions) if (version.source?.provider === 'youtube' && !allowedByVideo.has(version.source.videoId)) allowedByVideo.set(version.source.videoId, version);
  }
  for (const match of matches) {
    if (typeof match.youtubeId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(match.youtubeId) ||
      !validText(match.title, true) || !validText(match.artist) || seenVideos.has(match.youtubeId)) continue;
    if (knownVideos.has(match.youtubeId)) {
      // A catalog match must never create a replacement identity for a blocked song.
      const allowed = allowedByVideo.get(match.youtubeId);
      if (allowed) append({ ...allowed, dateAdded: catalogDates.get(match.youtubeId) });
      continue;
    }
    const id = `catalog:youtube:${match.youtubeId}`;
    if (state.policy.ageRestricted || state.policy.includeVersionIds !== null || state.policy.excludeVersionIds.includes(id)) continue;
    const track: CatalogRequestTrack = { youtubeId: match.youtubeId, title: match.title, artist: match.artist,
      ...(typeof match.brandSlug === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(match.brandSlug) ? { brandSlug: match.brandSlug } : {}) };
    append({ id, title: track.title, artist: track.artist, rating: 'unrated',
      source: { provider: 'youtube', videoId: track.youtubeId, ...(track.brandSlug ? { brandSlug: track.brandSlug } : {}) }, catalogTrack: track,
      dateAdded: catalogDates.get(track.youtubeId) });
  }
  return libraryView(rows, '', filenames, sort, filter) as LibrarySearchVersion[];
}

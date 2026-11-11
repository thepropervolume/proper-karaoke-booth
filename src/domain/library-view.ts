import type { Version } from './index';

export type LibrarySort = 'import-oldest' | 'import-newest' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc';
export type LibraryFilter = 'all' | 'review' | 'missing-artist' | 'clean' | 'explicit' | 'unrated' | 'uncertain';

const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Operates only on the host's already policy-filtered versions and host-only basenames. */
export function libraryView(versions: readonly Version[], query: string, filenames: Readonly<Record<string, string>>,
  sort: LibrarySort, filter: LibraryFilter): Version[] {
  const terms = normalize(query.trim()).split(/\s+/u).filter(Boolean);
  const filtered = versions.filter(song => {
    if (filter === 'review' && !song.metadataAmbiguous) return false;
    if (filter === 'missing-artist' && song.artist.trim()) return false;
    if ((filter === 'clean' || filter === 'explicit' || filter === 'unrated' || filter === 'uncertain') && song.rating !== filter) return false;
    if (!terms.length) return true;
    const filename = Object.hasOwn(filenames, song.id) && typeof filenames[song.id] === 'string' ? filenames[song.id] : '';
    const fields = [song.title, song.artist, filename, song.djCode ?? '', song.trackNumber ?? '', song.source?.provider ?? ''].map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  });
  if (sort === 'import-oldest') return filtered;
  if (sort === 'import-newest') return filtered.reverse();
  const artistSort = sort === 'artist-asc' || sort === 'artist-desc';
  const descending = sort === 'title-desc' || sort === 'artist-desc';
  return filtered.sort((a, b) => {
    if (artistSort && (!!a.artist.trim() !== !!b.artist.trim())) return a.artist.trim() ? -1 : 1;
    const primary = collator.compare(artistSort ? a.artist : a.title, artistSort ? b.artist : b.title);
    const secondary = collator.compare(artistSort ? a.title : a.artist, artistSort ? b.title : b.artist);
    return (descending ? -primary : primary) || secondary || collator.compare(a.id, b.id);
  });
}

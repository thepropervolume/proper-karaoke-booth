import { createHash } from 'node:crypto';
import type { ShowState, Version } from '../domain';
import { validCatalogQuery } from '../domain/guest-catalog-search';
import { libraryView } from '../domain/library-view';
import { sourceForVersion } from '../domain/source-visibility';
import { ControlError } from './protocol';

export type ControlLibraryQuery = { text: string; cursor: string | null; limit: number };
export type ControlLibraryPage = { revision: number; count: number; nextCursor: string | null;
  items: Array<Pick<Version, 'id' | 'artist' | 'title' | 'rating'> & { source: ReturnType<typeof sourceForVersion> }> };
const parameters = new Set(['q', 'cursor', 'limit']);

export function parseControlLibraryQuery(search: URLSearchParams): ControlLibraryQuery {
  const text = search.get('q') ?? '', cursor = search.get('cursor'), rawLimit = search.get('limit') ?? '50';
  if ([...search.keys()].some(name => !parameters.has(name) || search.getAll(name).length !== 1) || !validCatalogQuery(text) ||
    cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor) || !/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100)
    throw new ControlError('invalid-request', 'Provide one search query, optional cursor, and a limit from 1 to 100.');
  return { text, cursor, limit: Number(rawLimit) };
}

export function projectControlLibrary(state: Pick<ShowState, 'showId' | 'hostEpoch' | 'revision'>, visible: readonly Version[],
  request: ControlLibraryQuery): ControlLibraryPage {
  const entries = libraryView(visible, request.text, {}, 'title-asc', 'all');
  // Scope pagination to the actual filtered sequence so preference or account
  // changes also invalidate a continuation even without a show mutation.
  const scope = createHash('sha256').update(JSON.stringify([
    state.showId, state.hostEpoch, state.revision, request.text, entries.map(entry => entry.id),
  ])).digest('hex');
  const encode = (offset: number) => Buffer.from(`${scope}:${offset}`).toString('base64url');
  let offset = 0;
  if (request.cursor) {
    const [oldScope, rawOffset] = Buffer.from(request.cursor, 'base64url').toString('utf8').split(':');
    offset = Number(rawOffset);
    if (oldScope !== scope || !Number.isSafeInteger(offset) || offset < 1 || offset >= entries.length || encode(offset) !== request.cursor)
      throw new ControlError('stale-cursor', 'The library changed. Start this search again without a cursor.');
  }
  const end = offset + request.limit;
  return { revision: state.revision, count: entries.length, nextCursor: end < entries.length ? encode(end) : null,
    items: entries.slice(offset, end).map(version => ({ id: version.id, artist: version.artist, title: version.title,
      rating: version.rating, source: sourceForVersion(version) })) };
}

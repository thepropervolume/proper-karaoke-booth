import React from 'react';
import type { LibraryCatalogSearchState } from './library-catalog-search';

export function LibraryCatalogStatus({ state }: { state: LibraryCatalogSearchState }) {
  if (state.phase === 'idle') return <p className="muted">{state.query.length > 200 ? 'Use up to 200 characters to include Karaoke Nerds results.' : 'Search at least two characters to include Karaoke Nerds recordings alongside your library.'}</p>;
  if (state.phase === 'waiting' || state.phase === 'searching') return <p className="muted" role="status">Searching Karaoke Nerds… Local matches are ready below.</p>;
  const result = state.result;
  if (!result || result.status !== 'ready') {
    const message = result && ['unauthorized', 'forbidden', 'configuration-error'].includes(result.status)
      ? 'Check the shared catalog connection in Preferences.' : 'Try again when the catalog connection is available.';
    return <p className="muted" role="status">Karaoke Nerds results are unavailable. Local matches are still available. {message}</p>;
  }
  return <p className="muted" role="status">
    {result.source === 'offline-cache' ? `Saved Karaoke Nerds results${result.fetchedAt !== undefined ? ` from ${new Date(result.fetchedAt).toLocaleString()}` : ''}.` : 'Karaoke Nerds results included.'}
    {result.stale ? ' Catalog information may be outdated.' : ''}
    {result.nextCursor ? ' More recordings are available.' : result.limited ? ' Refine your search to see more recordings.' : ''}
    {result.cachePersisted === false ? ' This search could not be saved for offline use. Check disk space and app data permissions.' : ''}
  </p>;
}

export function LibraryCatalogPaging({ state }: {
  state: LibraryCatalogSearchState & { loadMore: () => void; restart: () => void };
}) {
  if (state.result?.status !== 'ready' || !state.result.nextCursor) return null;
  return <div className="library-catalog-paging">
    <button type="button" disabled={state.phase === 'loading-more'} onClick={state.loadMore}>
      {state.phase === 'loading-more' ? 'Loading Karaoke Nerds…' : 'More Karaoke Nerds Results'}
    </button>
    {state.pageError && <>
      <span role="status">Could not load the next page.</span>
      <button type="button" className="link" onClick={state.restart}>Restart Search</button>
    </>}
  </div>;
}

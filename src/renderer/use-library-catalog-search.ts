import { useEffect, useRef, useState } from 'react';
import { LibraryCatalogSearch, type LibraryCatalogSearchState, type SearchLibraryCatalog } from './library-catalog-search';

export function useLibraryCatalogSearch(query: string, enabled: boolean, scope: string, search: SearchLibraryCatalog) {
  const current = useRef<LibraryCatalogSearch | null>(null);
  const [snapshot, setSnapshot] = useState<{ scope: string; value: LibraryCatalogSearchState }>({ scope, value: { query: '', phase: 'idle', result: null } });
  useEffect(() => {
    const controller = new LibraryCatalogSearch(search, value => setSnapshot({ scope, value }));
    current.current = controller;
    controller.update(query, enabled);
    return () => { controller.dispose(); current.current = null; };
  }, [query, enabled, scope, search]);
  // A changed query must not briefly render the previous query's recordings before effects run.
  const isCurrent = enabled && snapshot.scope === scope && snapshot.value.query === query.trim();
  const value: LibraryCatalogSearchState = isCurrent ? snapshot.value : { query: query.trim(), phase: 'idle', result: null };
  return { ...value, loadMore: () => { if (isCurrent) void current.current?.loadMore(); },
    restart: () => { if (isCurrent) current.current?.update(query); } };
}

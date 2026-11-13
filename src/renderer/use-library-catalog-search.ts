import { useEffect, useState } from 'react';
import type { LocalCatalogResult } from '../main/karaokenerds-local-browser';
import { LibraryCatalogSearch, type LibraryCatalogSearchState } from './library-catalog-search';

export function useLibraryCatalogSearch(query: string, enabled: boolean, scope: string, search: (query: string) => Promise<LocalCatalogResult>): LibraryCatalogSearchState {
  const [snapshot, setSnapshot] = useState<{ scope: string; value: LibraryCatalogSearchState }>({ scope, value: { query: '', phase: 'idle', result: null } });
  useEffect(() => {
    const controller = new LibraryCatalogSearch(search, value => setSnapshot({ scope, value }));
    controller.update(query, enabled);
    return () => controller.dispose();
  }, [query, enabled, scope, search]);
  // A changed query must not briefly render the previous query's recordings before effects run.
  return enabled && snapshot.scope === scope && snapshot.value.query === query.trim() ? snapshot.value : { query: query.trim(), phase: 'idle', result: null };
}

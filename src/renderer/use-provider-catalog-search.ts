import { useEffect, useState } from 'react';
import type { ProviderCatalogSearchResult } from '../domain/provider-catalog';
import { ProviderCatalogSearch, type ProviderCatalogSearchState } from './provider-catalog-search';

export function useProviderCatalogSearch(query: string, enabled: boolean, scope: string,
  search: (query: string) => Promise<ProviderCatalogSearchResult[]>): ProviderCatalogSearchState {
  const [snapshot, setSnapshot] = useState<{ scope: string; value: ProviderCatalogSearchState }>({
    scope, value: { query: '', phase: 'idle', results: null, failed: false },
  });
  useEffect(() => {
    const controller = new ProviderCatalogSearch(search, value => setSnapshot({ scope, value }));
    controller.update(query, enabled);
    return () => controller.dispose();
  }, [query, enabled, scope, search]);
  return enabled && snapshot.scope === scope && snapshot.value.query === query.trim() ? snapshot.value :
    { query: query.trim(), phase: 'idle', results: null, failed: false };
}

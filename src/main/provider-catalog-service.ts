import { PROVIDER_CATALOG_IDS, PROVIDER_CATALOG_LABELS, validProviderQuery, type ProviderCatalogId, type ProviderCatalogSearchResult, type ProviderCatalogStatus } from '../domain/provider-catalog';
import type { Policy } from '../domain';
import type { Settings } from '../domain/settings';
import { KaraFunCatalogClient } from './karafun-catalog-client';
import { searchPartyTymeCatalog } from './partytyme-catalog-client';
import { getPartnerCatalogStatus, searchPartnerCatalog } from './partner-catalog-adapters';

type Scope = Pick<Settings, 'providerCatalogEnabled' | 'providerCatalogProfiles'> & { policy: Policy };
type Dependencies = {
  search?: (provider: ProviderCatalogId, file: string | undefined, query: string) => Promise<ProviderCatalogSearchResult>;
  status?: (provider: 'sunfly' | 'stingray', file: string | undefined) => Promise<ProviderCatalogStatus>;
};
const publicCatalog = new KaraFunCatalogClient();
const catalogSearch = (provider: ProviderCatalogId, file: string | undefined, query: string) => provider === 'karafun' ? publicCatalog.search(query) : provider === 'partytyme' ? searchPartyTymeCatalog(file, query) : searchPartnerCatalog(provider, file, query);
const publicStatus = (provider: ProviderCatalogId): ProviderCatalogStatus => ({ provider, label: PROVIDER_CATALOG_LABELS[provider], configured: true, searchAvailable: true, playbackAvailable: false, message: 'Public catalog metadata. No account needed for search. Subscription playback is not connected.' });
const blocked = (scope: Scope) => !scope.providerCatalogEnabled || scope.policy.ageRestricted || scope.policy.includeVersionIds !== null;
const scopeKey = (scope: Scope) => JSON.stringify([scope.providerCatalogEnabled, scope.providerCatalogProfiles, scope.policy]);
const failure = (provider: ProviderCatalogId, message: string): ProviderCatalogSearchResult => ({ provider, label: PROVIDER_CATALOG_LABELS[provider], status: 'unavailable', songs: [], message });

/** The host renderer can discover metadata; it cannot promote these records to playable versions. */
export class ProviderCatalogService {
  private links = new Map<string, string>();
  private linksScope = '';
  private sequence = 0;
  constructor(private readonly current: () => Scope, private readonly deps: Dependencies = {}) {}
  async status(): Promise<ProviderCatalogStatus[]> {
    const scope = this.current();
    const values = await Promise.all(PROVIDER_CATALOG_IDS.map(provider => provider === 'karafun' || provider === 'partytyme' ? publicStatus(provider) : (this.deps.status ?? getPartnerCatalogStatus)(provider, scope.providerCatalogProfiles[provider] || undefined)));
    return values.map(value => scope.providerCatalogEnabled ? value : { ...value, searchAvailable: false, message: 'Service catalog search is disabled in Preferences.' });
  }
  async search(query: unknown): Promise<ProviderCatalogSearchResult[]> {
    const scope = this.current(), key = scopeKey(scope), sequence = ++this.sequence;
    this.links.clear(); this.linksScope = '';
    if (!validProviderQuery(query)) return PROVIDER_CATALOG_IDS.map(provider => ({ ...failure(provider, 'Enter 2–200 characters to search service catalogs.'), status: 'invalid-input' as const }));
    if (blocked(scope)) return PROVIDER_CATALOG_IDS.map(provider => failure(provider, !scope.providerCatalogEnabled ? 'Service catalog search is disabled.' : 'Service catalog results are hidden by the show policy because these recordings have not been approved for this show.'));
    const values = await Promise.all(PROVIDER_CATALOG_IDS.map(async provider => {
      try { return await (this.deps.search ?? catalogSearch)(provider, scope.providerCatalogProfiles[provider] || undefined, query.trim()); }
      catch { return failure(provider, `${PROVIDER_CATALOG_LABELS[provider]} search is unavailable. Other sources remain available.`); }
    }));
    if (key !== scopeKey(this.current()) || sequence !== this.sequence) return PROVIDER_CATALOG_IDS.map(provider => failure(provider, 'The search or show configuration changed. Search again.'));
    this.linksScope = key;
    for (const result of values) for (const song of result.songs) if (song.webUrl && this.safeUrl(song.provider, song.webUrl)) this.links.set(`${song.provider}\0${song.id}`, song.webUrl);
    return values;
  }
  url(provider: ProviderCatalogId, id: string): string | null {
    if (blocked(this.current()) || this.linksScope !== scopeKey(this.current()) || typeof id !== 'string' || id.length > 500 || /[\x00-\x1f\x7f]/.test(id)) return null;
    const value = this.links.get(`${provider}\0${id}`);
    return value && this.safeUrl(provider, value) ? value : null;
  }
  private safeUrl(provider: ProviderCatalogId, value: string): boolean {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false;
      if (provider === 'partytyme') return u.hostname === 'www.partytyme.com' && u.pathname === '/Party_Tyme_Pro_update.htm';
      if (provider === 'karafun') return u.hostname === 'www.karafun.com' && (u.pathname.startsWith('/karaoke/') || u.pathname === '/web/search');
      return false;
    } catch { return false; }
  }
}

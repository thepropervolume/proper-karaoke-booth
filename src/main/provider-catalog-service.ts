import { PROVIDER_CATALOG_IDS, PROVIDER_CATALOG_LABELS, validProviderQuery, type ProviderCatalogId, type ProviderCatalogSearchResult, type ProviderCatalogStatus } from '../domain/provider-catalog';
import type { Policy } from '../domain';
import type { Settings } from '../domain/settings';
import { KaraFunCatalogClient } from './karafun-catalog-client';
import { searchPartyTymeCatalog } from './partytyme-catalog-client';
import { getPartnerCatalogStatus, searchPartnerCatalog } from './partner-catalog-adapters';
import { searchSunflyStoreCatalog } from './sunfly-store-catalog-client';
import { compileSongBlacklist } from '../domain/song-blacklist';

type Scope = Pick<Settings, 'providerCatalogEnabled' | 'providerCatalogProfiles'> & Partial<Pick<Settings, 'songBlacklist' | 'artistBlacklist'>> & { policy: Policy; karaFunConnected?: boolean };
type Dependencies = {
  search?: (provider: ProviderCatalogId, file: string | undefined, query: string) => Promise<ProviderCatalogSearchResult>;
  status?: (provider: 'sunfly' | 'stingray', file: string | undefined) => Promise<ProviderCatalogStatus>;
};
const publicCatalog = new KaraFunCatalogClient();
const catalogSearch = (provider: ProviderCatalogId, file: string | undefined, query: string) => provider === 'karafun' ? publicCatalog.search(query) : provider === 'partytyme' ? searchPartyTymeCatalog(file, query) : provider === 'sunfly' && !file ? searchSunflyStoreCatalog(query) : searchPartnerCatalog(provider, file, query);
const publicStatus = (provider: ProviderCatalogId): ProviderCatalogStatus => ({ provider, label: provider === 'sunfly' ? 'Sunfly Store' : PROVIDER_CATALOG_LABELS[provider], configured: true, searchAvailable: true, playbackAvailable: false, catalogMode: 'public', message: provider === 'sunfly' ? 'Public store title/SKU search. Artist search is not verified. Store IDs differ from streaming IDs. No account needed; playback is pending.' : 'Public catalog metadata. No account needed for search. Subscription playback is not connected.' });
const blocked = (scope: Scope) => !scope.providerCatalogEnabled || scope.policy.ageRestricted || scope.policy.includeVersionIds !== null;
const scopeKey = (scope: Scope) => JSON.stringify([scope.providerCatalogEnabled, scope.providerCatalogProfiles, scope.policy, scope.songBlacklist ?? [], scope.artistBlacklist ?? [], scope.karaFunConnected === true]);
const failure = (provider: ProviderCatalogId, message: string): ProviderCatalogSearchResult => ({ provider, label: PROVIDER_CATALOG_LABELS[provider], status: 'unavailable', songs: [], message });

/** The host renderer can discover metadata; it cannot promote these records to playable versions. */
export class ProviderCatalogService {
  private links = new Map<string, string>();
  private linksScope = '';
  private sequence = 0;
  constructor(private readonly current: () => Scope, private readonly deps: Dependencies = {}) {}
  async status(): Promise<ProviderCatalogStatus[]> {
    const scope = this.current();
    const values = await Promise.all(PROVIDER_CATALOG_IDS.map(async provider => provider === 'karafun' || provider === 'partytyme' || provider === 'sunfly' && !scope.providerCatalogProfiles.sunfly ? publicStatus(provider) : { ...await (this.deps.status ?? getPartnerCatalogStatus)(provider, scope.providerCatalogProfiles[provider] || undefined), catalogMode: 'developer' as const }));
    return values.map(value => value.provider === 'karafun' && !scope.karaFunConnected ? { ...value, searchAvailable: false, message: 'Sign in to KaraFun in Sources to search its songs.' } : scope.providerCatalogEnabled ? value : { ...value, searchAvailable: false, message: 'Service catalog search is disabled in Preferences.' });
  }
  async search(query: unknown): Promise<ProviderCatalogSearchResult[]> {
    const scope = this.current(), key = scopeKey(scope), sequence = ++this.sequence;
    this.links.clear(); this.linksScope = '';
    if (!validProviderQuery(query)) return PROVIDER_CATALOG_IDS.map(provider => ({ ...failure(provider, 'Enter 2–200 characters to search service catalogs.'), status: 'invalid-input' as const }));
    if (blocked(scope)) return PROVIDER_CATALOG_IDS.map(provider => failure(provider, !scope.providerCatalogEnabled ? 'Service catalog search is disabled.' : 'Service catalog results are hidden by the show policy because these recordings have not been approved for this show.'));
    const values = await Promise.all(PROVIDER_CATALOG_IDS.map(async provider => {
      if (provider === 'karafun' && !scope.karaFunConnected) return { ...failure(provider, 'Sign in to KaraFun in Sources to search its songs.'), status: 'unauthorized' as const };
      try { return await (this.deps.search ?? catalogSearch)(provider, scope.providerCatalogProfiles[provider] || undefined, query.trim()); }
      catch { return failure(provider, `${PROVIDER_CATALOG_LABELS[provider]} search is unavailable. Other sources remain available.`); }
    }));
    if (key !== scopeKey(this.current()) || sequence !== this.sequence) return PROVIDER_CATALOG_IDS.map(provider => failure(provider, 'The search or show configuration changed. Search again.'));
    const blacklist = compileSongBlacklist({ songBlacklist: scope.songBlacklist === undefined ? [] : scope.songBlacklist,
      artistBlacklist: scope.artistBlacklist === undefined ? [] : scope.artistBlacklist });
    const filtered = values.map(result => ({ ...result, songs: result.songs.filter(song => !blacklist.isBlocked(song)) }));
    this.linksScope = key;
    for (const result of filtered) for (const song of result.songs) if (song.webUrl && this.safeUrl(song.provider, song.webUrl)) this.links.set(`${song.provider}\0${song.id}`, song.webUrl);
    return filtered;
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
      if (provider === 'sunfly') return u.hostname === 'www.sunflykaraoke.com' && /^\/(?:karaoke|custom-discs)\/[a-z0-9%_-]+\/[a-z0-9%_-]+\/$/i.test(u.pathname) && !/%2f|%5c|%2e/i.test(u.pathname);
      return false;
    } catch { return false; }
  }
}

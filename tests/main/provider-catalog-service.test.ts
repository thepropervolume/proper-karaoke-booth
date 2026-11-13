import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderCatalogService } from '../../src/main/provider-catalog-service';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { createInitialState } from '../../src/domain';
import { PROVIDER_CATALOG_LABELS, type ProviderCatalogId, type ProviderCatalogSearchResult } from '../../src/domain/provider-catalog';
const result = (provider: ProviderCatalogId, webUrl: string | null = null): ProviderCatalogSearchResult => ({ provider, label: PROVIDER_CATALOG_LABELS[provider], status: 'ok', message: 'Search only', songs: [{ provider, id: '1', title: 'Song', artist: 'Artist', durationSeconds: null, language: null, webUrl, playbackAvailable: false }] });
const scope = () => ({ ...structuredClone(DEFAULT_SETTINGS), policy: createInitialState('s', 'h').policy });
test('Sunfly defaults to public store metadata and explicit developer profiles never silently fall back', async () => {
  const state = scope(), calls: string[] = [];
  const service = new ProviderCatalogService(() => state, { status: async (provider, path) => {
    calls.push(`${provider}:${path || ''}`);
    return { provider, label: PROVIDER_CATALOG_LABELS[provider], configured: false, searchAvailable: false, playbackAvailable: false, message: 'Developer profile unavailable' };
  } });
  const publicValues = await service.status();
  assert.equal(publicValues.find(s => s.provider === 'sunfly')?.label, 'Sunfly Store');
  assert.equal(publicValues.find(s => s.provider === 'sunfly')?.catalogMode, 'public');
  assert.deepEqual(calls, ['stingray:']);
  state.providerCatalogProfiles.sunfly = '/explicit/private/key'; calls.length = 0;
  const privateValues = await service.status();
  assert.equal(privateValues.find(s => s.provider === 'sunfly')?.searchAvailable, false);
  assert.equal(privateValues.find(s => s.provider === 'sunfly')?.catalogMode, 'developer');
  assert.ok(calls.includes('sunfly:/explicit/private/key'));
});
test('strict show policies and disabled discovery stop provider calls at the service boundary', async () => {
  const state = scope(); let calls = 0;
  const service = new ProviderCatalogService(() => state, { search: async provider => { calls++; return result(provider); } });
  for (const policy of [{ ageRestricted: true, includeVersionIds: null, excludeVersionIds: [] }, { ageRestricted: false, includeVersionIds: [], excludeVersionIds: [] }]) {
    state.policy = policy; assert.ok((await service.search('song')).every(r => !r.songs.length));
  }
  state.policy = createInitialState('s', 'h').policy; state.providerCatalogEnabled = false;
  assert.ok((await service.search('song')).every(r => !r.songs.length)); assert.equal(calls, 0);
});
test('failure of one provider leaves other metadata results available and errors private', async () => {
  const service = new ProviderCatalogService(scope, { search: async provider => { if (provider === 'stingray') throw Error('SECRET'); return result(provider); } });
  const results = await service.search('song'); assert.equal(results.filter(r => r.status === 'ok').length, 3); assert.ok(!JSON.stringify(results).includes('SECRET'));
});
test('changed policy or profile fences pending replies and external links', async () => {
  const state = scope(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new ProviderCatalogService(() => state, { search: async provider => { await gate; return result(provider, 'https://www.partytyme.com/Party_Tyme_Pro_update.htm'); } });
  const pending = service.search('song'); state.providerCatalogProfiles.sunfly = '/new/private/key'; release();
  assert.ok((await pending).every(r => !r.songs.length)); assert.equal(service.url('partytyme', '1'), null);
});
test('only current observed allowlisted pages can open; never renderer URLs or tokens', async () => {
  const state = scope();
  const service = new ProviderCatalogService(() => state, { search: async provider => result(provider, provider === 'partytyme' ? 'https://www.partytyme.com/Party_Tyme_Pro_update.htm' : 'https://evil.example/?key=SECRET') });
  await service.search('song'); assert.equal(service.url('partytyme', '1'), 'https://www.partytyme.com/Party_Tyme_Pro_update.htm'); assert.equal(service.url('karafun', '1'), null);
  state.providerCatalogProfiles.sunfly = '/new/profile'; assert.equal(service.url('partytyme', '1'), null);
  await service.search('song');
  state.policy.ageRestricted = true; assert.equal(service.url('partytyme', '1'), null);
});

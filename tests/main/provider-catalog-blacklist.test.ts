import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../../src/domain';
import { parseSettings } from '../../src/domain/settings';
import { PROVIDER_CATALOG_LABELS, type ProviderCatalogId, type ProviderCatalogSearchResult } from '../../src/domain/provider-catalog';
import { ProviderCatalogService } from '../../src/main/provider-catalog-service';
const page = 'https://www.partytyme.com/Party_Tyme_Pro_update.htm';
const result = (provider: ProviderCatalogId): ProviderCatalogSearchResult => ({ provider, label: PROVIDER_CATALOG_LABELS[provider], status: 'ok', message: 'Search only', songs: [
  { provider, id: 'one', artist: 'Nada Surf', title: 'Amateur', durationSeconds: 200, language: null, webUrl: page, playbackAvailable: false },
  { provider, id: 'two', artist: 'NADA SURF', title: 'AMATEUR', durationSeconds: 200, language: null, webUrl: page, playbackAvailable: false },
  { provider, id: 'three', artist: 'Other Artist', title: 'Amateur', durationSeconds: 200, language: null, webUrl: page, playbackAvailable: false },
] });
const scope = () => ({ ...parseSettings({}), policy: createInitialState('show', 'epoch').policy, karaFunConnected: true });

test('all provider results and registered external links honor global identities without mutating cached source data', async () => {
  const current = scope(), originals = new Map<ProviderCatalogId, ProviderCatalogSearchResult>();
  current.songBlacklist = [{ artist: 'Nada Surf', title: 'Amateur' }];
  const service = new ProviderCatalogService(() => current, { search: async provider => { const value = originals.get(provider) ?? result(provider); originals.set(provider, value); return value; } });
  const values = await service.search('Amateur'); assert.ok(values.every(value => value.songs.length === 1 && value.songs[0].id === 'three'));
  assert.equal(service.url('partytyme', 'one'), null); assert.equal(service.url('partytyme', 'three'), page);
  assert.ok([...originals.values()].every(value => value.songs.length === 3));
  current.songBlacklist = []; assert.equal(service.url('partytyme', 'three'), null, 'Old result links expire when rules change.');
  assert.ok((await service.search('Amateur')).every(value => value.songs.length === 3)); assert.equal(service.url('partytyme', 'one'), page);
  current.artistBlacklist = ['Nada Surf']; assert.equal(service.url('partytyme', 'one'), null);
  assert.ok((await service.search('Amateur')).every(value => value.songs.length === 1));
});

test('blacklist changes invalidate in-flight provider searches before any result or link is installed', async () => {
  const current = scope(); let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
  const service = new ProviderCatalogService(() => current, { search: async provider => { await gate; return result(provider); } });
  const pending = service.search('Amateur'); current.artistBlacklist = ['Nada Surf']; finish();
  assert.ok((await pending).every(value => value.status === 'unavailable' && value.songs.length === 0));
  assert.equal(service.url('partytyme', 'one'), null);
});

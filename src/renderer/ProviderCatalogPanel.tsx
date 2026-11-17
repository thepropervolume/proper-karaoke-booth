import React, { useEffect, useState } from 'react';
import type { ProviderCatalogId, ProviderCatalogSong, ProviderCatalogStatus } from '../domain/provider-catalog';
import type { ProviderCatalogSearchState } from './provider-catalog-search';
import { useProviderCatalogSearch } from './use-provider-catalog-search';
import type { ProviderCatalogSearchResult } from '../domain/provider-catalog';

export type ProviderCatalogBridge = {
  getProviderCatalogStatus(): Promise<ProviderCatalogStatus[]>;
  searchProviderCatalog(query: string): Promise<ProviderCatalogSearchResult[]>;
  chooseProviderCatalogProfile(provider: ProviderCatalogId): Promise<ProviderCatalogStatus[]>;
  clearProviderCatalogProfile(provider: ProviderCatalogId): Promise<ProviderCatalogStatus[]>;
  openProviderCatalogSong(input: { provider: ProviderCatalogId; id: string }): Promise<void>;
};

export function ProviderCatalogResults({ state, openSong }: {
  state: ProviderCatalogSearchState; openSong: ProviderCatalogBridge['openProviderCatalogSong'];
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState('');
  useEffect(() => { setOpenError(''); }, [state.query]);
  if (state.phase === 'idle') return null;
  const open = async (song: ProviderCatalogSong) => {
    if (opening) return;
    setOpening(`${song.provider}:${song.id}`); setOpenError('');
    try { await openSong({ provider: song.provider, id: song.id }); }
    catch { setOpenError('The provider page could not be opened. Your show is unchanged.'); }
    finally { setOpening(null); }
  };
  return <section className="provider-catalog-results" aria-label="Service catalog matches" aria-busy={state.phase === 'searching'}>
    <h3>Service Catalogs <span className="badge">Search Only</span></h3>
    <p className="muted">These matches cannot be queued or played in the booth yet. Local songs and Karaoke Nerds keep their usual playback controls.</p>
    {(state.phase === 'waiting' || state.phase === 'searching') && <p role="status">{state.phase === 'waiting' ? 'Waiting for your search…' : 'Searching service catalogs…'}</p>}
    {state.failed && <p role="status">Service catalog search is unavailable. Your local and Karaoke Nerds searches are unaffected.</p>}
    {state.results?.slice(0, 4).map(result => <section key={result.provider} className="provider-catalog-group" aria-label={`${result.label} catalog results`}>
      <h4>{result.label}</h4>
      {result.status !== 'ok' ? <p className="muted" role="status">{result.message || 'Catalog access is unavailable. Check this service in Sources.'}</p> : <>
        <p className="muted">{result.message}</p>
        {!result.songs.length && <p className="muted">No matching songs returned.</p>}
        <div role="list" aria-label={`${result.label} songs`}>{result.songs.slice(0, 50).map(song => <div className="track-row provider-catalog-song" role="listitem" key={`${song.provider}:${song.id}`}>
          <div><strong>{song.title}</strong><small>{song.artist || 'Unknown artist'} · {result.label}</small>
            <small>Search only · Playback pending{song.language ? ` · ${song.language}` : ''}</small></div>
          {song.webUrl && <button type="button" disabled={opening !== null} onClick={() => void open(song)} aria-label={`View ${song.title} on ${result.label}`}>{opening === `${song.provider}:${song.id}` ? 'Opening…' : `View on ${result.label}`}</button>}
        </div>)}</div>
        {result.songs.length >= 50 && <p className="muted">Showing the first 50 matches. Refine your search for more.</p>}
      </>}
    </section>)}
    {openError && <p role="alert">{openError}</p>}
  </section>;
}

export function ProviderCatalogPanel({ bridge, enabled, scope, onConfigurationChanged }: {
  bridge: ProviderCatalogBridge; enabled: boolean; scope: string; onConfigurationChanged(): void;
}) {
  const [statuses, setStatuses] = useState<ProviderCatalogStatus[] | null>(null);
  const [failure, setFailure] = useState('');
  const [choosing, setChoosing] = useState<ProviderCatalogId | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const state = useProviderCatalogSearch(search, enabled, JSON.stringify([revision, scope]), bridge.searchProviderCatalog);
  useEffect(() => {
    let alive = true;
    void bridge.getProviderCatalogStatus().then(value => { if (alive) setStatuses(value); })
      .catch(() => { if (alive) setFailure('Service connection status could not be read. Your local library remains available.'); });
    return () => { alive = false; };
  }, [bridge, scope]);
  const choose = async (provider: ProviderCatalogId) => {
    if (choosing) return;
    setChoosing(provider); setFailure('');
    try { setStatuses(await bridge.chooseProviderCatalogProfile(provider)); setRevision(value => value + 1); onConfigurationChanged(); }
    catch { setFailure('The service profile could not be selected. Choose a valid private profile and try again.'); }
    finally { setChoosing(null); }
  };
  const clear = async (provider: ProviderCatalogId) => {
    if (choosing) return;
    setChoosing(provider); setFailure('');
    try { setStatuses(await bridge.clearProviderCatalogProfile(provider)); setRevision(value => value + 1); onConfigurationChanged(); }
    catch { setFailure('The profile selection could not be cleared. Its credential file was not deleted.'); }
    finally { setChoosing(null); }
  };
  return <section className="provider-catalog-panel" aria-label="Third-party service catalogs">
    <h2>Third-Party Services</h2>
    <p>Additional catalog discovery. Connect playable accounts in the sections above.</p>
    {!enabled && <p role="status">Service catalog search is turned off. Enable it under Preferences → Karaoke Services.</p>}
    {!statuses && !failure && <p role="status">Loading service connections…</p>}
    <div className="provider-catalog-cards">{statuses?.slice(0, 4).map(status => <article className="provider-catalog-card" key={status.provider}>
      <h3>{status.provider==='partytyme'?'Party Tyme Pro Catalog':status.label}</h3><span className="badge">{status.searchAvailable ? 'Catalog Search' : status.configured ? 'Search Unavailable' : 'Not Configured'}</span>
      <p>{status.message}</p><p className="muted">Playback pending</p>
      {(status.provider === 'stingray' || status.provider === 'sunfly') ? <><button type="button" disabled={choosing !== null} onClick={() => void choose(status.provider)}>{choosing === status.provider ? 'Choosing…' : 'Choose Developer Profile…'}</button>{status.catalogMode === 'developer' && <button type="button" disabled={choosing !== null} onClick={() => void clear(status.provider)}>{status.provider === 'sunfly' ? 'Use Public Store Search' : 'Remove Profile Selection'}</button>}</> : <p className="muted">Public catalog metadata · No account needed for search</p>}
    </article>)}</div>
    {failure && <p role="alert">{failure}</p>}
    <form className="library-toolbar" onSubmit={event => { event.preventDefault(); if (query.trim().length >= 2) { setSearch(query); setRevision(value => value + 1); } }}>
      <label>Artist or song title<input type="search" aria-label="Search service catalogs" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); if (event.target.value.trim() !== search.trim()) setSearch(''); }} /></label>
      <button type="submit" disabled={!enabled || query.trim().length < 2}>Search Service Catalogs</button>
    </form>
    <ProviderCatalogResults state={state} openSong={bridge.openProviderCatalogSong} />
  </section>;
}

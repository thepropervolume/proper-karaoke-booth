import React, { useState } from 'react';
import type { LocalCatalogResult } from '../main/karaokenerds-local-browser';

export function CommunityCatalogPanel({ search, openVideo }: {
  search: (query: string) => Promise<LocalCatalogResult>; openVideo: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<LocalCatalogResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || query.trim().length < 2) return;
    setBusy(true); setError(''); setResult(null);
    try { setResult(await search(query)); }
    catch { setError('The catalog search could not be completed.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Karaoke Nerds catalog">
    <h2>Karaoke Nerds Catalog</h2>
    <p className="muted">Search the saved local community snapshot. Results do not add songs to the library or queue. The YouTube player opens separately, uses system audio, and stops when you leave its window.</p>
    <form className="library-toolbar" onSubmit={event => void submit(event)}>
      <label>Artist or song title<input type="search" value={query} maxLength={200} disabled={busy} onChange={event => { setQuery(event.target.value); setResult(null); }} /></label>
      <button type="submit" disabled={busy || query.trim().length < 2}>{busy ? 'Searching…' : 'Search catalog'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result?.status === 'missing' && <p role="status">No local catalog snapshot was found on this computer.</p>}
    {result?.status === 'uninitialized' && <p role="status">The local catalog snapshot has not been initialized.</p>}
    {result?.status === 'unavailable' && <p role="status">The local catalog could not be read. Check the snapshot and try again.</p>}
    {result?.status === 'ready' && <>
      <p role="status">{result.tracks.length ? `${result.tracks.length} results${result.limited ? ' shown; refine your search for more' : ''}.` : 'No songs match this search.'} {result.lastSuccess === null ? '' : `Snapshot updated ${new Date(result.lastSuccess).toLocaleDateString()}.`}</p>
      <div className="song-list">{result.tracks.map((track, index) => <div className="track-row" key={`${track.id}-${index}`}>
        <div><strong>{track.title}</strong><small>{track.artist} · {track.brand ?? 'Brand not identified'}</small><small>{track.youtubeId ? `YouTube ID: ${track.youtubeId}` : 'No supported YouTube link'}</small></div>
        {track.youtubeId && <button type="button" onClick={() => { setError(''); void openVideo(track.youtubeId!).then(value => { if (!value.ok) setError(value.error || 'Could not open the YouTube player.'); }).catch(() => setError('Could not open the YouTube player.')); }}>Open YouTube Player</button>}
      </div>)}</div>
    </>}
  </section>;
}

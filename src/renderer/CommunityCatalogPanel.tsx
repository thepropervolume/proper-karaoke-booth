import React, { useState } from 'react';
import type { LocalCatalogResult } from '../main/karaokenerds-local-browser';

export function CommunityCatalogPanel({ search, openVideo, addVideo, onAdded }: {
  addVideo: (input: {url:string;title:string;artist:string;brandSlug?:string;discoveryOrigin?:'karaokenerds'}) => Promise<{ok:boolean;error?:string;versionId?:string;notice?:string}>; onAdded: (id:string, notice?:string) => void;
  search: (query: string) => Promise<LocalCatalogResult>; openVideo: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [importError, setImportError] = useState('');
  const add = async (input: {url:string;title:string;artist:string;brandSlug?:string;discoveryOrigin?:'karaokenerds'}, manual = false) => {
    if (busy) return; const reportError = manual ? setImportError : setError; setBusy(true); reportError('');
    try { const result = await addVideo(input); if (!result.ok || !result.versionId) reportError(result.error || 'Could not add the YouTube song.'); else onAdded(result.versionId, result.notice); }
    catch { reportError('Could not add the YouTube song.'); } finally { setBusy(false); }
  };
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
  return <><section aria-label="Karaoke Nerds catalog">
    <h2>Karaoke Nerds</h2>
    <p className="muted">Search directly in Song Library to choose a singer and queue a Karaoke Nerds recording. Requesting it schedules a permanent yt-dlp download; saved videos play through your selected output, including offline. This page also lets you save a manual YouTube link to the library. Choose the download folder in Preferences.</p>

    <p className="muted">Search the configured shared catalog or saved local snapshot. Add to Library saves a recording for later; queue it from Song Library when ready to download. Preview opens the separate, manually controlled player.</p>
    <form className="library-toolbar" onSubmit={event => void submit(event)}>
      <label>Artist or song title<input type="search" value={query} maxLength={200} disabled={busy} onChange={event => { setQuery(event.target.value); setResult(null); }} /></label>
      <button type="submit" disabled={busy || query.trim().length < 2}>{busy ? 'Searching…' : 'Search catalog'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result?.status === 'missing' && <p role="status">No local catalog snapshot was found on this computer.</p>}
    {result?.status === 'uninitialized' && <p role="status">The local catalog snapshot has not been initialized.</p>}
    {result?.status === 'unavailable' && <p role="status">The catalog could not be reached or read, and no matching offline search was available. Check the connection or local snapshot.</p>}
    {result && ['unauthorized','forbidden','configuration-error','timed-out','invalid-request','invalid-response','rate-limited'].includes(result.status) && <p role="alert">{result.status === 'unauthorized' || result.status === 'forbidden' ? 'Shared catalog access was rejected. Check the client configuration in Preferences.' : result.status === 'configuration-error' ? 'Choose a valid private shared catalog configuration in Preferences.' : 'The shared catalog request could not be completed. Check the connection and try again.'}</p>}
    {result?.status === 'ready' && <>
      {result.cachePersisted === false && <p role="status">This search could not be saved for offline use. Check available disk space and app data permissions.</p>}
      {result.source && <p role="status">{result.source === 'offline-cache' ? `Offline saved search${result.fetchedAt ? ` from ${new Date(result.fetchedAt).toLocaleString()}` : ''}` : 'Shared catalog'}{result.stale ? ' · Catalog may be stale or its upstream refresh time is unknown.' : ''}</p>}
      <p role="status">{result.tracks.length ? `${result.tracks.length} results${result.limited ? ' shown; refine your search for more' : ''}.` : 'No songs match this search.'} {result.lastSuccess === null ? '' : `Snapshot updated ${new Date(result.lastSuccess).toLocaleDateString()}.`}</p>
      <div className="song-list">{result.tracks.map((track, index) => <div className="track-row" key={`${track.id}-${index}`}>
        <div><strong>{track.title}</strong><small>{track.artist} · {track.brand ?? 'Brand not identified'}</small><small>{track.youtubeId ? `YouTube ID: ${track.youtubeId}` : 'No supported YouTube link'}</small></div>
        {track.youtubeId && <button type="button" disabled={busy} onClick={() => void add({url:track.youtubeId!,title:track.title,artist:track.artist,discoveryOrigin:'karaokenerds',...(track.brandSlug ? {brandSlug:track.brandSlug} : {})})}>Add to Library</button>}
        {track.youtubeId && <button type="button" onClick={() => { setError(''); void openVideo(track.youtubeId!).then(value => { if (!value.ok) setError(value.error || 'Could not open the YouTube player.'); }).catch(() => setError('Could not open the YouTube player.')); }}>Preview YouTube</button>}
      </div>)}</div>
    </>}
  </section><section aria-label="Custom YouTube Video Importer"><h2>Custom YouTube Video Importer</h2>
    <p className="muted">Save an exact YouTube link to Song Library, then queue it or choose Download Video. Adding a link does not start playback.</p>
    <form className="request-form" onSubmit={event => { event.preventDefault(); void add({url,title,artist}, true); }}>
      <label>YouTube video link<input aria-label="YouTube video link" value={url} maxLength={2048} onChange={e=>setUrl(e.target.value)} required /></label>
      <label>Song title<input aria-label="YouTube song title" value={title} maxLength={500} onChange={e=>setTitle(e.target.value)} required /></label>
      <label>Artist<input aria-label="YouTube artist" value={artist} maxLength={500} onChange={e=>setArtist(e.target.value)} /></label>
      <button type="submit" disabled={busy || !url.trim() || !title.trim()}>Add YouTube to Library</button>
    </form>
    {importError && <p role="alert">{importError}</p>}
  </section></>;
}

import React, { useState } from 'react';
import type { Settings } from '../domain/settings';
import { parseArtistBlacklist, parseSongBlacklist } from '../domain/song-blacklist';

/** Draft-only rules. The enclosing Preferences form saves or cancels them. */
export function BlacklistSettings({ value, onChange }: { value: Settings; onChange(value: Settings): void }) {
  const [artist, setArtist] = useState(''), [songArtist, setSongArtist] = useState(''), [songTitle, setSongTitle] = useState('');
  const [error, setError] = useState('');
  const addArtist = () => {
    try { onChange({ ...value, artistBlacklist: parseArtistBlacklist([...value.artistBlacklist, artist]) }); setArtist(''); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add this artist.'); }
  };
  const addSong = () => {
    try { onChange({ ...value, songBlacklist: parseSongBlacklist([...value.songBlacklist, { artist: songArtist, title: songTitle }]) }); setSongArtist(''); setSongTitle(''); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add this song.'); }
  };
  return <div className="blacklist-settings">
    <p>Hide songs and artists from every source on this host, across all shows. A song rule covers every version with the same artist and title.</p>
    <div className="blacklist-settings__add">
      <label>Artist to blacklist<input value={artist} maxLength={500} onChange={event => setArtist(event.target.value)} /></label>
      <button type="button" disabled={!artist.trim()} onClick={addArtist}>Blacklist Artist</button>
    </div>
    <ul className="blacklist-settings__list" aria-label="Blacklisted artists">{value.artistBlacklist.map((item, index) => <li key={item}><span>{item}</span><button type="button" aria-label={`Remove artist blacklist: ${item}`} onClick={() => onChange({ ...value, artistBlacklist: value.artistBlacklist.filter((_, at) => at !== index) })}>Remove</button></li>)}</ul>
    {!value.artistBlacklist.length && <p className="muted">No artists blacklisted.</p>}
    <div className="blacklist-settings__add blacklist-settings__add--song">
      <label>Song Artist<input value={songArtist} maxLength={500} onChange={event => setSongArtist(event.target.value)} /></label>
      <label>Song Title<input value={songTitle} maxLength={500} onChange={event => setSongTitle(event.target.value)} /></label>
      <button type="button" disabled={!songTitle.trim()} onClick={addSong}>Blacklist Song</button>
    </div>
    <ul className="blacklist-settings__list" aria-label="Blacklisted songs">{value.songBlacklist.map((item, index) => <li key={`${item.artist}\0${item.title}`}><span>{item.artist || 'Unknown Artist'} — {item.title}</span><button type="button" aria-label={`Remove song blacklist: ${item.artist || 'Unknown Artist'} — ${item.title}`} onClick={() => onChange({ ...value, songBlacklist: value.songBlacklist.filter((_, at) => at !== index) })}>Remove</button></li>)}</ul>
    {!value.songBlacklist.length && <p className="muted">No songs blacklisted.</p>}
    <p className="muted">Matches ignore case and typographic spacing; they use complete names, without wildcard matching. An empty artist matches unknown-artist songs only. Right-click a library song to add a rule quickly.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}

import React, { useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';

export type BumperTrackInfo = { id: string; name: string; builtIn: boolean };
export type BumperStatus = { status: 'stopped' | 'starting' | 'playing'; trackId: string | null };
export type BumperInfo = { tracks: BumperTrackInfo[]; status: BumperStatus; outputReady: boolean; karaokeActive: boolean; error: string };

export function BumperControls({ autoBumper, autoBumperTrackId, includeBuiltIn, onBuiltInChange, onAutoChange }: {
  autoBumper: boolean; autoBumperTrackId: string; includeBuiltIn: boolean;
  onBuiltInChange: (enabled: boolean, trackId: string) => void;
  onAutoChange: (enabled: boolean, trackId: string) => void;
}) {
  const [info, setInfo] = useState<BumperInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let receivedUpdate = false;
    const unsubscribe = window.tpv.onBumperState(value => { receivedUpdate = true; if (alive) setInfo(value); });
    void window.tpv.getBumpers().then(value => { if (alive && !receivedUpdate) setInfo(value); })
      .catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  if (!info) return <p role="status">{error || 'Loading bumper music…'}</p>;
  const tracks = info.tracks.filter(track => includeBuiltIn || !track.builtIn);
  return <>
    {info.error && <p role="alert">{info.error}</p>}
    <label className="settings-check"><input type="checkbox" checked={includeBuiltIn} onChange={event => {
      const enabled = event.currentTarget.checked;
      const available = info.tracks.filter(track => enabled || !track.builtIn);
      const selected = available.find(track => track.id === autoBumperTrackId) ?? available[0];
      onBuiltInChange(enabled, selected?.id ?? autoBumperTrackId);
    }} /> Include built-in bumper tracks</label>
    <label className="settings-check"><input type="checkbox" checked={autoBumper} onChange={event => onAutoChange(event.target.checked, autoBumperTrackId)} /> Enable bumper music between songs</label>
    <label>Automatic bumper track<select value={autoBumperTrackId} onChange={event => onAutoChange(autoBumper, event.target.value)}>
      {!tracks.some(track => track.id === autoBumperTrackId) && <option value={autoBumperTrackId}>Selected track is unavailable</option>}
      {tracks.map(track => <option key={track.id} value={track.id}>{track.name}{track.builtIn ? ' (built in)' : ''}</option>)}
    </select></label>
    <Tooltip text="Music fills the gap after a song and stops before the next performance. The singer window can stay closed. Stop cancels automatic song advancement; output loss needs a manual restart after choosing a working device."><button type="button" className="help-button" aria-label="Bumper playback help">?</button></Tooltip>
    {autoBumper && !info.outputReady && <p role="status">Bumper audio is not ready. Check the output device.</p>}
    {autoBumper && !tracks.some(track => track.id === autoBumperTrackId) && <p role="alert">The automatic bumper track is unavailable. Add a track or choose another.</p>}
    <BumperPanel {...info} tracks={tracks}
      add={async () => { setInfo(await window.tpv.addBumpers()); }}
      remove={async id => { setInfo(await window.tpv.removeBumper(id)); }}
      start={async id => { setInfo(await window.tpv.startBumper(id)); }}
      stop={async () => { setInfo(await window.tpv.stopBumper()); }} />
  </>;
}

export function BumperPanel({ tracks, status, outputReady, karaokeActive, add, remove, start, stop }: {
  tracks: BumperTrackInfo[]; status: BumperStatus; outputReady: boolean; karaokeActive: boolean;
  add: () => Promise<void>; remove: (id: string) => Promise<void>;
  start: (id: string) => Promise<void>; stop: () => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!tracks.some(track => track.id === selected)) setSelected(tracks[0]?.id ?? ''); }, [tracks, selected]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const item = tracks.find(track => track.id === selected);
  const customCount = tracks.filter(track => !track.builtIn).length;
  return <section aria-label="Bumper music" className="bumper-panel">
    <h3>Bumper Music</h3>
    {!outputReady && <p className="muted">Choose a working audio output to play bumper music.</p>}
    {karaokeActive && <p className="muted">Bumper music is unavailable while a performance is active or paused.</p>}
    <label>Start with <select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy || status.status !== 'stopped'}>
      {tracks.map(track => <option key={track.id} value={track.id}>{track.name}{track.builtIn ? ' (built in)' : ''}</option>)}
    </select></label>
    <div className="bumper-panel__actions">
      <button type="button" disabled={busy || !selected || !outputReady || karaokeActive || status.status !== 'stopped'} onClick={() => void run(() => start(selected))}>Play bumper</button>
      <button type="button" disabled={busy || status.status === 'stopped'} onClick={() => void run(stop)}>Stop bumper</button>
      <button type="button" disabled={busy || customCount >= 5} onClick={() => void run(add)}>Add audio ({customCount}/5)</button>
      <button type="button" disabled={busy || !item || item.builtIn} onClick={() => item && void run(() => remove(item.id))}>Remove selected</button>
    </div>
    <p role="status">{status.status === 'stopped' ? 'Bumper stopped' : `${status.status === 'starting' ? 'Starting' : 'Playing'}: ${tracks.find(track => track.id === status.trackId)?.name ?? 'bumper music'}`}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}

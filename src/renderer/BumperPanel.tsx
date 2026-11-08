import React, { useEffect, useState } from 'react';

export type BumperTrackInfo = { id: string; name: string; builtIn: boolean };
export type BumperStatus = { status: 'stopped' | 'starting' | 'playing'; trackId: string | null };
export type BumperInfo = { tracks: BumperTrackInfo[]; status: BumperStatus; outputReady: boolean; karaokeActive: boolean; error: string };

export function BumperControls() {
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
  return <>
    {info.error && <p role="alert">{info.error}</p>}
    <BumperPanel {...info}
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
    <h3>Bumper music</h3>
    <p className="muted">Choose a track to start. Music continues through the list until stopped or karaoke starts.</p>
    {!outputReady && <p className="muted">Save an explicit audio output and open the singer display to play bumper music.</p>}
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

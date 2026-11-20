import React, { useEffect, useRef, useState } from 'react';
import { validSessionLink, validateSessionSlug, type InternetSessionBridge, type InternetSessionStatus } from './internet-session-control';
import './host-control.css';

/** The main process owns the internet connection; this panel receives singer links only. */
export function InternetSessionPanel({ bridge }: { bridge: InternetSessionBridge }) {
  const [status, setStatus] = useState<InternetSessionStatus | null>(null);
  const [slug, setSlug] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false), editedRef = useRef(false), aliveRef = useRef(true);
  useEffect(() => {
    let alive = true, received = false;
    aliveRef.current = true; editedRef.current = false;
    setStatus(null); setSlug(''); setMessage('');
    const update = (value: InternetSessionStatus) => {
      if (!alive) return;
      received = true; setStatus(value);
      if (!editedRef.current) setSlug(value.slug ?? value.suggestedSlug);
    };
    const unsubscribe = bridge.subscribe(update);
    void bridge.status().then(value => { if (!received) update(value); }).catch(() => { if (alive) setMessage('Internet session status is unavailable.'); });
    return () => { alive = false; aliveRef.current = false; unsubscribe(); };
  }, [bridge]);
  const run = async (action: () => Promise<void>, success = '') => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try { await action(); if (aliveRef.current && success) setMessage(success); }
    catch (error) { if (aliveRef.current) setMessage(error instanceof Error ? error.message : 'Could not complete this action. Check the session status and try again.'); }
    finally { busyRef.current = false; if (aliveRef.current) setBusy(false); }
  };
  const start = () => {
    const error = validateSessionSlug(slug);
    if (error) { setMessage(error); return; }
    void run(() => bridge.start({ slug }));
  };
  const canStart = !!status?.available && status.state === 'stopped';
  const active = !!status && !['stopped', 'failed'].includes(status.state);
  const shareable = status?.state === 'online' && validSessionLink(status.joinUrl, status.slug);
  return <section className="remote-host-panel" aria-label="Internet singer session">
    <h2>Internet Session</h2>
    <p>Let singers browse your loaded songs and send requests from their phones, on venue Wi-Fi or the internet. Keep this app open and connected.</p>
    <p role="status" aria-live="polite">{message || status?.message || 'Loading internet session…'}</p>
    <label>Session address<input value={slug} onChange={event => { editedRef.current = true; setSlug(event.target.value); }}
      disabled={!canStart || busy} maxLength={48} autoCapitalize="none" autoComplete="off" spellCheck={false}
      aria-describedby="internet-session-address-help" /></label>
    <p id="internet-session-address-help">Choose an easy name to share, such as proper-volume. Session names are temporary and may already be in use.</p>
    {canStart && <button type="button" disabled={busy} onClick={start}>Start Session</button>}
    {shareable && <>
      <p>Anyone with this link can join. Share it with the people you want in your show.</p>
      <label>Singer link<input readOnly value={status.joinUrl!} onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" disabled={busy} onClick={() => void run(() => bridge.copyLink(), 'Singer link copied.')}>Copy Link</button>
      <h3>Internet Singer Screen</h3>
      <p>Share a visual-only screen with anyone who has the full link. Audio stays at the venue. If the connection is lost, the last frame can remain visible for a few seconds.</p>
      {status.screenActive && status.screenUrl ? <>
        <label>Singer screen link<input readOnly value={status.screenUrl} onFocus={event => event.currentTarget.select()} /></label>
        <button type="button" disabled={busy} onClick={() => void run(() => bridge.copyScreenLink!(), 'Singer-screen link copied.')}>Copy Screen Link</button>{' '}
        <button type="button" disabled={busy} onClick={() => void run(() => bridge.stopScreen!())}>Stop Internet Screen</button>
      </> : <button type="button" disabled={busy || !bridge.startScreen} onClick={() => void run(() => bridge.startScreen!())}>Share Internet Screen</button>}
      <h3>Connected Singers</h3>
      {status.guests.length ? <ul>{status.guests.map(guest => <li key={guest.singerId}><span>{guest.name}</span>
        <button type="button" disabled={busy} onClick={() => void run(() => bridge.revokeGuest(guest.singerId))}>Remove Access</button>
      </li>)}</ul> : <p>No singers have joined yet.</p>}
    </>}
    {(active || status?.state === 'failed') && <button type="button" disabled={busy || status?.state === 'stopping'} onClick={() => void run(() => bridge.stop())}>End Session</button>}
    {active && <p>Ending this session removes internet singer access. Your local songs, queue and separate local-network room stay available.</p>}
  </section>;
}

import React, { useEffect, useRef, useState } from 'react';
import { validInternetInvitation, type InternetRelayBridge, type InternetRelayStatus } from './internet-control';

/** Unmounted preview. No executable is installed and no tunnel can start without an injected bridge. */
export function HostInternetPanel({ bridge }: { bridge: InternetRelayBridge }) {
  const [status, setStatus] = useState<InternetRelayStatus | null>(null);
  const statusRef = useRef<InternetRelayStatus | null>(null);
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [ttl, setTtl] = useState('900');
  const [link, setLink] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  useEffect(() => {
    let alive = true, received = false;
    statusRef.current = null; setStatus(null); setLink(''); setExpiresAt(0);
    const update = (value: InternetRelayStatus) => {
      if (!alive) return;
      const previous = statusRef.current;
      received = true; statusRef.current = value; setStatus(value);
      if (!value.available || value.state !== 'online' || (previous?.roomId && previous.roomId !== value.roomId) || (previous?.origin && previous.origin !== value.origin)) { setLink(''); setExpiresAt(0); }
    };
    const unsubscribe = bridge.subscribe(update);
    void bridge.status().then(value => { if (!received) update(value); }).catch(() => { if (alive) setMessage('Internet queue status is unavailable.'); });
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => { setLink(''); setExpiresAt(0); }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try { await action(); } catch { setMessage('Could not complete the internet queue action. Check the connector and try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const createInvite = () => void run(async () => {
    const seconds = Number(ttl), roomId = statusRef.current?.roomId, startedAt = Date.now();
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600 || !roomId) { setMessage('Choose an invitation duration from 1 to 60 minutes.'); return; }
    const value = await bridge.createInvitation(seconds);
    if (Date.now() >= startedAt + seconds * 1000 || !statusRef.current?.available || statusRef.current.state !== 'online' || statusRef.current.roomId !== roomId || !validInternetInvitation(value, statusRef.current.origin)) { setMessage('The invitation could not be displayed safely.'); return; }
    setLink(value); setExpiresAt(startedAt + seconds * 1000);
  });
  const online = !!status?.available && status.state === 'online';
  const canPrepare = !!status?.available && status.state === 'stopped';
  const canStart = canPrepare && status.connector.state === 'verified' && status.loopbackTls === 'ready';
  return <section className="remote-host-panel" aria-label="Internet queueing">
    <h2>Internet Queueing</h2>
    <p>Experimental development feature. Cloudflare relays this traffic and can see guest requests and credentials.</p>
    <p role="status">{message || status?.message || (status ? `Internet relay: ${status.state}` : 'Loading internet queue status…')}</p>
    {status?.available && status.state === 'failed' && <button type="button" disabled={busy} onClick={() => void run(() => bridge.stop())}>Retry stopping internet queueing</button>}
    {canPrepare && <>
      <p>Select a trusted, compatible cloudflared executable. This app does not download or update it automatically.</p>
      <button type="button" disabled={busy} onClick={() => void run(() => bridge.chooseConnector())}>Choose connector…</button>
      <p>{status.connector.label || 'No connector selected'} ({status.connector.state})</p>
      <button type="button" disabled={busy} onClick={() => void run(() => bridge.prepareLoopbackTls())}>Prepare local TLS</button>
      <p>Local TLS: {status.loopbackTls}</p>
      <button type="button" disabled={busy || !canStart} onClick={() => void run(() => bridge.start())}>Start internet queueing</button>
    </>}
    {online && <>
      <p>Anyone with an invitation link can join while it is valid.</p>
      <label>Invitation duration<select value={ttl} onChange={event => setTtl(event.target.value)} disabled={busy}>
        <option value="300">5 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option><option value="3600">60 minutes</option>
      </select></label>
      <button type="button" disabled={busy} onClick={createInvite}>Create internet invitation</button>{' '}
      <button type="button" disabled={busy} onClick={() => void run(async () => { setLink(''); setExpiresAt(0); await bridge.revokeInvitations(); })}>Revoke internet invitations</button>
      {link && <label>Internet invitation link<input readOnly value={link} onFocus={event => event.currentTarget.select()} /></label>}
      <h3>Internet Singers</h3>
      {status.guests.length ? <ul>{status.guests.map(guest => <li key={guest.id}><span>{guest.name}</span><button type="button" disabled={busy} onClick={() => void run(() => bridge.revokeGuest(guest.id))}>Revoke internet access</button></li>)}</ul> : <p>No internet singers have joined.</p>}
      <button type="button" disabled={busy} onClick={() => void run(async () => { setLink(''); setExpiresAt(0); await bridge.stop(); })}>Stop internet queueing</button>
    </>}
  </section>;
}

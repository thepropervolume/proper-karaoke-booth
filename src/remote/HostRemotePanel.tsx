import React, { useEffect, useRef, useState } from 'react';
import { validInvitation, validateOpenLan, type HostRemoteBridge, type HostRemoteStatus, type SelectedFile } from './host-control';
import './host-control.css';

/** Unmounted preview: this component cannot start networking without a trusted host bridge. */
export function HostRemotePanel({ bridge }: { bridge: HostRemoteBridge }) {
  const [status, setStatus] = useState<HostRemoteStatus | null>(null);
  const statusRef = useRef<HostRemoteStatus | null>(null);
  const [interfaceId, setInterfaceId] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('8443');
  const [certificate, setCertificate] = useState<SelectedFile | null>(null);
  const [privateKey, setPrivateKey] = useState<SelectedFile | null>(null);
  const [ttl, setTtl] = useState('900');
  const [link, setLink] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true, received = false;
    statusRef.current = null; setStatus(null); setLink(''); setExpiresAt(0);
    const update = (value: HostRemoteStatus) => {
      if (!active) return;
      const previousOrigin = statusRef.current?.lanOrigin, previousRoom = statusRef.current?.roomId;
      received = true; statusRef.current = value; setStatus(value);
      if (value.room !== 'open' || (previousOrigin && previousOrigin !== value.lanOrigin) || (previousRoom && previousRoom !== value.roomId)) { setLink(''); setExpiresAt(0); }
    };
    const unsubscribe = bridge.subscribe(update);
    void bridge.status().then(value => { if (!received) update(value); }).catch(() => { if (active) setMessage('Remote queue status is unavailable.'); });
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => { setLink(''); setExpiresAt(0); }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try { await action(); }
    catch { setMessage('Could not complete the remote queue action. Check the show and try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const open = () => void run(async () => {
    const input = { interfaceId, hostname: hostname.trim(), port: Number(port), certificateToken: certificate?.token ?? '', privateKeyToken: privateKey?.token ?? '' };
    const error = validateOpenLan(input, statusRef.current?.interfaces ?? []);
    if (error) { setMessage(error); return; }
    await bridge.openLan(input);
  });
  const makeInvitation = () => void run(async () => {
    const seconds = Number(ttl);
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600) { setMessage('Choose an invitation duration from 1 to 60 minutes.'); return; }
    const startedAt = Date.now(), roomId = statusRef.current?.roomId;
    const value = await bridge.createInvitation(seconds);
    if (!roomId || statusRef.current?.room !== 'open' || statusRef.current.roomId !== roomId || !validInvitation(value, statusRef.current.lanOrigin)) { setMessage('The invitation could not be displayed safely.'); return; }
    setLink(value); setExpiresAt(startedAt + seconds * 1000);
  });
  const roomOpen = status?.room === 'open';
  const roomClosed = status?.room === 'closed';
  return <section className="remote-host-panel" aria-label="Remote queueing">
    <h2>Remote Queueing</h2>
    <p>Invite singers to browse songs and send requests. Remote access is off until you open a room.</p>
    <p>Internet access requires a separate relay and is not available yet.</p>
    <p role="status">{message || status?.message || (status ? `Room: ${status.room}` : 'Loading remote queue status…')}</p>
    {status?.room === 'failed' && <button type="button" disabled={busy} onClick={() => void run(() => bridge.closeRoom())}>Retry closing room</button>}
    {roomClosed && status?.available && <>
      <h3>Local Network</h3>
      <p>Use a hostname and certificate that singers' devices already trust. The hostname must resolve to this computer on the venue network.</p>
      <label>Network interface<select value={interfaceId} onChange={event => setInterfaceId(event.target.value)} disabled={busy}>
        <option value="">Choose an interface</option>{status.interfaces.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label>Certificate hostname<input value={hostname} onChange={event => setHostname(event.target.value)} disabled={busy} autoComplete="off" /></label>
      <label>Port<input type="number" min="1" max="65535" step="1" value={port} onChange={event => setPort(event.target.value)} disabled={busy} /></label>
      <div><button type="button" disabled={busy} onClick={() => void run(async () => { const selected = await bridge.chooseCertificate(); if (selected) setCertificate(selected); })}>Choose certificate…</button> <span>{certificate?.label ?? 'None selected'}</span></div>
      <div><button type="button" disabled={busy} onClick={() => void run(async () => { const selected = await bridge.choosePrivateKey(); if (selected) setPrivateKey(selected); })}>Choose private key…</button> <span>{privateKey?.label ?? 'None selected'}</span></div>
      <button type="button" disabled={busy} onClick={open}>Open local room</button>
    </>}
    {roomOpen && <>
      <h3>Invitations</h3><p>Anyone with this link can join while it is valid. Share it only with people you want to admit.</p>
      <label>Invitation duration<select value={ttl} onChange={event => setTtl(event.target.value)} disabled={busy}>
        <option value="300">5 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option><option value="3600">60 minutes</option>
      </select></label>
      <button type="button" disabled={busy} onClick={makeInvitation}>Create invitation</button>{' '}
      <button type="button" disabled={busy} onClick={() => void run(async () => { setLink(''); setExpiresAt(0); await bridge.revokeInvitations(); })}>Revoke invitations</button>
      {link && <label>Invitation link<input readOnly value={link} onFocus={event => event.currentTarget.select()} /></label>}
      <h3>Admitted Singers</h3>
      {status.guests.length ? <ul>{status.guests.map(guest => <li key={guest.singerId}><span>{guest.name}</span><button type="button" disabled={busy} onClick={() => void run(() => bridge.revokeGuest(guest.singerId))}>Revoke access</button></li>)}</ul> : <p>No singers have joined.</p>}
      <p>Revoking invitations prevents new joins; it does not remove singers already admitted. Close the room to revoke all guest access.</p>
      <button type="button" disabled={busy} onClick={() => void run(async () => { setLink(''); setExpiresAt(0); await bridge.closeRoom(); })}>Close room</button>
    </>}
  </section>;
}

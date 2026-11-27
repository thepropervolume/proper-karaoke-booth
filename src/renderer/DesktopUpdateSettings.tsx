import React, { useEffect, useState } from 'react';
import { DESKTOP_UPDATE_LABELS, DESKTOP_UPDATE_MODES, isDesktopUpdateMode, type DesktopUpdateMode, type DesktopUpdateStatus } from '../domain/desktop-update-preference';

export function DesktopUpdateSettings({ mode, onChange }: { mode: DesktopUpdateMode; onChange: (value: DesktopUpdateMode) => void }) {
  const [status, setStatus] = useState<DesktopUpdateStatus>({ phase: 'idle' });
  useEffect(() => {
    let mounted = true;
    let received = false;
    const unsubscribe = window.tpv.onDesktopUpdate(value => { received = true; setStatus(value); });
    void window.tpv.desktopUpdateStatus().then(value => { if (mounted && !received) setStatus(value); }).catch(() => {});
    return () => { mounted = false; unsubscribe(); };
  }, []);
  const unavailable = status.phase === 'unavailable';
  const message = status.message ?? (status.phase === 'checking' ? 'Checking or downloading updates…' :
    status.phase === 'current' ? 'You’re running the latest available version.' :
    status.phase === 'available' ? 'Booth ' + status.version + ' is available.' :
    status.phase === 'downloaded' ? 'Booth ' + status.version + ' is ready.' : '');
  return <>
      <label>Available Updates Mechanism
        <select value={mode} onChange={event => {
          const selected = event.currentTarget.value;
          if (isDesktopUpdateMode(selected)) onChange(selected);
        }}>
          {DESKTOP_UPDATE_MODES.map(value => <option key={value} value={value}>{DESKTOP_UPDATE_LABELS[value]}</option>)}
        </select>
      </label>
      {mode === 'install' && <p className="muted">Updates apply when you quit normally. The system installer may ask for confirmation.</p>}
      <div className="settings-inline-help">
        <button type="button" disabled={unavailable || status.phase === 'checking'} onClick={() => void window.tpv.checkDesktopUpdate().catch(() => {})}>Check Now</button>
        {status.phase === 'available' && <button type="button" onClick={() => void window.tpv.downloadDesktopUpdate().catch(() => {})}>Download Update</button>}
        {status.phase === 'downloaded' && <button type="button" onClick={() => void window.tpv.revealDesktopUpdate().catch(() => setStatus({ phase: 'error', message: 'The downloaded update could not be opened. Check for updates again.' }))}>Show Download</button>}
      </div>
      {message && <p role="status">{message}</p>}
  </>;
}

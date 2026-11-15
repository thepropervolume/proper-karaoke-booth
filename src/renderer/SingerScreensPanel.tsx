import React, { useEffect, useState } from 'react';
import type { Settings } from '../domain/settings';
import type { SingerScreenBridge, SingerScreenUiStatus } from './SingerPreview';

export function SingerScreensPanel({ bridge, settings, onSave }: { bridge: SingerScreenBridge; settings: Settings; onSave(patch: Partial<Settings>): Promise<void> }) {
  const [status, setStatus] = useState<SingerScreenUiStatus | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let alive = true; const refresh = () => void bridge.status().then(value => { if (alive) setStatus(value); }).catch(() => { if (alive) setMessage('Singer-screen sharing status is unavailable.'); }); refresh(); const timer = window.setInterval(refresh, 2000); return () => { alive = false; window.clearInterval(timer); }; }, [bridge, settings]);
  const toggle = async () => { setBusy(true); setMessage(''); try { await onSave({ singerScreenEnabled: !settings.singerScreenEnabled }); setStatus(await bridge.status()); } catch { setMessage('Could not change singer-screen sharing.'); } finally { setBusy(false); } };
  return <section className="lan-screen-panel" aria-label="LAN singer screens"><h2>LAN Singer Screens</h2>
    <p className="muted">Share lyrics on this network. Audio stays on the host.</p>
    <button type="button" className={settings.singerScreenEnabled ? '' : 'primary'} disabled={busy} onClick={() => void toggle()}>{settings.singerScreenEnabled ? 'Stop Singer-Screen Sharing' : 'Start Singer-Screen Sharing'}</button>
    {status?.status === 'running' && <><p>{status.viewers} / {status.maximumViewers} browsers connected · port {status.port}</p>{status.urls.map(url => <div className="lan-screen-link" key={url}><input aria-label={`Singer screen address ${url}`} readOnly value={url} onFocus={event => event.currentTarget.select()} /><button type="button" onClick={() => void bridge.copyUrl(url).then(() => setMessage('Singer-screen link copied.')).catch(() => setMessage('Could not copy the link.'))}>Copy Link</button></div>)}<p className="muted">{status.urls.some(url => !url.includes('127.0.0.1') && !url.includes('[::1]')) ? 'Use a LAN address on your venue network. Loopback (127.0.0.1) works only on this computer.' : 'Only this computer is available. No private LAN adapter could be verified. Check Windows network settings and retry.'}</p><button type="button" onClick={() => void bridge.retry().then(setStatus).catch(() => setMessage('Could not retry sharing.'))}>Refresh Addresses</button></>}
    {status?.status === 'error' && <><p role="alert">{status.message || 'Could not open the singer-screen port. Choose a different port in Preferences → Singer Display.'}</p><button type="button" onClick={() => void bridge.retry().then(setStatus)}>Retry Sharing</button></>}
    {message && <p role="status">{message}</p>}
    <p className="muted">Anyone who can reach this LAN port can view the singer screen while sharing is enabled. It does not expose host controls. Keep the port private to the venue; internet remote requests use a separate Remote Session link.</p>
  </section>;
}

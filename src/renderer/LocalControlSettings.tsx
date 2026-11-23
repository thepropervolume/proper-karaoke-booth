import React, { useEffect, useState } from 'react';

export type LocalControlUiStatus = { enabled: boolean; status: 'disabled' | 'stopped' | 'ready' | 'failed'; port?: number; message?: string };
export function LocalControlSettings({ enabled, queueEnabled, onChange, onQueueChange }:
  { enabled: boolean; queueEnabled: boolean; onChange: (enabled: boolean) => void; onQueueChange: (enabled: boolean) => void }) {
  const [status, setStatus] = useState<LocalControlUiStatus | null>(null);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState('');
  const check = async () => {
    setError('');
    try { setStatus(await window.tpv.getLocalControlStatus()); }
    catch { setError('The local control status could not be read.'); }
  };
  useEffect(() => { void check(); }, []);
  const install = async () => {
    if (installing) return;
    setInstalling(true); setError(''); setInstalled('');
    try { const result = await window.tpv.installControlCli(); setInstalled(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not install the CLI.'); }
    finally { setInstalling(false); }
  };
  return <div className="local-control-settings">
    <label className="settings-check"><input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked)} /> Enable Local API and CLI</label>
    <label className="settings-check"><input type="checkbox" checked={enabled && queueEnabled} disabled={!enabled} onChange={event => onQueueChange(event.target.checked)} /> Allow Local API to change the queue</label>
    <p className="muted">Save Preferences to apply. With queue changes enabled, a local script can add, moderate and reorder requests. Playback stays under the host’s control.</p>
    <p className="muted">Access is limited to this computer and a private host token. The CLI reads the protected connection file automatically; no database password is required.</p>
    <p>With Booth running, open a terminal on this computer and run <code>tpv-karaoke-booth --help</code>. To check the connection, run <code>tpv-karaoke-booth status</code>.</p>
    <button className="link" type="button" onClick={() => void window.tpv.showControlDocumentation().catch(() => setError('Could not open the Local API and CLI guide.'))}>Local API and CLI documentation</button>
    <div className="settings-logo-actions"><button type="button" onClick={() => void check()}>Check Local API</button><button type="button" onClick={() => { void window.tpv.showControlCli().catch(() => setError('The CLI files are not built yet. Build or install the latest app first.')); }}>Show CLI Tool</button><button type="button" disabled={installing} onClick={() => void install()}>{installing ? 'Installing…' : 'Install CLI to PATH'}</button></div>
    {status && <p role="status">{status.status === 'ready' ? `Local API ready on 127.0.0.1:${status.port}.` : status.status === 'disabled' ? 'Local API is disabled.' : status.message || 'Local API is not running.'}{enabled !== status.enabled ? ' Save Preferences to apply your draft.' : ''}</p>}
    {installed && <p role="status">{installed}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

import React, { useEffect, useState } from 'react';

export type LocalControlUiStatus = { enabled: boolean; status: 'disabled' | 'stopped' | 'ready' | 'failed'; port?: number; message?: string };
export function LocalControlSettings({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  const [status, setStatus] = useState<LocalControlUiStatus | null>(null);
  const [error, setError] = useState('');
  const check = async () => {
    setError('');
    try { setStatus(await window.tpv.getLocalControlStatus()); }
    catch { setError('The local control status could not be read.'); }
  };
  useEffect(() => { void check(); }, []);
  return <div className="local-control-settings">
    <label className="settings-check"><input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked)} /> Enable Local API and CLI</label>
    <p className="muted">Save Preferences to apply. The initial API reads this running show, settings and shortcuts, and opens Preferences or Keyboard Shortcuts. Playback and queue changes through the API are not available yet.</p>
    <p className="muted">Access is limited to this computer and a private host token. The CLI reads the protected connection file automatically; no database password is required.</p>
    <div className="settings-logo-actions"><button type="button" onClick={() => void check()}>Check Local API</button><button type="button" onClick={() => { void window.tpv.showControlCli().catch(() => setError('The CLI files are not built yet. Build or install the latest app first.')); }}>Show CLI Tool</button></div>
    {status && <p role="status">{status.status === 'ready' ? `Local API ready on 127.0.0.1:${status.port}.` : status.status === 'disabled' ? 'Local API is disabled.' : status.message || 'Local API is not running.'}{enabled !== status.enabled ? ' Save Preferences to apply your draft.' : ''}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

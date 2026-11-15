import React, { useEffect, useRef, useState } from 'react';
import type { Settings } from '../domain/settings';
import { Tooltip } from './Tooltip';

export type SingerBrandingBridge = Pick<typeof window.tpv, 'getDisplayLogo' | 'onDisplayLogo' | 'chooseDisplayLogo' | 'clearDisplayLogo'>;
const pad = (value: number) => String(value).padStart(2, '0');

/** datetime-local uses the host's wall clock; persisted settings use an absolute instant. */
export function bannerExpiryForInput(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function bannerExpiryFromInput(value: string): string {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Error('Choose a valid local banner stop time.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || bannerExpiryForInput(date.toISOString()) !== value) throw Error('Choose a valid local banner stop time.');
  return date.toISOString();
}

export function SingerBrandingSettings({ value, onChange, bridge = window.tpv }: {
  value: Settings; onChange: (value: Settings) => void; bridge?: SingerBrandingBridge;
}) {
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true), revision = useRef(0);
  useEffect(() => {
    active.current = true;
    const unsubscribe = bridge.onDisplayLogo(next => { revision.current++; if (active.current) setLogo(next); });
    const reading = ++revision.current;
    void bridge.getDisplayLogo().then(next => { if (active.current && reading === revision.current) setLogo(next); })
      .catch(() => { if (active.current && reading === revision.current) setError('Could not load the logo preview.'); });
    return () => { active.current = false; revision.current++; unsubscribe(); };
  }, [bridge]);
  const updateLogo = async (remove = false) => {
    setBusy(true); setError('');
    try {
      if (remove) await bridge.clearDisplayLogo();
      else if (!await bridge.chooseDisplayLogo()) return;
      const reading = ++revision.current;
      const next = await bridge.getDisplayLogo();
      if (active.current && reading === revision.current) setLogo(next);
    } catch { if (active.current) setError('Could not update the logo. Try a PNG or JPEG up to 2 MB.'); }
    finally { if (active.current) setBusy(false); }
  };
  return <div className="singer-branding-settings">
    <label>Booth Name<input aria-label="Booth Name" type="text" required maxLength={120} value={value.boothName} onChange={event => onChange({ ...value, boothName: event.target.value })} /></label>
    <div className="settings-logo-picker">
      <div className="settings-logo-preview" aria-label="Selected singer display logo">
        {logo ? <img src={logo} alt="Selected singer display logo" /> : <span>No logo selected</span>}
      </div>
      <div className="settings-logo-picker__controls">
        <label className="settings-check"><input type="checkbox" checked={value.showDisplayLogo} onChange={event => onChange({ ...value, showDisplayLogo: event.target.checked })} /> Show custom logo</label>
        <div className="settings-logo-actions"><button type="button" disabled={busy} onClick={() => void updateLogo()}>Choose Logo…</button><button type="button" disabled={busy || !logo} onClick={() => void updateLogo(true)}>Remove Logo</button></div>
        <p className="muted">Logo selection applies immediately.</p>
      </div>
    </div>
    <label>Logo Size <span className="settings-range"><input aria-label="Logo Size" type="range" min="10" max="85" step="1" value={value.displayLogoSize} onChange={event => onChange({ ...value, displayLogoSize: Number(event.target.value) })} /><output>{value.displayLogoSize}% of screen width</output></span></label>
    <div className="settings-subheading"><h3>Scrolling Banner</h3><Tooltip text="Show a message during the show. Leave the stop time blank to keep it visible until you turn it off or quit. Enable Show After Restart to keep it on future launches."><button type="button" className="help-button" aria-label="Scrolling banner help">?</button></Tooltip></div>
    <label className="settings-check"><input type="checkbox" checked={value.bannerEnabled} onChange={event => onChange({ ...value, bannerEnabled: event.target.checked })} /> Show scrolling banner</label>
    <label>Banner Message<input aria-label="Banner Message" type="text" maxLength={1000} value={value.bannerText} onChange={event => onChange({ ...value, bannerText: event.target.value })} /></label>
    <div className="settings-field-pair">
      <label>Banner Position<select aria-label="Banner Position" value={value.bannerPosition} onChange={event => onChange({ ...value, bannerPosition: event.target.value as Settings['bannerPosition'] })}><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
      <label>Stop Showing At (optional)<input aria-label="Banner Stop Time" type="datetime-local" value={bannerExpiryForInput(value.bannerExpiresAt)} onChange={event => {
        try { const bannerExpiresAt = bannerExpiryFromInput(event.target.value); setError(''); onChange({ ...value, bannerExpiresAt }); }
        catch { setError('Choose a valid local banner stop time.'); }
      }} /></label>
    </div>
    <label className="settings-check"><input type="checkbox" checked={value.bannerOnLaunch} onChange={event => onChange({ ...value, bannerOnLaunch: event.target.checked })} /> Show After Restart</label>
    {error && <p role="alert">{error}</p>}
  </div>;
}

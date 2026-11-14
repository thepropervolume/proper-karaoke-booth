import React, { useState } from 'react';
import type { Settings } from '../domain/settings';
import type { YouTubeSearchBridge } from './YouTubeSearchPanel';

export function YouTubeSearchSettings({ value, onChange, bridge }: { value: Settings; onChange(next: Settings): void; bridge: YouTubeSearchBridge }) {
  const [message, setMessage] = useState(''), [importing, setImporting] = useState(false);
  const lines = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return <details className="settings-group" data-settings-section="youtube"><summary>YouTube Search</summary><div className="settings-group__content">
    <label className="settings-check"><input type="checkbox" checked={value.youtubeSearchEnabled} onChange={event => onChange({ ...value, youtubeSearchEnabled: event.target.checked })} />Include YouTube karaoke in library search</label>
    <label>Channel selection<select value={value.youtubeSearchMode} onChange={event => onChange({ ...value, youtubeSearchMode: event.target.value as Settings['youtubeSearchMode'] })}><option value="karaoke-channels">Karaoke channel hints and approved channels</option><option value="approved-channels">Approved channels only</option></select></label>
    <p className="muted">Every search includes “karaoke.” Results must also identify a karaoke video and a suitable channel. These are metadata filters, not a guarantee of track quality.</p>
    <label>Approved YouTube channels, one per line<textarea rows={4} value={value.youtubeApprovedChannels.join('\n')} onChange={event => onChange({ ...value, youtubeApprovedChannels: lines(event.target.value) })} placeholder={'UC channel ID, @handle, or canonical channel URL'} /></label>
    <label>Blocked YouTube channels, one per line<textarea rows={4} value={value.youtubeBlockedChannels.join('\n')} onChange={event => onChange({ ...value, youtubeBlockedChannels: lines(event.target.value) })} placeholder={'UC channel ID or @handle'} /></label>
    <p className="muted">Blocked channels override approvals. Stable channel IDs are preferred; channel display names are not accepted. Live streams, restricted videos and videos outside 45–1800 seconds are omitted.</p>
    <button type="button" disabled={importing} onClick={() => { setImporting(true); setMessage(''); void bridge.importSubscriptions().then(result => { if (!result) return; const channels = [...new Set([...value.youtubeApprovedChannels, ...result.channels])]; onChange({ ...value, youtubeApprovedChannels: channels }); setMessage(`${result.channels.length} subscription channel IDs imported; ${result.ignored} unsupported rows ignored. Save preferences to apply.`); }).catch(error => setMessage(error instanceof Error ? error.message : 'Could not import subscriptions.')).finally(() => setImporting(false)); }}>Import Google Takeout Subscriptions…</button>
    <p className="muted">Export your YouTube subscriptions as CSV or JSON through Google Takeout, then import that file. The app does not access your private subscription feed or browser cookies. Imported channels still need a karaoke-indicated video title.</p>
    {message && <p role="status">{message}</p>}
  </div></details>;
}

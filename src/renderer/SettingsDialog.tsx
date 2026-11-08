import React, { useEffect, useRef, useState } from 'react';
import type { Settings } from '../domain/settings';
import { AudioOutputPicker } from './AudioOutputPicker';
import { BumperControls } from './BumperPanel';
import { HostRemotePanel } from '../remote/HostRemotePanel';
import '../styles/settings.scss';

export function SettingsDialog({ value, path, shortcutsPath, onSave, onClose }: {
  value: Settings; path: string; shortcutsPath: string; onSave: (value: Settings) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value);
  const [templates, setTemplates] = useState(value.metadataTemplates.join('\n'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave({ ...draft, metadataTemplates: templates.split(/\r?\n/).map(line => line.trim()).filter(Boolean) }); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  const reveal = async (kind: 'settings' | 'shortcuts') => {
    setError('');
    try { await window.tpv.revealConfigFile(kind); }
    catch (reason) { setError(`Could not show the file: ${reason instanceof Error ? reason.message : String(reason)}`); }
  };
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="settings-title">Preferences</h2>
      <div className="settings-groups">
        <details className="settings-group" open>
          <summary>Appearance</summary>
          <div className="settings-group__content">
            <label>Appearance<select value={draft.appearance} onChange={event => setDraft({ ...draft, appearance: event.target.value as Settings['appearance'] })}>
              <option value="system">Follow system</option><option value="night">Night</option><option value="day">Day</option>
            </select></label>
            <label>Workspace layout<select value={draft.layout} onChange={event => setDraft({ ...draft, layout: event.target.value as Settings['layout'] })}>
              <option value="standard">Standard</option><option value="rotation">Wider singer rotation</option><option value="library">Wide song library</option>
            </select></label>
          </div>
        </details>
        <details className="settings-group">
          <summary>Library Settings</summary>
          <div className="settings-group__content">
            <label>Filename and folder templates, one per line<textarea rows={4} value={templates} onChange={event => setTemplates(event.target.value)} placeholder={'${DJ Code} - ${Artist} - ${Track Name}\n${Artist}/${Title}.mp4'} /></label>
            <p className="muted">Templates are tried in order. Use {'${Artist}'}, {'${Title}'} or {'${Track Name}'}, {'${DJ Code}'}, and {'${Track Number}'}. Use / between folders; .mp4 is optional.</p>
            <label>When no template matches<select value={draft.metadataFormat} onChange={event => setDraft({ ...draft, metadataFormat: event.target.value as Settings['metadataFormat'] })}>
              <option value="artist-title">Artist - Title</option><option value="title-artist">Title - Artist</option><option value="filename">Full filename as title</option>
            </select></label>
            <p className="muted">Used when importing new songs. Existing songs keep their current metadata.</p>
          </div>
        </details>
        <details className="settings-group">
          <summary>Queue Management</summary>
          <div className="settings-group__content">
            <label className="settings-check"><input type="checkbox" checked={draft.rotationMode === 'singer'} onChange={event => setDraft({ ...draft, rotationMode: event.target.checked ? 'singer' : 'fifo' })} /> Rotate singers fairly</label>
            <p className="muted">When enabled, singers get a turn before their next song. Otherwise songs play in request order. A staged song stays locked when changing modes.</p>
            <label className="settings-check"><input type="checkbox" checked={draft.autoApprove} onChange={event => setDraft({ ...draft, autoApprove: event.target.checked })} /> Automatically approve new requests</label>
            <p className="muted">Changing this affects new requests; requests already awaiting review remain pending.</p>
          </div>
        </details>
        <details className="settings-group">
          <summary>Remote Queueing</summary>
          <div className="settings-group__content"><HostRemotePanel bridge={window.tpv.remote} /></div>
        </details>
        <details className="settings-group">
          <summary>Audio Controls</summary>
          <div className="settings-group__content">
            <AudioOutputPicker value={draft.audioOutputId} onChange={audioOutputId => setDraft({ ...draft, audioOutputId })} />
            <label>Playback Volume <input type="range" aria-label="Playback Volume" min="0" max="100" step="1" value={Math.round(draft.masterVolume * 100)} onChange={event => setDraft({ ...draft, masterVolume: Number(event.target.value) / 100 })} /><span>{Math.round(draft.masterVolume * 100)}%</span></label>
            <p className="muted">Controls song and bumper volume. Changes apply when you save.</p>
            <label>Pause Interval (seconds)<input type="number" min="0" max="300" step="1" value={draft.pauseIntervalSeconds} onChange={event => setDraft({ ...draft, pauseIntervalSeconds: Number(event.target.value) })} /></label>
            <p className="muted">Wait this long after a song ends or is skipped before starting the next. The host still presses Play; 0 disables the interval.</p>
            <BumperControls />
          </div>
        </details>
        <details className="settings-group">
          <summary>Singer Display</summary>
          <div className="settings-group__content">
            <label className="settings-check"><input type="checkbox" checked={draft.showNextSingers} onChange={event => setDraft({ ...draft, showNextSingers: event.target.checked })} /> Show the next singers</label>
            <label className="settings-check"><input type="checkbox" checked={draft.showDisplayLogo} onChange={event => setDraft({ ...draft, showDisplayLogo: event.target.checked })} /> Show custom logo when available</label>
            <div className="settings-logo-actions"><button type="button" onClick={() => void window.tpv.chooseDisplayLogo().catch(reason => setError(String(reason)))}>Choose logo…</button><button type="button" onClick={() => void window.tpv.clearDisplayLogo().catch(reason => setError(String(reason)))}>Remove logo</button></div>
            <p className="muted">Choose a PNG or JPEG up to 2 MB. Choosing or removing a logo takes effect immediately; the visibility options apply when you save.</p>
          </div>
        </details>
        <details className="settings-group">
          <summary>Configuration Files</summary>
          <div className="settings-group__content">
            <p><span className="settings-tooltip"><button className="settings-file" type="button" aria-describedby="settings-file-tip" onClick={() => void reveal('settings')}>Show settings.json in file manager</button><span id="settings-file-tip" role="tooltip">Show {path} in the file manager</span></span></p>
            <p><span className="settings-tooltip"><button className="settings-file" type="button" aria-describedby="shortcuts-file-tip" onClick={() => void reveal('shortcuts')}>Show keybindings.json in file manager</button><span id="shortcuts-file-tip" role="tooltip">Show {shortcutsPath} in the file manager</span></span></p>
            <p className="muted">Close the app before editing settings. Restart to apply file edits.</p>
          </div>
        </details>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="settings-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving}>Save preferences</button></div>
    </form>
  </dialog>;
}

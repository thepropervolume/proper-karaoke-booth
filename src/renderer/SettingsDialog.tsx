import React, { useEffect, useRef, useState } from 'react';
import type { Settings } from '../domain/settings';
import { AudioOutputPicker } from './AudioOutputPicker';
import { BumperControls } from './BumperPanel';
import { HostRemotePanel } from '../remote/HostRemotePanel';
import { SharedCatalogControls } from './SharedCatalogControls';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { RatingProfileControls } from './RatingProfileControls';
import { LocalControlSettings } from './LocalControlSettings';
import type { Shortcuts } from '../domain/shortcuts';
import type { SettingsSection } from '../domain/app-action';
import '../styles/settings.scss';

export function SettingsDialog({ value, path, shortcutsPath, shortcuts, onSaveShortcuts, initialSection = 'general', focusRequest = 0, onSave, onClose }: {
  value: Settings; path: string; shortcutsPath: string; onSave: (value: Partial<Settings>) => Promise<void>; onClose: () => void;
  shortcuts: Shortcuts; onSaveShortcuts: (value: Shortcuts) => Promise<void>; initialSection?: SettingsSection; focusRequest?: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value);
  const baseline = useRef<Settings | null>(null);
  if (!baseline.current) baseline.current = structuredClone(value);
  const [templates, setTemplates] = useState(value.metadataTemplates.join('\n'));
  const [cacheBrands, setCacheBrands] = useState(value.karaokeNerdsBrands.join('\n'));
  const [cacheArtists, setCacheArtists] = useState(value.karaokeNerdsArtists.join('\n'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { baseline.current!.appearance = value.appearance; setDraft(current => ({ ...current, appearance: value.appearance })); }, [value.appearance]);
  useEffect(() => { baseline.current!.accentColor = value.accentColor; setDraft(current => ({ ...current, accentColor: value.accentColor })); }, [value.accentColor]);
  useEffect(() => { baseline.current!.layout = value.layout; setDraft(current => ({ ...current, layout: value.layout })); }, [value.layout]);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => {
    if (initialSection === 'general') return;
    const section = dialog.current?.querySelector<HTMLDetailsElement>(`[data-settings-section="${initialSection}"]`);
    if (section) {
      section.open = true;
      requestAnimationFrame(() => { section.scrollIntoView({ block: 'start' }); section.querySelector<HTMLElement>('summary')?.focus(); });
    }
  }, [initialSection, focusRequest]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try { const next = { ...draft, metadataTemplates: templates.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
      karaokeNerdsBrands: cacheBrands.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
      karaokeNerdsArtists: cacheArtists.split(/\r?\n/).map(line => line.trim()).filter(Boolean) };
      const patch = Object.fromEntries((Object.keys(next) as (keyof Settings)[]).filter(key => JSON.stringify(next[key]) !== JSON.stringify(baseline.current![key])).map(key => [key, next[key]]));
      await onSave(patch); onClose(); }
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
        <SharedCatalogControls value={draft} onChange={setDraft} />
        <details className="settings-group" data-settings-section="ratings">
          <summary>Song Ratings</summary>
          <div className="settings-group__content"><RatingProfileControls configFile={draft.ratingProfileConfigFile} onChange={ratingProfileConfigFile => setDraft({ ...draft, ratingProfileConfigFile })} /></div>
        </details>
        <details className="settings-group" data-settings-section="appearance" open>
          <summary>Appearance</summary>
          <div className="settings-group__content">
            <label>Appearance<select value={draft.appearance} onChange={event => setDraft({ ...draft, appearance: event.target.value as Settings['appearance'] })}>
              <option value="system">Follow system</option><option value="night">Night</option><option value="day">Day</option>
            </select></label>
            <label>Accent Color<select aria-label="Accent Color" value={draft.accentColor} onChange={event => setDraft({ ...draft, accentColor: event.target.value as Settings['accentColor'] })}>
              <option value="blue">Blue</option><option value="pink">Pink</option><option value="purple">Purple</option>
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
            <p className="muted">Repeated artist/title fields are allowed when their values agree. Extra variables such as {'${Album}'} are captured and ignored. Put specific numbered patterns before a catch-all such as {'${Artist}/${Title}'}.</p>
            <label>When no template matches<select value={draft.metadataFormat} onChange={event => setDraft({ ...draft, metadataFormat: event.target.value as Settings['metadataFormat'] })}>
              <option value="artist-title">Artist - Title</option><option value="title-artist">Title - Artist</option><option value="filename">Full filename as title</option>
            </select></label>
            <p className="muted">Used when importing new songs. Existing songs keep their current metadata.</p>
          </div>
        </details>
        <details className="settings-group">
          <summary>Karaoke Services</summary>
          <div className="settings-group__content">
            <label className="settings-check"><input type="checkbox" checked={draft.providerCatalogEnabled} onChange={event => setDraft({ ...draft, providerCatalogEnabled: event.target.checked })} /> Search service catalogs in Song Library</label>
            <p>KaraFun and Party Tyme offer public catalog search. Sunfly Store offers public title/SKU search; artist search is not verified. These searches need no paid account. Sources also accepts developer profiles for Stingray and the separate Sunfly partner catalog.</p>
            <p className="muted">Search-only matches show the service name and cannot be queued or played in the booth yet. Existing subscription linking and playback remain separate work.</p>
            <ul aria-label="Karaoke service availability">
              <li>KaraFun — Public catalog search; playback pending</li>
              <li>Party Tyme — Public catalog search; playback pending</li>
              <li>Sunfly Store — Public title/SKU search; optional developer catalog profile; playback pending</li>
              <li>Stingray — Catalog access requires a provider profile; playback pending</li>
            </ul>
          </div>
        </details>
        <details className="settings-group">
          <summary>Video Downloads & Karaoke Nerds Cache</summary>
          <div className="settings-group__content">
            <p className="muted">YouTube songs are saved permanently by yt-dlp. Brand/artist bulk subscriptions remain planned.</p>
            <label>Base directory for cached videos<input type="text" value={draft.karaokeNerdsCacheDirectory} onChange={event => setDraft({ ...draft, karaokeNerdsCacheDirectory: event.target.value })} placeholder="Choose an absolute directory path" /></label>
            <div><button type="button" onClick={() => { void window.tpv.chooseVideoCacheDirectory().then(directory => { if (directory) setDraft({ ...draft, karaokeNerdsCacheDirectory: directory }); }).catch(() => setError('Could not choose a download folder.')); }}>Choose download folder…</button> <button type="button" onClick={() => { void window.tpv.revealVideoCacheDirectory().catch(() => setError('The saved download folder is not available yet.')); }}>Open saved download folder</button></div>
            <p className="muted">Leave blank to use “The Proper Volume Karaoke” in your Videos folder. New downloads use this location after saving; existing files stay where they are.</p>
            <label>yt-dlp executable<input type="text" value={draft.ytDlpExecutable} onChange={event => setDraft({ ...draft, ytDlpExecutable: event.target.value })} placeholder="Leave blank to find yt-dlp on PATH" /></label>
            <p className="muted">Install yt-dlp and FFmpeg before downloading. FFmpeg must also be on PATH; these tools are not bundled with the app.</p>
            <label className="settings-check"><input type="checkbox" checked={draft.karaokeNerdsAutoCache} onChange={event => setDraft({ ...draft, karaokeNerdsAutoCache: event.target.checked })} /> Plan automatic caching when available</label>
            <label>Brands to cache, one per line<textarea rows={3} value={cacheBrands} onChange={event => setCacheBrands(event.target.value)} /></label>
            <label>Artists to cache, one per line<textarea rows={3} value={cacheArtists} onChange={event => setCacheArtists(event.target.value)} /></label>
            <p className="muted">For selected artists, the planned behavior is the most recently published video for each artist and song.</p>
          </div>
        </details>
        <details className="settings-group">
          <summary>Queue Management</summary>
          <div className="settings-group__content">
            <label className="settings-check"><input type="checkbox" checked={draft.rotationMode === 'singer'} onChange={event => setDraft({ ...draft, rotationMode: event.target.checked ? 'singer' : 'fifo' })} /> Rotate singers fairly</label>
            <p className="muted">When enabled, singers get a turn before their next song. Otherwise songs play in request order. A staged song stays locked when changing modes.</p>
            <label className="settings-check"><input type="checkbox" checked={draft.autoApprove} onChange={event => setDraft({ ...draft, autoApprove: event.target.checked })} /> Automatically approve new requests</label>
            <p className="muted">Changing this affects new requests; requests already awaiting review remain pending.</p>
            <label>Future requests per singer<input type="number" min="0" max="50" step="1" required value={draft.maxFutureRequestsPerSinger} onChange={event => setDraft({ ...draft, maxFutureRequestsPerSinger: event.target.valueAsNumber })} /></label>
            <p className="muted">Includes pending, accepted and staged songs. The current song does not count. Set 0 for no limit; existing requests are kept when you lower the limit.</p>
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
            <BumperControls autoBumper={draft.autoBumper} autoBumperTrackId={draft.autoBumperTrackId}
              onAutoChange={(autoBumper, autoBumperTrackId) => setDraft({ ...draft, autoBumper, autoBumperTrackId })} />
          </div>
        </details>
        <details className="settings-group">
          <summary>Singer Display</summary>
          <div className="settings-group__content">
            <label>Lyric Backdrop<select aria-label="Lyric Backdrop" value={draft.lyricBackdrop} onChange={event => setDraft({ ...draft, lyricBackdrop: event.target.value as Settings['lyricBackdrop'] })}>
              <option value="default">TPV Animated Backdrop (Version 3)</option><option value="none">Solid CDG Background</option><option value="custom">Custom Video</option>
            </select></label>
            {draft.lyricBackdrop === 'custom' && <>
              <label>Custom Backdrop MP4<input type="text" value={draft.lyricBackdropFile} onChange={event => setDraft({ ...draft, lyricBackdropFile: event.target.value })} placeholder="Choose an MP4 video" /></label>
              <button type="button" onClick={() => { void window.tpv.chooseLyricBackdrop().then(file => { if (file) setDraft(current => ({ ...current, lyricBackdrop: 'custom', lyricBackdropFile: file })); }).catch(reason => setError(String(reason))); }}>Choose Backdrop Video…</button>
            </>}
            <p className="muted">Loops silently behind lyrics for new CD+G imports. Save before importing; reimport existing CD+G songs to change their backdrop. Future LRC playback will use this preference. Regular videos keep their own picture.</p>
            <label className="settings-check"><input type="checkbox" checked={draft.showNextSingers} onChange={event => setDraft({ ...draft, showNextSingers: event.target.checked })} /> Show the next singers</label>
            <label className="settings-check"><input type="checkbox" checked={draft.singerDisplayFullscreen} onChange={event => setDraft({ ...draft, singerDisplayFullscreen: event.target.checked })} /> Open singer display fullscreen</label>
            <p className="muted">Applies the next time you open the singer display. The fullscreen button changes the current display without changing this preference.</p>
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
        <details className="settings-group" data-settings-section="keyboard-shortcuts">
          <summary>Keyboard Shortcuts</summary>
          <div className="settings-group__content"><KeyboardShortcuts value={shortcuts} onSave={onSaveShortcuts} onEditFile={() => window.tpv.editShortcutsFile()} /></div>
        </details>
        <details className="settings-group">
          <summary>Local API and CLI</summary>
          <div className="settings-group__content"><LocalControlSettings enabled={draft.localControlEnabled} onChange={localControlEnabled => setDraft({ ...draft, localControlEnabled })} /></div>
        </details>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="settings-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving}>Save preferences</button></div>
    </form>
  </dialog>;
}

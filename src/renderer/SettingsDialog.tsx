import React, { useEffect, useRef, useState } from 'react';
import type { Settings } from '../domain/settings';
import { AudioOutputPicker } from './AudioOutputPicker';
import { BumperControls } from './BumperPanel';
import { HostRemotePanel } from '../remote/HostRemotePanel';
import { SharedCatalogControls } from './SharedCatalogControls';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { RatingProfileControls } from './RatingProfileControls';
import { LocalControlSettings } from './LocalControlSettings';
import { Icon } from './Icon';
import { BlacklistSettings } from './BlacklistSettings';
import { YouTubeSearchSettings } from './YouTubeSearchSettings';
import { SingerBrandingSettings } from './SingerBrandingSettings';
import { Tooltip } from './Tooltip';
import { DEFAULT_HOST_PANEL_SIZES } from '../domain/host-layout';
import type { Shortcuts } from '../domain/shortcuts';
import type { SettingsSection } from '../domain/app-action';
import '../styles/settings.scss';

function SettingsHelp({ label, text }: { label: string; text: string }) {
  return <Tooltip text={text}><button type="button" className="help-button" aria-label={label}>?</button></Tooltip>;
}

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
  return <dialog ref={dialog} className="settings-dialog settings-dialog--preferences" aria-labelledby="settings-title" onCancel={onClose}>
    <form onSubmit={event => void submit(event)}>
      <div className="settings-dialog__header">
        <div className="settings-inline-help"><h2 id="settings-title">Preferences</h2><SettingsHelp label="Saving preferences help" text="Save to apply preferences. Logo selection applies immediately. Keyboard shortcuts save separately." /></div>
        <button type="button" className="icon-button settings-dialog__close" aria-label="Close preferences" onClick={onClose} disabled={saving}><Icon name="close" /></button>
      </div>
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
            <label>Workspace layout<select aria-label="Workspace layout" value={draft.layout} onChange={event => {
              const layout = event.target.value as Settings['layout'];
              setDraft({ ...draft, layout, hostPanelSizes: layout === 'rotation' ? { ...draft.hostPanelSizes, queue: Math.max(360, Math.min(1000, Math.round(window.innerWidth * .4))) } : layout === 'standard' ? { ...draft.hostPanelSizes, queue: DEFAULT_HOST_PANEL_SIZES.queue } : draft.hostPanelSizes });
            }}>
              <option value="standard">Standard</option><option value="rotation">Wider singer rotation</option><option value="library">Wide song library</option>
            </select></label>
            <label>Singer Preview Position<select aria-label="Singer Preview Position" value={draft.hostPreviewPosition} onChange={event => setDraft({ ...draft, hostPreviewPosition: event.target.value as Settings['hostPreviewPosition'] })}>
              <option value="above">Above Host Queue</option><option value="below">Below Host Queue</option><option value="hidden">Hidden</option>
            </select></label>
            <div className="settings-inline-help"><button type="button" onClick={() => setDraft({ ...draft, hostPanelSizes: { ...DEFAULT_HOST_PANEL_SIZES } })}>Reset Panel Sizes</button><SettingsHelp label="Panel resizing help" text="Drag separators to resize panels. Arrow keys move a focused separator; Shift moves farther. Double-click to reset." /></div>
          </div>
        </details>
        <details className="settings-group" data-settings-section="blacklist">
          <summary>Song and Artist Blacklist</summary>
          <div className="settings-group__content"><BlacklistSettings value={draft} onChange={setDraft} /></div>
        </details>
        <YouTubeSearchSettings value={draft} onChange={setDraft} bridge={window.tpv.youtubeSearch} />
        <details className="settings-group">
          <summary>Library Settings</summary>
          <div className="settings-group__content">
            <label>Filename and folder templates, one per line<textarea rows={4} value={templates} onChange={event => setTemplates(event.target.value)} placeholder={'${DJ Code} - ${Artist} - ${Track Name}\n${Artist}/${Title}.mp4'} /></label>
            <div className="settings-inline-help"><span className="muted">Tried in order on new imports.</span><SettingsHelp label="Filename templates help" text={'Use ${Artist}, ${Title} (or ${Track Name}), ${DJ Code}, ${Track Number} and / for folders. Repeated fields must agree; extra variables are ignored. Put specific patterns first. Existing songs keep their metadata.'} /></div>
            <label>When no template matches<select value={draft.metadataFormat} onChange={event => setDraft({ ...draft, metadataFormat: event.target.value as Settings['metadataFormat'] })}>
              <option value="artist-title">Artist - Title</option><option value="title-artist">Title - Artist</option><option value="filename">Full filename as title</option>
            </select></label>
          </div>
        </details>
        <details className="settings-group">
          <summary>Karaoke Services</summary>
          <div className="settings-group__content">
            <label className="settings-check"><input type="checkbox" checked={draft.providerCatalogEnabled} onChange={event => setDraft({ ...draft, providerCatalogEnabled: event.target.checked })} /> Search service catalogs in Song Library</label>
            <div className="settings-inline-help"><span>Connect accounts in Sources.</span><SettingsHelp label="Karaoke service search help" text="KaraFun, Party Tyme and Sunfly Store have public catalogs. Sunfly Store artist search is unverified. Stingray and the Sunfly partner catalog need developer profiles. Search-only services cannot be queued until playback is connected." /></div>
            <ul aria-label="Karaoke service availability">
              <li>KaraFun — Public catalog and connected-account playback</li>
              <li>Party Tyme — Public catalog search; playback pending</li>
              <li>Sunfly Store — Public title/SKU search; optional developer catalog profile; playback pending</li>
              <li>Stingray — Catalog access requires a provider profile; playback pending</li>
            </ul>
          </div>
        </details>
        <details className="settings-group">
          <summary>Video Downloads & Karaoke Nerds Cache</summary>
          <div className="settings-group__content">
            <div className="settings-inline-help"><span className="muted">YouTube downloads are kept on this host.</span><SettingsHelp label="Video download help" text="yt-dlp and FFmpeg must be installed; FFmpeg must be on PATH. A blank folder uses The Proper Volume Karaoke in your Videos folder. Existing files stay where they are. Brand/artist bulk subscriptions remain planned." /></div>
            <label>Base directory for cached videos<input type="text" value={draft.karaokeNerdsCacheDirectory} onChange={event => setDraft({ ...draft, karaokeNerdsCacheDirectory: event.target.value })} placeholder="Choose an absolute directory path" /></label>
            <div><button type="button" onClick={() => { void window.tpv.chooseVideoCacheDirectory().then(directory => { if (directory) setDraft({ ...draft, karaokeNerdsCacheDirectory: directory }); }).catch(() => setError('Could not choose a download folder.')); }}>Choose download folder…</button> <button type="button" onClick={() => { void window.tpv.revealVideoCacheDirectory().catch(() => setError('The saved download folder is not available yet.')); }}>Open saved download folder</button></div>
            <label>yt-dlp executable<input type="text" value={draft.ytDlpExecutable} onChange={event => setDraft({ ...draft, ytDlpExecutable: event.target.value })} placeholder="Leave blank to find yt-dlp on PATH" /></label>
            <label className="settings-check"><input type="checkbox" checked={draft.karaokeNerdsAutoCache} onChange={event => setDraft({ ...draft, karaokeNerdsAutoCache: event.target.checked })} /> Plan automatic caching when available</label>
            <label>Brands to cache, one per line<textarea rows={3} value={cacheBrands} onChange={event => setCacheBrands(event.target.value)} /></label>
            <label>Artists to cache, one per line<textarea rows={3} value={cacheArtists} onChange={event => setCacheArtists(event.target.value)} /></label>
            <SettingsHelp label="Automatic video caching help" text="Bulk caching is planned. Selected artists will use the most recently published video for each song, with upload date as fallback." />
          </div>
        </details>
        <details className="settings-group">
          <summary>Queue Management</summary>
          <div className="settings-group__content">
            <label className="settings-check"><input type="checkbox" checked={draft.rotationMode === 'singer'} onChange={event => setDraft({ ...draft, rotationMode: event.target.checked ? 'singer' : 'fifo' })} /> Rotate singers fairly</label>
            <SettingsHelp label="Singer rotation help" text="Fair rotation gives each singer a turn before their next song. Turn it off for request order. The prepared next song stays locked when changing modes." />
            <label className="settings-check"><input type="checkbox" checked={draft.autoApprove} onChange={event => setDraft({ ...draft, autoApprove: event.target.checked })} /> Automatically approve new requests</label>
            <label className="settings-check"><input type="checkbox" checked={draft.autoAdvance} onChange={event => setDraft({ ...draft, autoAdvance: event.target.checked })} /> Automatically play the next song</label>
            <SettingsHelp label="Automatic queue playback help" text="Approved requests prepare automatically. After a completed or skipped song, the next starts once the pause interval ends and playback is ready. Stop cancels automatic advancement. Requests already awaiting approval stay pending." />
            <label>Future requests per singer<input type="number" min="0" max="50" step="1" required value={draft.maxFutureRequestsPerSinger} onChange={event => setDraft({ ...draft, maxFutureRequestsPerSinger: event.target.valueAsNumber })} /></label>
            <SettingsHelp label="Future request limits help" text="Counts pending, accepted and prepared songs, excluding the current song. Zero means unlimited. Lowering the limit keeps existing requests." />
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
            <label>Pause Interval (seconds)<input type="number" min="0" max="300" step="1" value={draft.pauseIntervalSeconds} onChange={event => setDraft({ ...draft, pauseIntervalSeconds: Number(event.target.value) })} /></label>
            <p className="muted">Gap between songs. The next song starts automatically unless disabled in Queue Management.</p>
            <label className="settings-check"><input type="checkbox" checked={draft.bumperOnLaunch} onChange={event => setDraft({ ...draft, bumperOnLaunch: event.target.checked })} /> Play bumper music when the app opens</label>
            <label>Bumper Fade-In<span className="settings-range"><input aria-label="Bumper Fade-In" type="range" min="500" max="1700" step="50" value={draft.bumperFadeMs} onChange={event => setDraft({ ...draft, bumperFadeMs: Number(event.target.value) })} /><output>{draft.bumperFadeMs} ms</output></span></label>
            <BumperControls autoBumper={draft.autoBumper} autoBumperTrackId={draft.autoBumperTrackId}
              onAutoChange={(autoBumper, autoBumperTrackId) => setDraft({ ...draft, autoBumper, autoBumperTrackId })} />
          </div>
        </details>
        <details className="settings-group">
          <summary>Singer Display</summary>
          <div className="settings-group__content">
            <label className="settings-check"><input type="checkbox" checked={draft.singerScreenEnabled} onChange={event => setDraft({ ...draft, singerScreenEnabled: event.target.checked })} /> Share the singer screen with browsers on the local network</label>
            <label>Singer Screen Port<input aria-label="Singer Screen Port" type="number" min="1024" max="65535" step="1" required value={draft.singerScreenPort} onChange={event => setDraft({ ...draft, singerScreenPort: event.target.valueAsNumber })} /></label>
            <SettingsHelp label="Singer screen sharing help" text="Shares a read-only visual screen; sound stays on this host. Save, then open Remote Sessions for connection addresses. Local sharing may require private-network firewall access." />
            <label>Lyric Backdrop<select aria-label="Lyric Backdrop" value={draft.lyricBackdrop} onChange={event => setDraft({ ...draft, lyricBackdrop: event.target.value as Settings['lyricBackdrop'] })}>
              <option value="default">TPV Animated Backdrop (Version 3)</option><option value="none">Solid CDG Background</option><option value="custom">Custom Video</option>
            </select></label>
            {draft.lyricBackdrop === 'custom' && <>
              <label>Custom Backdrop MP4<input type="text" value={draft.lyricBackdropFile} onChange={event => setDraft({ ...draft, lyricBackdropFile: event.target.value })} placeholder="Choose an MP4 video" /></label>
              <button type="button" onClick={() => { void window.tpv.chooseLyricBackdrop().then(file => { if (file) setDraft(current => ({ ...current, lyricBackdrop: 'custom', lyricBackdropFile: file })); }).catch(reason => setError(String(reason))); }}>Choose Backdrop Video…</button>
            </>}
            <SettingsHelp label="Lyric backdrop help" text="Loops silently behind new CD+G imports. Save before importing; reimport existing CD+G songs to update their backdrop. LRC support is planned. Videos keep their own picture." />
            <label className="settings-check"><input type="checkbox" checked={draft.showNextSingers} onChange={event => setDraft({ ...draft, showNextSingers: event.target.checked })} /> Show the next singers</label>
            <label className="settings-check"><input type="checkbox" checked={draft.singerDisplayFullscreen} onChange={event => setDraft({ ...draft, singerDisplayFullscreen: event.target.checked })} /> Open singer display fullscreen</label>
            <SingerBrandingSettings value={draft} onChange={setDraft} />
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

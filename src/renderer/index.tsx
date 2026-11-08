import React, { useEffect, useMemo, useRef, useState } from 'react';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import { createRoot } from 'react-dom/client';
import type { Command, ShowState, SongRequest, Version } from '../domain/index';
import { isVersionAllowed, orderedFuture, remainingPauseSeconds, visibleVersions } from '../domain/index';
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings';
import { DEFAULT_SHORTCUTS, matchesShortcut, type Shortcuts } from '../domain/shortcuts';
import type { MissingSongRequest } from '../domain/missing-request';
import type { CollectionsAction, CollectionsSnapshot } from '../domain/collections';
import { Icon } from './Icon';
import { CollectionsPanel } from './CollectionsPanel';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';
import { SongRequestDialog } from './SongRequestDialog';
import { Tooltip } from './Tooltip';
import { SettingsDialog } from './SettingsDialog';
import { EditMetadataDialog } from './EditMetadataDialog';
import type { BumperInfo } from './BumperPanel';
import type { HostRemoteBridge } from '../remote/host-control';
import '../styles/main.scss';
import '../styles/tooltip.scss';

type Screen = 'library' | 'requests' | 'singers' | 'playlists';
type Result = { ok: boolean; error?: string };
function formatShortcut(binding: string): string { return binding.split('+').map(part => part === 'Space' ? 'Spacebar' : part === 'Control' ? 'Ctrl' : part.replace(/^Key/, '').replace(/^Digit/, '')).join('+'); }
declare global {
  interface Window {
    tpv: {
      getState: () => Promise<ShowState>;
      getCollections: () => Promise<CollectionsSnapshot>;
      mutateCollections: (action: CollectionsAction) => Promise<CollectionsSnapshot>;
      getSettings: () => Promise<{ settings: Settings; path: string; created: boolean }>;
      getShortcuts: () => Promise<{ shortcuts: Shortcuts; path: string; error: string }>;
      saveSettings: (settings: Settings) => Promise<Settings>;
      subscribe: (callback: (state: ShowState) => void) => () => void;
      onFocusSearch: (callback: () => void) => () => void;
      importFiles: (kind?: 'files' | 'folder') => Promise<void>;
      getMissingSongRequests: () => Promise<MissingSongRequest[]>;
      onMissingSongRequests: (callback: (requests: MissingSongRequest[]) => void) => () => void;
      addMissingSongRequest: (request: { singer: string; title: string; artist: string }) => Promise<Result>;
      command: (payload: Command) => Promise<Result>;
      openDisplay: () => Promise<void>;
      revealConfigFile: (kind: 'settings' | 'shortcuts') => Promise<void>;
      chooseDisplayLogo: () => Promise<boolean>;
      clearDisplayLogo: () => Promise<void>;
      getBumpers: () => Promise<BumperInfo>;
      addBumpers: () => Promise<BumperInfo>;
      removeBumper: (id: string) => Promise<BumperInfo>;
      startBumper: (id: string) => Promise<BumperInfo>;
      stopBumper: () => Promise<BumperInfo>;
      onBumperState: (callback: (state: BumperInfo) => void) => () => void;
      revealMedia: (versionId: string) => Promise<void>;
      remote: HostRemoteBridge;
    };
  }
}

function App() {
  const [state, setState] = useState<ShowState | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [screen, setScreen] = useState<Screen>('library');
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const focusSearch = () => { setSettingsOpen(false); setEditingVersion(null); setQueueVersion(null); setPlaylistVersion(null); setContextMenu(null); setScreen('library'); setSearchFocusRequest(value => value + 1); };
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [queueVersion, setQueueVersion] = useState<Version | null>(null);
  const [playlistVersion, setPlaylistVersion] = useState<Version | null>(null);
  const [contextMenu, setContextMenu] = useState<{ version: Version; x: number; y: number } | null>(null);
  const [collections, setCollections] = useState<CollectionsSnapshot>({ playlists: [], items: [], history: [] });
  const [selectedSingerId, setSelectedSingerId] = useState('');
  const [singerName, setSingerName] = useState('');
  const [newRequestSingerName, setNewRequestSingerName] = useState('');
  const [missingRequests, setMissingRequests] = useState<MissingSongRequest[]>([]);
  const [missingSinger, setMissingSinger] = useState('');
  const [missingTitle, setMissingTitle] = useState('');
  const [missingArtist, setMissingArtist] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsPath, setSettingsPath] = useState('');
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const [shortcutsPath, setShortcutsPath] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingVersion, setEditingVersion] = useState<Version | null>(null);

  useEffect(() => {
    const deadline = state?.nextStartAtMs ?? 0;
    setClockMs(Date.now());
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now(); setClockMs(now);
      if (now >= deadline) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [state?.nextStartAtMs]);

  useEffect(() => {
    let alive = true;
    // Subscribe before the initial snapshot so an intervening update is not lost.
    const unsubscribe = window.tpv.subscribe(value => { if (alive) setState(current => !current || value.revision >= current.revision ? value : current); });
    window.tpv.getState().then(value => { if (alive) setState(current => !current || value.revision >= current.revision ? value : current); })
      .catch(error => { if (alive) setNotice(`Could not load the show: ${String(error)}`); });
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let alive = true;
    void window.tpv.getCollections().then(value => { if (alive) setCollections(value); })
      .catch(error => { if (alive) setNotice(`Could not load playlists and history: ${String(error)}`); });
    return () => { alive = false; };
  }, [state?.revision]);

  useEffect(() => {
    let alive = true, received = false;
    const unsubscribe = window.tpv.onMissingSongRequests(value => { received = true; if (alive) setMissingRequests(value); });
    void window.tpv.getMissingSongRequests().then(value => { if (alive && !received) setMissingRequests(value); })
      .catch(error => { if (alive) setNotice(`Could not load missing-song requests: ${String(error)}`); });
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let alive = true;
    void window.tpv.getShortcuts().then(result => {
      if (alive) { setShortcuts(result.shortcuts); setShortcutsPath(result.path); if (result.error) setNotice(`${result.error} Defaults are active until the file is fixed and the app restarted.`); }
    }).catch(error => { if (alive) setNotice(`Could not load keyboard shortcuts: ${String(error)}`); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void window.tpv.getSettings().then(async result => {
      let loaded = result.settings;
      const previousTheme = localStorage.getItem('tpv-theme');
      if (result.created && (previousTheme === 'day' || previousTheme === 'night'))
        loaded = await window.tpv.saveSettings({ ...loaded, appearance: previousTheme });
      if (alive) { setSettings(loaded); setSettingsPath(result.path); }
    }).catch(error => { if (alive) setNotice(`Could not load preferences: ${String(error)}`); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => { document.documentElement.dataset.theme = settings.appearance === 'system' ? (preference.matches ? 'day' : 'night') : settings.appearance; };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, [settings.appearance]);

  useEffect(() => window.tpv.onFocusSearch(focusSearch), []);
  useEffect(() => { if (searchFocusRequest) searchInput.current?.focus(); }, [searchFocusRequest, screen, !!state]);
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('.song-menu')) setContextMenu(null); };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [contextMenu]);

  const versions = useMemo(() => state ? visibleVersions(state) : [], [state]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return versions.filter(v => `${v.title} ${v.artist}`.toLocaleLowerCase().includes(query));
  }, [versions, search]);
  const selectedVersion = versions.find(v => v.id === selectedVersionId);
  const selectedSinger = state?.singers.find(s => s.id === selectedSingerId);
  const pending = state?.requests.filter(r => r.status === 'pending') ?? [];
  const future = state ? orderedFuture(state, settings.rotationMode) : [];
  const eligibleFuture = state && future.some(r => r.status === 'accepted' && isVersionAllowed(state, r.versionId));
  const staged = state?.requests.find(r => r.id === state.stagedRequestId);
  const active = state?.requests.find(r => r.id === state.playback?.requestId);
  const pauseRemaining = state ? remainingPauseSeconds(state, clockMs) : 0;
  const describe = (request?: SongRequest) => {
    const singer = state?.singers.find(s => s.id === request?.singerId)?.name ?? 'Unknown singer';
    const song = state?.versions.find(v => v.id === request?.versionId);
    return { singer, title: song?.title ?? 'Unknown song', artist: song?.artist ?? '' };
  };
  const run = async (operation: () => Promise<Result | void>, success?: string) => {
    setBusy(true);
    try {
      const result = await operation();
      if (result && !result.ok) setNotice(result.error || 'The action could not be completed.');
      else setNotice(success ?? '');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const command = (payload: Command, success?: string) => run(() => window.tpv.command(payload), success);
  const playPause = () => run(async () => {
    if (state?.playback) return window.tpv.command({ type: state.playback.status === 'paused' ? 'resume' : 'pause' });
    const remaining = state ? remainingPauseSeconds(state, Date.now()) : 0;
    if (remaining) return { ok: false, error: `Wait ${remaining} seconds before starting the next song.` };
    if (!state?.stagedRequestId) {
      const staged = await window.tpv.command({ type: 'stage' });
      if (!staged.ok) return staged;
    }
    return window.tpv.command({ type: 'start', generationId: crypto.randomUUID() });
  });
  const mutateCollections = async (action: CollectionsAction): Promise<boolean> => {
    try { setCollections(await window.tpv.mutateCollections(action)); setNotice(''); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false; }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const input = { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
      if (!event.repeat && matchesShortcut(shortcuts, 'search', input)) {
        event.preventDefault();
        focusSearch();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (event.key === 'Delete' && !event.repeat && selectedRequestId && !target?.closest('input, textarea, select, [contenteditable="true"]') && !busy && !settingsOpen && !editingVersion && !queueVersion && !playlistVersion && !contextMenu) {
        event.preventDefault(); void command({ type: 'removeRequest', requestId: selectedRequestId }); setSelectedRequestId(''); return;
      }
      if (!matchesShortcut(shortcuts, 'playPause', input) || event.repeat || settingsOpen || editingVersion || queueVersion || playlistVersion ||
          target?.closest('input, textarea, select, button, [contenteditable="true"]') || busy || (!state?.playback && !state?.stagedRequestId && !eligibleFuture)) return;
      event.preventDefault();
      void playPause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, busy, shortcuts, selectedRequestId, settingsOpen, editingVersion, queueVersion, playlistVersion, contextMenu, eligibleFuture]);
  const addSinger = (event: React.FormEvent) => {
    event.preventDefault();
    const name = singerName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    void run(async () => {
      const result = await window.tpv.command({ type: 'addSinger', singer: { id, name } });
      if (result.ok) { setSingerName(''); setSelectedSingerId(id); }
      return result;
    }, `${name} added.`);
  };
  const makeRequest = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedVersion) return;
    const name = newRequestSingerName.trim();
    if (!selectedSinger && (selectedSingerId !== '__new__' || !name)) return;
    void run(async () => {
      let singerId = selectedSinger?.id;
      if (!singerId) {
        singerId = crypto.randomUUID();
        const added = await window.tpv.command({ type: 'addSinger', singer: { id: singerId, name } });
        if (!added.ok) return added;
        // Retain the newly created singer even if the subsequent request fails.
        setSelectedSingerId(singerId);
        setNewRequestSingerName('');
      }
      return window.tpv.command({ type: 'request', requestId: crypto.randomUUID(), singerId, versionId: selectedVersion.id });
    }, settings.autoApprove ? 'Request added to the queue.' : 'Request added for review.');
  };
  const requestMissingSong = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await window.tpv.addMissingSongRequest({ singer: missingSinger, title: missingTitle, artist: missingArtist });
      if (result.ok) {
        setMissingSinger(''); setMissingTitle(''); setMissingArtist('');
        setMissingRequests(await window.tpv.getMissingSongRequests());
      }
      return result;
    }, 'Missing-song request saved.');
  };
  const skip = () => {
    if (state?.playback && window.confirm('Skip this performance? This consumes the singer’s turn.'))
      void command({ type: 'skip', generationId: state.playback.generationId, confirmed: true });
  };
  const current = describe(active);
  const stage = describe(staged);

  return <div className="app" data-layout={settings.layout}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">▥</span><span>The Proper Volume<small>Karaoke host</small></span></div>
      <h1>Local rehearsal</h1>
      <Tooltip text={`Search (${shortcuts.search.map(formatShortcut).join(', ')})`}><button className="icon-button" aria-label="Open library search" onClick={focusSearch}><Icon name="search" /></button></Tooltip>
      <Tooltip text="Singer Display"><button className="icon-button" aria-label="Singer display" onClick={() => void run(() => window.tpv.openDisplay())}><Icon name="display" /></button></Tooltip>
      <Tooltip text="Preferences"><button className="icon-button" aria-label="Preferences" onClick={() => setSettingsOpen(true)} disabled={!settingsPath}><Icon name="settings" /></button></Tooltip>
    </header>
    <nav className="sidebar" aria-label="Workspace">
      <div className="eyebrow">Workspace</div>
      {([['library', 'Library'], ['requests', `Requests${pending.length ? ` (${pending.length})` : ''}`], ['singers', 'Singers'], ['playlists', 'Playlists']] as const).map(([id, label]) =>
        <button key={id} className={`nav-item ${screen === id ? 'active' : ''}`} aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}>{label}</button>)}
    </nav>
    <main className="main-panel">
      {notice && <p className="notice" role="status">{notice}</p>}
      {!state ? <p className="empty">Loading your show…</p> : <>
        {screen === 'library' && <>
          <div className="section-heading"><h2>Song Library</h2><div><Tooltip text="Import Video File"><button className="icon-button" aria-label="Import Video File" disabled={busy} onClick={() => void run(() => window.tpv.importFiles('files'))}><Icon name="file" /></button></Tooltip> <Tooltip text="Import Custom Directory"><button className="icon-button" aria-label="Import Custom Directory" disabled={busy} onClick={() => void run(() => window.tpv.importFiles('folder'))}><Icon name="folder" /></button></Tooltip></div></div>
          <div className="library-toolbar"><input ref={searchInput} type="search" aria-label="Search library" placeholder="Search title or artist" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="eyebrow">Title / artist <span className="muted"> · Local MP4</span></div>
          <div role="listbox" aria-label="Songs" className="song-list">
            {filtered.map((version, index) => <div className={`track-row song-option ${version.id === selectedVersionId ? 'selected' : ''}`} key={version.id} role="option" aria-selected={version.id === selectedVersionId} tabIndex={0}
              onClick={() => setSelectedVersionId(version.id)} onDoubleClick={() => { setSelectedVersionId(version.id); setQueueVersion(version); }}
              onContextMenu={event => { event.preventDefault(); setSelectedVersionId(version.id); setContextMenu({ version, x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 210) }); }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSelectedVersionId(version.id); setQueueVersion(version); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="option"]'); const i = Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); next?.[i]?.focus(); setSelectedVersionId(filtered[i]?.id ?? ''); } }}>
              <div><strong>{version.title}</strong><small>{version.artist || 'Unknown artist'}{version.metadataAmbiguous ? ' · Review metadata' : ''}</small></div>
            </div>)}
            {!filtered.length && <p className="empty">{versions.length ? 'No songs match this search.' : 'Import a local MP4 to begin. Your original file stays in place.'}</p>}
          </div>
          <form className="request-form" onSubmit={makeRequest}>
            <label>Singer for {selectedVersion ? `“${selectedVersion.title}”` : 'selected song'}<select value={selectedSingerId} onChange={e => setSelectedSingerId(e.target.value)}><option value="">Choose a singer</option>{state.singers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}<option value="__new__">Add a new singer…</option></select></label>
            {selectedSingerId === '__new__' && <label>New singer name<input autoComplete="off" value={newRequestSingerName} onChange={e => setNewRequestSingerName(e.target.value)} maxLength={100} /></label>}
            <button type="submit" disabled={busy || !selectedVersion || (!selectedSinger && !(selectedSingerId === '__new__' && newRequestSingerName.trim()))}>Add request</button>
          </form>
          <h3>Can't Find a Song?</h3>
          <p className="muted">Save a request for the host to review. This does not add it to the rotation.</p>
          <form className="request-form" onSubmit={requestMissingSong}>
            <label>Singer name<input value={missingSinger} onChange={e => setMissingSinger(e.target.value)} maxLength={100} required /></label>
            <label>Song title<input value={missingTitle} onChange={e => setMissingTitle(e.target.value)} maxLength={200} required /></label>
            <label>Artist (optional)<input value={missingArtist} onChange={e => setMissingArtist(e.target.value)} maxLength={200} /></label>
            <button type="submit" disabled={busy || !missingSinger.trim() || !missingTitle.trim()}>Save missing-song request</button>
          </form>
        </>}
        {screen === 'requests' && <>
          <h2>Requests</h2><p className="muted">Review requests before they enter the rotation.</p>
          {pending.map(request => { const item = describe(request); return <div className="track-row" key={request.id}><div><strong>{item.singer}</strong><small>{item.title}{item.artist ? ` · ${item.artist}` : ''}</small></div><button disabled={busy} onClick={() => void command({ type: 'accept', requestId: request.id })}>Accept</button></div>; })}
          {!pending.length && <p className="empty">No requests waiting for review.</p>}
          <h3>Missing-Song Requests</h3>
          {missingRequests.map(request => <div className="track-row" key={request.id}><div><strong>{request.title}</strong><small>{request.artist ? `${request.artist} · ` : ''}{request.singer}</small></div></div>)}
          {!missingRequests.length && <p className="empty">No missing-song requests yet.</p>}
        </>}
        {screen === 'singers' && <>
          <h2>Singers</h2><form className="inline-form" onSubmit={addSinger}><label>Singer name<input autoComplete="off" value={singerName} onChange={e => setSingerName(e.target.value)} placeholder="Enter a name" maxLength={100} /></label><button className="primary" disabled={busy || !singerName.trim()} type="submit">Add singer</button></form>
          <h3>In This Show</h3>{state.singers.map(s => <div className="track-row" key={s.id}><strong>{s.name}</strong></div>)}
          {!state.singers.length && <p className="empty">No singers yet.</p>}
        </>}
        {screen === 'playlists' && <CollectionsPanel data={collections} versions={versions} singers={state.singers} selectedVersionId={selectedVersionId} busy={busy} mutate={mutateCollections} selectVersion={id => { setSelectedVersionId(id); setScreen('library'); }} />}
      </>}
    </main>
    <aside className="rotation" aria-label="Singer rotation">
      <h2>{settings.rotationMode === 'singer' ? 'Singer Rotation' : 'Request Queue'}</h2><span className="badge">{settings.autoApprove ? 'Auto-approve' : 'Host moderated'}</span>
      <div className="eyebrow">On Stage</div>
      <div className="on-stage">{active ? <><strong>{current.singer}</strong><small>{current.title} · {state?.playback?.status === 'paused' ? 'Paused' : 'Playing'}</small></> : <span className="muted">No singer on stage</span>}</div>
      <div className="section-heading"><span className="eyebrow">Up Next</span><button disabled={busy || !!staged || !eligibleFuture} onClick={() => void command({ type: 'stage' })}>Stage next</button></div>
      <div role="listbox" aria-label="Singer Rotation">{future.map((request, index) => { const item = describe(request); return <div className={`queue-row ${selectedRequestId === request.id ? 'selected' : ''}`} key={request.id} role="option" aria-selected={selectedRequestId === request.id} tabIndex={0} onClick={() => setSelectedRequestId(request.id)} onFocus={() => setSelectedRequestId(request.id)}><div className="queue-row__head"><span className="queue-row__number">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.singer}</strong><small>{item.title}</small><small>{request.status === 'staged' ? 'Staged · locked' : state && !isVersionAllowed(state, request.versionId) ? 'Unavailable under current policy' : settings.rotationMode === 'singer' ? `Round ${request.round}` : 'In request order'}</small></div></div></div>; })}</div>
      {!future.length && <p className="empty">Accepted requests will appear here.</p>}
      {staged && <button disabled={busy} onClick={() => void command({ type: 'release' })}>Release staged song</button>}
    </aside>
    <footer className="transport" aria-label="Playback controls">
      <div className="transport__track"><span className="eyebrow">{active ? 'Now playing' : staged ? 'Staged' : 'Player ready'}</span><strong>{active ? current.title : staged ? stage.title : 'No song selected'}</strong><small>{active ? current.singer : staged ? stage.singer : 'Stage an accepted request to begin'}</small></div>
      <div className="transport__controls">
        <Tooltip text={`Play/Pause (${shortcuts.playPause.map(formatShortcut).join(', ')})`}><button className="primary icon-button" aria-label="Play/Pause" disabled={busy || (!active && (pauseRemaining > 0 || (!staged && !eligibleFuture)))} onClick={() => void playPause()}><Icon name={state?.playback?.status === 'playing' ? 'pause' : 'play'} /></button></Tooltip>
        <Tooltip text="Stop"><button className="icon-button" aria-label="Stop" disabled={busy || !active} onClick={() => void command({ type: 'stop' })}><Icon name="stop" /></button></Tooltip>
        <Tooltip text="Skip"><button className="icon-button" aria-label="Skip" disabled={busy || !active} onClick={skip}><Icon name="skip" /></button></Tooltip>
        <label className="transport__volume">Volume <input type="range" aria-label="Global Volume" min="0" max="100" value={Math.round(settings.masterVolume * 100)} onChange={event => { const next = { ...settings, masterVolume: Number(event.target.value) / 100 }; setSettings(next); void window.tpv.saveSettings(next).catch(error => setNotice(`Could not save volume: ${String(error)}`)); }} /></label>
      </div>
      <div className="transport__status" role="status">{!active && pauseRemaining > 0 ? `Pause interval: ${pauseRemaining}s remaining. Press Play when ready.` : 'Key, tempo, seek and filler are not yet available in this rehearsal build.'}</div>
    </footer>
    {settingsOpen && <SettingsDialog value={settings} path={settingsPath} shortcutsPath={shortcutsPath} onClose={() => setSettingsOpen(false)} onSave={async value => { const saved = await window.tpv.saveSettings(value); setSettings(saved); }} />}
    {editingVersion && <EditMetadataDialog version={editingVersion} onClose={() => setEditingVersion(null)} onSave={async (title, artist) => {
      const result = await window.tpv.command({ type: 'editVersion', id: editingVersion.id, title, artist });
      if (!result.ok) throw new Error(result.error || 'The song could not be updated.');
    }} />}
    {contextMenu && <div className="song-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
      <button role="menuitem" onClick={() => { setQueueVersion(contextMenu.version); setContextMenu(null); }}>Add to Queue</button>
      <button role="menuitem" onClick={() => { setPlaylistVersion(contextMenu.version); setContextMenu(null); }}>Add to Playlist</button>
      <button role="menuitem" onClick={() => { setEditingVersion(contextMenu.version); setContextMenu(null); }}>Edit Metadata</button>
      <button role="menuitem" onClick={() => { const id = contextMenu.version.id; setContextMenu(null); void run(() => window.tpv.revealMedia(id)); }}>Show in Files...</button>
    </div>}
    {queueVersion && state && <SongRequestDialog version={queueVersion} singers={state.singers} onClose={() => setQueueVersion(null)} onSubmit={async choice => {
      let singerId = choice.singerId;
      if (!singerId) { singerId = crypto.randomUUID(); const added = await window.tpv.command({ type: 'addSinger', singer: { id: singerId, name: choice.newSingerName! } }); if (!added.ok) throw new Error(added.error || 'Could not add singer'); }
      const result = await window.tpv.command({ type: 'request', requestId: crypto.randomUUID(), singerId, versionId: queueVersion.id });
      if (!result.ok) throw new Error(result.error || 'Could not add request');
      setNotice(settings.autoApprove ? 'Song added to the queue.' : 'Request submitted for review.');
    }} />}
    {playlistVersion && state && <AddToPlaylistDialog song={playlistVersion} singers={state.singers} playlists={collections.playlists} onClose={() => setPlaylistVersion(null)} onSave={async playlistId => { if (!await mutateCollections({ type: 'add', playlistId, versionId: playlistVersion.id })) throw new Error('Could not add the song.'); }} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);

import { contextBridge, ipcRenderer } from 'electron';

// This bridge exposes only named application operations, never generic IPC or filesystem access.
contextBridge.exposeInMainWorld('tpv', {
  getAppVersion: () => ipcRenderer.invoke('host:app-version'),
  appReady: () => ipcRenderer.invoke('host:ui-ready'),
  refreshMenu: () => ipcRenderer.invoke('host:refresh-menu'),
  updateMenuContext: (value: { busy: boolean; modal: boolean }) => ipcRenderer.invoke('host:menu-context', value),
  getLocalControlStatus: () => ipcRenderer.invoke('host:control-status'),
  showControlCli: () => ipcRenderer.invoke('host:show-control-cli'),
  onAppAction: (callback: (action: unknown) => void) => {
    const listener = (_event: unknown, action: unknown) => callback(action);
    ipcRenderer.on('host:app-action', listener);
    return () => ipcRenderer.removeListener('host:app-action', listener);
  },
  onSettings: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('host:settings', listener);
    return () => ipcRenderer.removeListener('host:settings', listener);
  },
  onShortcuts: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('host:shortcuts', listener);
    return () => ipcRenderer.removeListener('host:shortcuts', listener);
  },
  chooseSharedCatalogConfiguration: () => ipcRenderer.invoke('host:choose-catalog-config'),
  getSharedCatalogStatus: (file?: string) => ipcRenderer.invoke('host:catalog-status', file),
  getState: () => ipcRenderer.invoke('host:get-state'),
  getTimeline: () => ipcRenderer.invoke('host:get-timeline'),
  seek: (input: unknown) => ipcRenderer.invoke('host:seek', input),
  onTimeline: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('host:timeline', listener);
    return () => ipcRenderer.removeListener('host:timeline', listener);
  },
  getLibraryFilenames: () => ipcRenderer.invoke('host:get-library-filenames'),
  backupShow: () => ipcRenderer.invoke('host:backup-show'),
  retryBackupCleanup: () => ipcRenderer.invoke('host:backup-cleanup'),
  getCollections: () => ipcRenderer.invoke('host:get-collections'),
  exportHistory: (filter: unknown) => ipcRenderer.invoke('host:export-history', filter),
  historyExportStatus: () => ipcRenderer.invoke('host:history-export-status'),
  retryHistoryExportCleanup: () => ipcRenderer.invoke('host:history-export-cleanup'),
  mutateCollections: (action: unknown) => ipcRenderer.invoke('host:mutate-collections', action),
  revealMedia: (versionId: string) => ipcRenderer.invoke('host:reveal-media', versionId),
  relinkMedia: (versionId: string) => ipcRenderer.invoke('host:relink-media', versionId),
  getSettings: () => ipcRenderer.invoke('host:get-settings'),
  searchCommunityCatalog: (query: string) => ipcRenderer.invoke('host:karaokenerds-search', query),
  getProviderCatalogStatus: () => ipcRenderer.invoke('host:provider-catalog-status'),
  searchProviderCatalog: (query: string) => ipcRenderer.invoke('host:provider-catalog-search', query),
  chooseProviderCatalogProfile: (provider: string) => ipcRenderer.invoke('host:provider-catalog-choose-profile', provider),
  clearProviderCatalogProfile: (provider: string) => ipcRenderer.invoke('host:provider-catalog-clear-profile', provider),
  openProviderCatalogSong: (input: unknown) => ipcRenderer.invoke('host:provider-catalog-open', input),
  ratingKeys: (versionIds: string[]) => ipcRenderer.invoke('host:rating-keys', versionIds),
  lookupSongRatings: (keys: string[]) => ipcRenderer.invoke('host:rating-lookup', keys),
  rateSong: (key: string, value: number | null) => ipcRenderer.invoke('host:rating-vote', key, value),
  chooseRatingProfile: () => ipcRenderer.invoke('host:rating-choose-profile'),
  ratingProfileStatus: (file?: string) => ipcRenderer.invoke('host:rating-profile-status', file),
  addYouTube: (input: unknown) => ipcRenderer.invoke('host:add-youtube', input),
  requestCatalogTrack: (input: unknown) => ipcRenderer.invoke('host:request-catalog-track', input),
  youtubeDownloads: {
    status: () => ipcRenderer.invoke('host:youtube-download-status'),
    start: (versionId: string) => ipcRenderer.invoke('host:youtube-download', versionId),
    cancel: (id: string) => ipcRenderer.invoke('host:youtube-download-cancel', id),
  },
  chooseVideoCacheDirectory: () => ipcRenderer.invoke('host:choose-video-cache'),
  revealVideoCacheDirectory: () => ipcRenderer.invoke('host:reveal-video-cache'),
  openCommunityVideo: (id: string) => ipcRenderer.invoke('host:karaokenerds-open-video', id),
  getShortcuts: () => ipcRenderer.invoke('host:get-shortcuts'),
  saveShortcuts: (value: unknown) => ipcRenderer.invoke('host:save-shortcuts', value),
  editShortcutsFile: () => ipcRenderer.invoke('host:edit-shortcuts-file'),
  playPause: () => ipcRenderer.invoke('host:play-pause'),
  restartTrack: () => ipcRenderer.invoke('host:restart-track'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('host:save-settings', settings),
  cycleAccentColor: () => ipcRenderer.invoke('host:cycle-accent-color'),
  revealConfigFile: (kind: 'settings' | 'shortcuts') => ipcRenderer.invoke('host:reveal-config-file', kind),
  chooseDisplayLogo: () => ipcRenderer.invoke('host:choose-display-logo'),
  chooseLyricBackdrop: () => ipcRenderer.invoke('host:choose-lyric-backdrop'),
  clearDisplayLogo: () => ipcRenderer.invoke('host:clear-display-logo'),
  remote: {
    status: () => ipcRenderer.invoke('host:remote-status'),
    subscribe: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on('host:remote-status', listener);
      return () => ipcRenderer.removeListener('host:remote-status', listener);
    },
    chooseCertificate: () => ipcRenderer.invoke('host:remote-choose-certificate'),
    choosePrivateKey: () => ipcRenderer.invoke('host:remote-choose-key'),
    openLan: (input: unknown) => ipcRenderer.invoke('host:remote-open-lan', input),
    closeRoom: () => ipcRenderer.invoke('host:remote-close'),
    createInvitation: (ttl: number) => ipcRenderer.invoke('host:remote-invite', ttl),
    revokeInvitations: () => ipcRenderer.invoke('host:remote-revoke-invites'),
    revokeGuest: (singerId: string) => ipcRenderer.invoke('host:remote-revoke-guest', singerId)
  },
  internetSessions: {
    status:()=>ipcRenderer.invoke('host:internet-status'),
    start:(input:unknown)=>ipcRenderer.invoke('host:internet-start',input),
    stop:()=>ipcRenderer.invoke('host:internet-stop'),
    copyLink:()=>ipcRenderer.invoke('host:internet-copy'),
    revokeGuest:(id:string)=>ipcRenderer.invoke('host:internet-revoke',id),
    subscribe:(callback:(value:unknown)=>void)=>{const listener=(_event:unknown,value:unknown)=>callback(value);ipcRenderer.on('host:internet-state',listener);return()=>ipcRenderer.removeListener('host:internet-state',listener);},
  },
  getBumpers: () => ipcRenderer.invoke('host:get-bumpers'),
  addBumpers: () => ipcRenderer.invoke('host:add-bumpers'),
  removeBumper: (id: string) => ipcRenderer.invoke('host:remove-bumper', id),
  startBumper: (id: string) => ipcRenderer.invoke('host:start-bumper', id),
  stopBumper: () => ipcRenderer.invoke('host:stop-bumper'),
  onBumperState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('host:bumper-state', listener);
    return () => ipcRenderer.removeListener('host:bumper-state', listener);
  },
  subscribe: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('host:state', listener);
    return () => ipcRenderer.removeListener('host:state', listener);
  },
  onFocusSearch: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('host:focus-search', listener);
    return () => ipcRenderer.removeListener('host:focus-search', listener);
  },
  importFiles: (kind?: 'files' | 'folder') => ipcRenderer.invoke('host:import', kind),
  cdg: {
    status: () => ipcRenderer.invoke('host:cdg-status'),
    start: () => ipcRenderer.invoke('host:cdg-import'),
    cancel: (id: string) => ipcRenderer.invoke('host:cdg-cancel', id),
  },
  imports: {
    status: () => ipcRenderer.invoke('host:import-status'),
    subscribe: (callback: (value: unknown) => void) => {
      const listener = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on('host:import-progress', listener);
      return () => ipcRenderer.removeListener('host:import-progress', listener);
    },
    cancel: (jobId: string) => ipcRenderer.invoke('host:import-cancel', jobId),
    results: (jobId: string, offset: number, limit: number) => ipcRenderer.invoke('host:import-results', jobId, offset, limit)
  },
  getMissingSongReviews: () => ipcRenderer.invoke('host:get-missing-song-reviews'),
  setMissingSongStatus: (id: string, expected: unknown, next: unknown) => ipcRenderer.invoke('host:set-missing-song-status', id, expected, next),
  onMissingSongReviews: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('host:missing-song-reviews', listener);
    return () => ipcRenderer.removeListener('host:missing-song-reviews', listener);
  },
  getMissingSongRequests: () => ipcRenderer.invoke('host:get-missing-song-requests'),
  onMissingSongRequests: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('host:missing-song-requests', listener);
    return () => ipcRenderer.removeListener('host:missing-song-requests', listener);
  },
  addMissingSongRequest: (request: unknown) => ipcRenderer.invoke('host:add-missing-song-request', request),
  command: (command: unknown) => ipcRenderer.invoke('host:command', command),
  toggleDisplayFullscreen: () => ipcRenderer.invoke('host:toggle-display-fullscreen'),
  openDisplay: () => ipcRenderer.invoke('host:open-display')
});

contextBridge.exposeInMainWorld('tpvDisplay', {
  ready: () => ipcRenderer.send('display:ready'),
  onSeek: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('display:seek', listener);
    return () => ipcRenderer.removeListener('display:seek', listener);
  },
  shortcut: (action: string) => ipcRenderer.send('display:shortcut', action),
  event: (event: unknown) => ipcRenderer.send('display:event', event),
  bumperAck: (value: unknown) => ipcRenderer.send('display:bumper-ack', value),
  bumperEvent: (value: unknown) => ipcRenderer.send('display:bumper-event', value),
  bumperDeviceChange: () => ipcRenderer.send('display:bumper-devicechange'),
  onBumperCommand: (callback: (request: unknown) => void) => {
    const listener = (_event: unknown, request: unknown) => callback(request);
    ipcRenderer.on('display:bumper-command', listener);
    return () => ipcRenderer.removeListener('display:bumper-command', listener);
  },
  subscribe: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('display:state', listener);
    return () => ipcRenderer.removeListener('display:state', listener);
  }
});

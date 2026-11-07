import { contextBridge, ipcRenderer } from 'electron';

// This bridge exposes only named application operations, never generic IPC or filesystem access.
contextBridge.exposeInMainWorld('tpv', {
  getState: () => ipcRenderer.invoke('host:get-state'),
  getCollections: () => ipcRenderer.invoke('host:get-collections'),
  mutateCollections: (action: unknown) => ipcRenderer.invoke('host:mutate-collections', action),
  revealMedia: (versionId: string) => ipcRenderer.invoke('host:reveal-media', versionId),
  getSettings: () => ipcRenderer.invoke('host:get-settings'),
  getShortcuts: () => ipcRenderer.invoke('host:get-shortcuts'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('host:save-settings', settings),
  revealConfigFile: (kind: 'settings' | 'shortcuts') => ipcRenderer.invoke('host:reveal-config-file', kind),
  chooseDisplayLogo: () => ipcRenderer.invoke('host:choose-display-logo'),
  clearDisplayLogo: () => ipcRenderer.invoke('host:clear-display-logo'),
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
  getMissingSongRequests: () => ipcRenderer.invoke('host:get-missing-song-requests'),
  addMissingSongRequest: (request: unknown) => ipcRenderer.invoke('host:add-missing-song-request', request),
  command: (command: unknown) => ipcRenderer.invoke('host:command', command),
  openDisplay: () => ipcRenderer.invoke('host:open-display')
});

contextBridge.exposeInMainWorld('tpvDisplay', {
  ready: () => ipcRenderer.send('display:ready'),
  shortcut: (action: 'search' | 'playPause') => ipcRenderer.send('display:shortcut', action),
  event: (event: unknown) => ipcRenderer.send('display:event', event),
  subscribe: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('display:state', listener);
    return () => ipcRenderer.removeListener('display:state', listener);
  }
});

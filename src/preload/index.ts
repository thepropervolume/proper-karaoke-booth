import { contextBridge, ipcRenderer } from 'electron';

// This bridge exposes only named application operations, never generic IPC or filesystem access.
contextBridge.exposeInMainWorld('tpv', {
  getState: () => ipcRenderer.invoke('host:get-state'),
  getShortcuts: () => ipcRenderer.invoke('host:get-shortcuts'),
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
  event: (event: unknown) => ipcRenderer.send('display:event', event),
  subscribe: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('display:state', listener);
    return () => ipcRenderer.removeListener('display:state', listener);
  }
});

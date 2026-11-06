import { contextBridge, ipcRenderer } from 'electron';

// This bridge exposes only named application operations, never generic IPC or filesystem access.
contextBridge.exposeInMainWorld('tpv', {
  getState: () => ipcRenderer.invoke('host:get-state'),
  subscribe: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('host:state', listener);
    return () => ipcRenderer.removeListener('host:state', listener);
  },
  importFiles: () => ipcRenderer.invoke('host:import'),
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

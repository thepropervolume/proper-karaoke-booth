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
  getMissingSongRequests: () => ipcRenderer.invoke('host:get-missing-song-requests'),
  addMissingSongRequest: (request: unknown) => ipcRenderer.invoke('host:add-missing-song-request', request),
  command: (command: unknown) => ipcRenderer.invoke('host:command', command),
  openDisplay: () => ipcRenderer.invoke('host:open-display')
});

contextBridge.exposeInMainWorld('tpvDisplay', {
  ready: () => ipcRenderer.send('display:ready'),
  shortcut: (action: 'search' | 'playPause') => ipcRenderer.send('display:shortcut', action),
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

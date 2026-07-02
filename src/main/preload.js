'use strict';
// Secure bridge between the renderer (UI) and the main process (Node engine).
// The renderer has no Node access; everything it can do is enumerated here.

const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('nebula', {
  // Sessions
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  saveSession: (s) => ipcRenderer.invoke('sessions:save', s),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  exportSessions: () => ipcRenderer.invoke('sessions:export'),
  importSessions: () => ipcRenderer.invoke('sessions:import'),
  cryptoAvailable: () => ipcRenderer.invoke('crypto:available'),

  // Serial ports
  listSerialPorts: () => ipcRenderer.invoke('serial:list'),

  // Connections
  openConnection: (cfg) => ipcRenderer.invoke('conn:open', cfg),
  write: (id, data) => ipcRenderer.send('conn:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('conn:resize', { id, cols, rows }),
  closeConnection: (id) => ipcRenderer.send('conn:close', { id }),
  onConnEvent: (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on('conn:event', fn);
    return () => ipcRenderer.removeListener('conn:event', fn);
  },

  // Network scanner
  parseTargets: (input) => ipcRenderer.invoke('scan:parse', input),
  startScan: (opts) => ipcRenderer.invoke('scan:start', opts),
  stopScan: (scanId) => ipcRenderer.send('scan:stop', { scanId }),
  onScanEvent: (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on('scan:event', fn);
    return () => ipcRenderer.removeListener('scan:event', fn);
  },

  // Multi-ping (continuous)
  pingStart: (opts) => ipcRenderer.invoke('ping:start', opts),
  pingStop: (pingId) => ipcRenderer.send('ping:stop', { pingId }),
  onPingEvent: (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on('ping:event', fn);
    return () => ipcRenderer.removeListener('ping:event', fn);
  },

  // TFTP server
  tftpStart: (opts) => ipcRenderer.invoke('tftp:start', opts),
  tftpStop: () => ipcRenderer.invoke('tftp:stop'),
  tftpReveal: () => ipcRenderer.invoke('tftp:reveal'),
  onTftpEvent: (cb) => {
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on('tftp:event', fn);
    return () => ipcRenderer.removeListener('tftp:event', fn);
  },

  // Local consoles + config file + folder picker
  openConsole: (which) => ipcRenderer.invoke('app:openConsole', which),
  openConfigFile: () => ipcRenderer.invoke('dialog:openConfig'),
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir'),
  detachToolWindow: (key) => ipcRenderer.invoke('tool:detach', key),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // Dialogs / OS
  pickKeyFile: () => ipcRenderer.invoke('dialog:openKey'),
  chooseLogDir: () => ipcRenderer.invoke('dialog:chooseLogDir'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  // Clipboard (Electron-native so it works under contextIsolation)
  clipboardWrite: (text) => clipboard.writeText(text),
  clipboardRead: () => clipboard.readText(),

  // Menu actions pushed from the app menu / keyboard shortcuts
  onMenu: (cb) => {
    const fn = (_e, action) => cb(action);
    ipcRenderer.on('menu:action', fn);
    return () => ipcRenderer.removeListener('menu:action', fn);
  },

  platform: process.platform,
});

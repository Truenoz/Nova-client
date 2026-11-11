'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('launcher', {
  appInfo: () => invoke('app:info'),

  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),

  listVersions: (includeSnapshots) => invoke('versions:list', includeSnapshots),
  news: () => invoke('news:list'),
  openExternal: (url) => invoke('shell:external', url),

  restoreSession: () => invoke('auth:restore'),
  login: () => invoke('auth:login'),
  logout: () => invoke('auth:logout'),

  checkUpdates: () => invoke('update:check'),
  installUpdate: () => invoke('update:install'),
  holdUpdate: () => invoke('update:hold'),
  startUpdate: () => invoke('update:start'),

  launch: (profileId, opts) => invoke('game:launch', profileId, opts),
  stop: () => invoke('game:stop'),
  openFolder: () => invoke('folder:open'),
  openDataFolder: () => invoke('data:open'),

  // skins
  getSkin: (query, opts) => invoke('skin:get', query, opts),
  getMySkin: (opts) => invoke('skin:mine', opts),

  // perfiles
  listProfiles: () => invoke('profiles:list'),
  getProfile: (id) => invoke('profiles:get', id),
  createProfile: (input) => invoke('profiles:create', input),
  updateProfile: (id, patch) => invoke('profiles:update', id, patch),
  deleteProfile: (id) => invoke('profiles:delete', id),
  duplicateProfile: (id) => invoke('profiles:duplicate', id),
  copyFromProfile: (id, sourceId) => invoke('profiles:copyFrom', id, sourceId),
  folders: (action, name) => invoke('profiles:folders', action, name),
  openProfileFolder: (id) => invoke('profiles:openFolder', id),
  exportProfile: (id) => invoke('profiles:export', id),
  shareProfile: (id) => invoke('profiles:share', id),
  importProfileFile: () => invoke('profiles:importFile'),
  importProfileCode: (code) => invoke('profiles:importCode', code),

  // contenido
  listContent: (id) => invoke('content:list', id),
  toggleContent: (id, file, enabled) => invoke('content:toggle', id, file, enabled),
  removeContent: (id, file) => invoke('content:remove', id, file),
  searchContent: (id, query) => invoke('content:search', id, query),
  browseContent: (query) => invoke('content:browse', query),
  installContent: (id, projectId, type) => invoke('content:install', id, projectId, type),
  updateContent: (id, file) => invoke('content:update', id, file),
  identifyContent: (id) => invoke('content:identify', id),
  checkContentUpdates: (id) => invoke('content:checkUpdates', id),
  pickLocalContent: (id) => invoke('content:pickLocal', id),
  addLocalContent: (id, paths) => invoke('content:addLocal', id, paths),
  getPerf: (id) => invoke('perf:get', id),
  setPerf: (id, patch) => invoke('perf:set', id, patch),

  listWorlds: (id) => invoke('worlds:list', id),
  openWorld: (id, name) => invoke('worlds:open', id, name),
  readLog: (id) => invoke('logs:read', id),

  listServers: () => invoke('servers:list'),
  addServer: (name, address) => invoke('servers:add', name, address),
  removeServer: (id) => invoke('servers:remove', id),

  exportDebug: () => invoke('debug:export'),
  clearCache: () => invoke('danger:clearCache'),
  clearJava: () => invoke('danger:clearJava'),
  resetSettings: () => invoke('danger:resetSettings'),

  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),

  onStatus: (cb) => subscribe('game:status', cb),
  onLog: (cb) => subscribe('game:log', cb),
  onMaximized: (cb) => subscribe('win:maximized', cb),
  onUpdate: (cb) => subscribe('update:status', cb),
  onProfileProgress: (cb) => subscribe('profile:progress', cb)
});

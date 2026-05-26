const { contextBridge, ipcRenderer } = require('electron');

const api = {
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    restart: () => ipcRenderer.invoke('app:restart'),
  },
  updater: {
    installNow: () => ipcRenderer.invoke('updater:installNow'),
    onAvailable: (cb) => ipcRenderer.on('updater:available', (_e, p) => cb(p)),
    onProgress: (cb) => ipcRenderer.on('updater:progress', (_e, p) => cb(p)),
    onReady: (cb) => ipcRenderer.on('updater:ready', (_e, p) => cb(p)),
  },
  auth: {
    login: (data) => ipcRenderer.invoke('auth:login', data),
    logout: (data) => ipcRenderer.invoke('auth:logout', data),
    me: (data) => ipcRenderer.invoke('auth:me', data),
    createUser: (data) => ipcRenderer.invoke('auth:createUser', data),
    updateUser: (data) => ipcRenderer.invoke('auth:updateUser', data),
    deleteUser: (data) => ipcRenderer.invoke('auth:deleteUser', data),
    resetUserPassword: (data) => ipcRenderer.invoke('auth:resetUserPassword', data),
    listUsers: (data) => ipcRenderer.invoke('auth:listUsers', data),
    changePassword: (data) => ipcRenderer.invoke('auth:changePassword', data),
  },
  profiles: {
    list: (data) => ipcRenderer.invoke('profiles:list', data),
    create: (data) => ipcRenderer.invoke('profiles:create', data),
    update: (data) => ipcRenderer.invoke('profiles:update', data),
    assign: (data) => ipcRenderer.invoke('profiles:assign', data),
    delete: (data) => ipcRenderer.invoke('profiles:delete', data),
  },
  accounts: {
    listForProfile: (data) => ipcRenderer.invoke('accounts:listForProfile', data),
    listForUser: (data) => ipcRenderer.invoke('accounts:listForUser', data),
    create: (data) => ipcRenderer.invoke('accounts:create', data),
    update: (data) => ipcRenderer.invoke('accounts:update', data),
    getCredentials: (data) => ipcRenderer.invoke('accounts:getCredentials', data),
    delete: (data) => ipcRenderer.invoke('accounts:delete', data),
  },
  proxies: {
    list: (data) => ipcRenderer.invoke('proxies:list', data),
    create: (data) => ipcRenderer.invoke('proxies:create', data),
    update: (data) => ipcRenderer.invoke('proxies:update', data),
    delete: (data) => ipcRenderer.invoke('proxies:delete', data),
    getForAccount: (data) => ipcRenderer.invoke('proxies:getForAccount', data),
  },
  webviews: {
    list: (data) => ipcRenderer.invoke('webviews:list', data),
    create: (data) => ipcRenderer.invoke('webviews:create', data),
    update: (data) => ipcRenderer.invoke('webviews:update', data),
    delete: (data) => ipcRenderer.invoke('webviews:delete', data),
    listCredentials: (data) => ipcRenderer.invoke('webviews:listCredentials', data),
    createCredential: (data) => ipcRenderer.invoke('webviews:createCredential', data),
    deleteCredential: (data) => ipcRenderer.invoke('webviews:deleteCredential', data),
  },
  posts: {
    list: (data) => ipcRenderer.invoke('posts:list', data),
    create: (data) => ipcRenderer.invoke('posts:create', data),
    delete: (data) => ipcRenderer.invoke('posts:delete', data),
  },
  bundle: {
    export: (data) => ipcRenderer.invoke('bundle:export', data),
    import: (data) => ipcRenderer.invoke('bundle:import', data),
  },
  ai: {
    setApiKey: (data) => ipcRenderer.invoke('ai:setApiKey', data),
    hasApiKey: (data) => ipcRenderer.invoke('ai:hasApiKey', data),
    suggestPost: (data) => ipcRenderer.invoke('ai:suggestPost', data),
    improveTitle: (data) => ipcRenderer.invoke('ai:improveTitle', data),
  },
  subs: {
    listWarmup: (data) => ipcRenderer.invoke('subs:listWarmup', data),
    createWarmup: (data) => ipcRenderer.invoke('subs:createWarmup', data),
    updateWarmup: (data) => ipcRenderer.invoke('subs:updateWarmup', data),
    deleteWarmup: (data) => ipcRenderer.invoke('subs:deleteWarmup', data),
    listPromo: (data) => ipcRenderer.invoke('subs:listPromo', data),
    createPromo: (data) => ipcRenderer.invoke('subs:createPromo', data),
    deletePromo: (data) => ipcRenderer.invoke('subs:deletePromo', data),
  },
  session: {
    prepareForAccount: (data) => ipcRenderer.invoke('session:prepareForAccount', data),
    clear: (partitionKey) => ipcRenderer.invoke('session:clear', partitionKey),
  },
};

contextBridge.exposeInMainWorld('api', api);

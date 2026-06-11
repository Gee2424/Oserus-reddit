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
    addMember: (data) => ipcRenderer.invoke('profiles:addMember', data),
    removeMember: (data) => ipcRenderer.invoke('profiles:removeMember', data),
    setMemberRole: (data) => ipcRenderer.invoke('profiles:setMemberRole', data),
  },
  accounts: {
    listForProfile: (data) => ipcRenderer.invoke('accounts:listForProfile', data),
    listForUser: (data) => ipcRenderer.invoke('accounts:listForUser', data),
    create: (data) => ipcRenderer.invoke('accounts:create', data),
    bulkCreate: (data) => ipcRenderer.invoke('accounts:bulkCreate', data),
    update: (data) => ipcRenderer.invoke('accounts:update', data),
    setStarred: (data) => ipcRenderer.invoke('accounts:setStarred', data),
    bulkSetProxy: (data) => ipcRenderer.invoke('accounts:bulkSetProxy', data),
    bulkDelete: (data) => ipcRenderer.invoke('accounts:bulkDelete', data),
    bulkSetStatus: (data) => ipcRenderer.invoke('accounts:bulkSetStatus', data),
    getCredentials: (data) => ipcRenderer.invoke('accounts:getCredentials', data),
    delete: (data) => ipcRenderer.invoke('accounts:delete', data),
  },
  activity: {
    list: (data) => ipcRenderer.invoke('activity:list', data),
  },
  // Management Hub backend — per-user productivity metrics + drill-down.
  team: {
    overview:     (data) => ipcRenderer.invoke('team:overview', data),
    memberDetail: (data) => ipcRenderer.invoke('team:memberDetail', data),
  },
  reddit: {
    precheckSubreddit: (data) => ipcRenderer.invoke('reddit:precheckSubreddit', data),
  },
  proxies: {
    list: (data) => ipcRenderer.invoke('proxies:list', data),
    create: (data) => ipcRenderer.invoke('proxies:create', data),
    update: (data) => ipcRenderer.invoke('proxies:update', data),
    delete: (data) => ipcRenderer.invoke('proxies:delete', data),
    test: (data) => ipcRenderer.invoke('proxies:test', data),
    testAll: (data) => ipcRenderer.invoke('proxies:testAll', data),
    rotate:  (data) => ipcRenderer.invoke('proxies:rotate', data),
    getForAccount: (data) => ipcRenderer.invoke('proxies:getForAccount', data),
  },
  extensions: {
    list:   (data) => ipcRenderer.invoke('extensions:list', data),
    add:    (data) => ipcRenderer.invoke('extensions:add', data),
    toggle: (data) => ipcRenderer.invoke('extensions:toggle', data),
    remove: (data) => ipcRenderer.invoke('extensions:remove', data),
  },
  homepage: {
    list: (data) => ipcRenderer.invoke('homepage:list', data),
    save: (data) => ipcRenderer.invoke('homepage:save', data),
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
    setProviderKey: (data) => ipcRenderer.invoke('ai:setProviderKey', data),
    getProviders: (data) => ipcRenderer.invoke('ai:getProviders', data),
    setProvider: (data) => ipcRenderer.invoke('ai:setProvider', data),
    suggestPost: (data) => ipcRenderer.invoke('ai:suggestPost', data),
    improveTitle: (data) => ipcRenderer.invoke('ai:improveTitle', data),
  },
  autopilotAI: {
    getConfig: (data) => ipcRenderer.invoke('autopilot:getConfig', data),
    setKey: (data) => ipcRenderer.invoke('autopilot:setKey', data),
    setModel: (data) => ipcRenderer.invoke('autopilot:setModel', data),
    getPrompts: (data) => ipcRenderer.invoke('autopilot:getPrompts', data),
    setPrompt: (data) => ipcRenderer.invoke('autopilot:setPrompt', data),
    deletePrompt: (data) => ipcRenderer.invoke('autopilot:deletePrompt', data),
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
  votes: {
    setApiKey: (data) => ipcRenderer.invoke('votes:setApiKey', data),
    hasApiKey: (data) => ipcRenderer.invoke('votes:hasApiKey', data),
    balance: (data) => ipcRenderer.invoke('votes:balance', data),
    services: (data) => ipcRenderer.invoke('votes:services', data),
    order: (data) => ipcRenderer.invoke('votes:order', data),
    orders: (data) => ipcRenderer.invoke('votes:orders', data),
    refreshStatus: (data) => ipcRenderer.invoke('votes:refreshStatus', data),
    status: (data) => ipcRenderer.invoke('votes:status', data),
    statusMulti: (data) => ipcRenderer.invoke('votes:statusMulti', data),
    refill: (data) => ipcRenderer.invoke('votes:refill', data),
    refillStatus: (data) => ipcRenderer.invoke('votes:refillStatus', data),
  },
  docs: {
    list: (data) => ipcRenderer.invoke('docs:list', data),
    get: (data) => ipcRenderer.invoke('docs:get', data),
    create: (data) => ipcRenderer.invoke('docs:create', data),
    update: (data) => ipcRenderer.invoke('docs:update', data),
    delete: (data) => ipcRenderer.invoke('docs:delete', data),
  },
  scheduled: {
    list: (data) => ipcRenderer.invoke('scheduled:list', data),
    create: (data) => ipcRenderer.invoke('scheduled:create', data),
    bulkCreate: (data) => ipcRenderer.invoke('scheduled:bulkCreate', data),
    reschedule: (data) => ipcRenderer.invoke('scheduled:reschedule', data),
    checkConflicts: (data) => ipcRenderer.invoke('scheduled:checkConflicts', data),
    cancel: (data) => ipcRenderer.invoke('scheduled:cancel', data),
    delete: (data) => ipcRenderer.invoke('scheduled:delete', data),
  },
  analytics: {
    summary: (data) => ipcRenderer.invoke('analytics:summary', data),
    karmaHistory: (data) => ipcRenderer.invoke('analytics:karmaHistory', data),
    recordKarma: (data) => ipcRenderer.invoke('analytics:recordKarma', data),
  },
  roles: {
    list: (data) => ipcRenderer.invoke('roles:list', data),
    create: (data) => ipcRenderer.invoke('roles:create', data),
    update: (data) => ipcRenderer.invoke('roles:update', data),
    delete: (data) => ipcRenderer.invoke('roles:delete', data),
    myPermissions: (data) => ipcRenderer.invoke('roles:myPermissions', data),
  },
  session: {
    prepareForAccount: (data) => ipcRenderer.invoke('session:prepareForAccount', data),
    clear: (partitionKey) => ipcRenderer.invoke('session:clear', partitionKey),
  },
  inbox: {
    fetch: (data) => ipcRenderer.invoke('inbox:fetch', data),
    fetchThread: (data) => ipcRenderer.invoke('inbox:fetchThread', data),
    markRead: (data) => ipcRenderer.invoke('inbox:markRead', data),
    reply: (data) => ipcRenderer.invoke('inbox:reply', data),
  },
  protocols: {
    get: (data) => ipcRenderer.invoke('protocols:get', data),
    set: (data) => ipcRenderer.invoke('protocols:set', data),
    eligibility: (data) => ipcRenderer.invoke('protocols:eligibility', data),
    events: (data) => ipcRenderer.invoke('protocols:events', data),
  },
  // One autopilot surface — master controls (status / setEnabled /
  // setInterval / runNow) plus the per-profile-per-platform protocol
  // CRUD (listForProfile / get / set). The runNow handler is shared by
  // both layers (the same IPC accepts {profileId, platform, accountId,
  // dryRun} and runs one engagement session).
  autopilot: {
    status:         (data) => ipcRenderer.invoke('autopilot:status', data),
    setEnabled:     (data) => ipcRenderer.invoke('autopilot:setEnabled', data),
    setInterval:    (data) => ipcRenderer.invoke('autopilot:setInterval', data),
    runNow:         (data) => ipcRenderer.invoke('autopilot:runNow', data),
    listForProfile: (data) => ipcRenderer.invoke('autopilot:listForProfile', data),
    get:            (data) => ipcRenderer.invoke('autopilot:get', data),
    set:            (data) => ipcRenderer.invoke('autopilot:set', data),
  },
  coordination: {
    get: (data) => ipcRenderer.invoke('coordination:get', data),
    set: (data) => ipcRenderer.invoke('coordination:set', data),
    test: (data) => ipcRenderer.invoke('coordination:test', data),
  },
  intel: {
    list: (data) => ipcRenderer.invoke('intel:list', data),
    listTopics: (data) => ipcRenderer.invoke('intel:listTopics', data),
    discoverScrape: (data) => ipcRenderer.invoke('intel:discoverScrape', data),
    fetch: (data) => ipcRenderer.invoke('intel:fetch', data),
    delete: (data) => ipcRenderer.invoke('intel:delete', data),
    scrapePosts:  (data) => ipcRenderer.invoke('intel:scrapePosts', data),
    scrapeUser:   (data) => ipcRenderer.invoke('intel:scrapeUser', data),
    scrapeMods:   (data) => ipcRenderer.invoke('intel:scrapeMods', data),
    scrapeFlairs: (data) => ipcRenderer.invoke('intel:scrapeFlairs', data),
    analyze:      (data) => ipcRenderer.invoke('intel:analyze', data),
    synthesizePlan: (data) => ipcRenderer.invoke('intel:synthesizePlan', data),
  },
  aiconfig: {
    get: (data) => ipcRenderer.invoke('aiconfig:get', data),
    set: (data) => ipcRenderer.invoke('aiconfig:set', data),
  },
  templates: {
    list:   (data) => ipcRenderer.invoke('templates:list', data),
    create: (data) => ipcRenderer.invoke('templates:create', data),
    update: (data) => ipcRenderer.invoke('templates:update', data),
    delete: (data) => ipcRenderer.invoke('templates:delete', data),
    start:  (data) => ipcRenderer.invoke('templates:start', data),
    stop:   (data) => ipcRenderer.invoke('templates:stop', data),
  },
  redgifs: {
    listAccounts: (data) => ipcRenderer.invoke('redgifs:listAccounts', data),
    fetchProfile: (data) => ipcRenderer.invoke('redgifs:fetchProfile', data),
    fetchAll:     (data) => ipcRenderer.invoke('redgifs:fetchAll', data),
  },
  messaging: {
    templatesList:  (data) => ipcRenderer.invoke('messaging:templatesList', data),
    templateCreate: (data) => ipcRenderer.invoke('messaging:templateCreate', data),
    templateDelete: (data) => ipcRenderer.invoke('messaging:templateDelete', data),
    rulesList:      (data) => ipcRenderer.invoke('messaging:rulesList', data),
    ruleCreate:     (data) => ipcRenderer.invoke('messaging:ruleCreate', data),
    ruleUpdate:     (data) => ipcRenderer.invoke('messaging:ruleUpdate', data),
    ruleDelete:     (data) => ipcRenderer.invoke('messaging:ruleDelete', data),
  },
  examples: {
    listPosts:    (data) => ipcRenderer.invoke('examples:listPosts', data),
    addPost:      (data) => ipcRenderer.invoke('examples:addPost', data),
    deletePost:   (data) => ipcRenderer.invoke('examples:deletePost', data),
    listImages:   (data) => ipcRenderer.invoke('examples:listImages', data),
    addImage:     (data) => ipcRenderer.invoke('examples:addImage', data),
    deleteImage:  (data) => ipcRenderer.invoke('examples:deleteImage', data),
    readImage:    (data) => ipcRenderer.invoke('examples:readImage', data),
    listComments: (data) => ipcRenderer.invoke('examples:listComments', data),
    addComment:   (data) => ipcRenderer.invoke('examples:addComment', data),
    deleteComment:(data) => ipcRenderer.invoke('examples:deleteComment', data),
  },
  engagement: {
    get:      (data) => ipcRenderer.invoke('engagement:get', data),
    set:      (data) => ipcRenderer.invoke('engagement:set', data),
    runNow:   (data) => ipcRenderer.invoke('engagement:runNow', data),
    sessions: (data) => ipcRenderer.invoke('engagement:sessions', data),
    recent:   (data) => ipcRenderer.invoke('engagement:recent', data),
  },
  autoComment: {
    get:    (data) => ipcRenderer.invoke('autoComment:get', data),
    set:    (data) => ipcRenderer.invoke('autoComment:set', data),
    runNow: (data) => ipcRenderer.invoke('autoComment:runNow', data),
    runs:   (data) => ipcRenderer.invoke('autoComment:runs', data),
  },
  windows: {
    openPopout: (data) => ipcRenderer.invoke('window:openPopout', data),
    openExternalTabs: (data) => ipcRenderer.invoke('system:openExternalTabs', data),
    setAlwaysOnTop: (data) => ipcRenderer.invoke('window:setAlwaysOnTop', data),
    close: () => ipcRenderer.invoke('window:close'),
  },
  // Oserus Browser is the only browsing surface. There's no standalone
  // Browser page anymore — launching happens from a model or one of its
  // linked accounts.
  oserusBrowser: {
    openAccount:        (data) => ipcRenderer.invoke('oserus-browser:openAccount', data),
    openAllForProfile:  (data) => ipcRenderer.invoke('oserus-browser:openAllForProfile', data),
  },
  chrome: {
    detect:   () => ipcRenderer.invoke('chrome:detect'),
    setPath:  (path) => ipcRenderer.invoke('chrome:setPath', { path }),
    launch:   (args) => ipcRenderer.invoke('chrome:launch', args),
  },
  devices: {
    list:     () => ipcRenderer.invoke('devices:list'),
    getTools: () => ipcRenderer.invoke('devices:getTools'),
    setTools: (args) => ipcRenderer.invoke('devices:setTools', args),
  },
  cloud: {
    getStatus: () => ipcRenderer.invoke('cloud:getStatus'),
    getConfig: () => ipcRenderer.invoke('cloud:getConfig'),
    setConfig: (cfg) => ipcRenderer.invoke('cloud:setConfig', cfg),
    test: (cfg) => ipcRenderer.invoke('cloud:test', cfg),
    start: () => ipcRenderer.invoke('cloud:start'),
    stop: () => ipcRenderer.invoke('cloud:stop'),
    getSchemaSql: () => ipcRenderer.invoke('cloud:getSchemaSql'),
    onStatus: (cb) => {
      const fn = (_e, s) => cb(s);
      ipcRenderer.on('cloud:status', fn);
      return () => ipcRenderer.removeListener('cloud:status', fn);
    },
    onDataChanged: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('cloud:dataChanged', fn);
      return () => ipcRenderer.removeListener('cloud:dataChanged', fn);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

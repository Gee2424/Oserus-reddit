const { createClient } = require('@supabase/supabase-js');
const defaultBackend = require('./sync/defaultBackend');
const { getKv } = require('./db');
let WS = null;
try { WS = require('ws'); } catch {}

let anonClient = null;
let adminClient = null;

function getAnonClient() {
  if (anonClient) return anonClient;
  const url = defaultBackend.SUPABASE_URL;
  const key = defaultBackend.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const opts = { auth: { persistSession: false } };
  if (WS) opts.realtime = { params: { eventsPerSecond: 5 }, transport: WS };
  anonClient = createClient(url, key, opts);
  return anonClient;
}

function getAuthedClient() {
  try {
    const raw = getKv('oserus_session');
    if (!raw) return getAnonClient();
    let data;
    if (raw.startsWith('ENC:')) {
      const { safeStorage } = require('electron');
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
        data = JSON.parse(decrypted);
      } else {
        return getAnonClient();
      }
    } else {
      data = JSON.parse(raw);
    }
    if (data?.access_token) {
      return getAuthClient(data.access_token);
    }
  } catch {}
  return getAnonClient();
}

function getAuthClient(accessToken) {
  if (!accessToken) return null;
  const url = defaultBackend.SUPABASE_URL;
  const key = defaultBackend.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const opts = {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  };
  if (WS) {
    opts.realtime = { params: { eventsPerSecond: 5 }, transport: WS };
  }
  return createClient(url, key, opts);
}

function getAdminClient() {
  if (adminClient) return adminClient;
  const url = defaultBackend.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  adminClient = createClient(url, key, {
    auth: { persistSession: false },
  });
  return adminClient;
}

function destroyClients() {
  if (anonClient) {
    try { anonClient.removeAllChannels(); } catch {}
    anonClient = null;
  }
  if (adminClient) {
    try { adminClient.removeAllChannels(); } catch {}
    adminClient = null;
  }
}

module.exports = { getAnonClient, getAdminClient, getAuthClient, getAuthedClient, destroyClients };

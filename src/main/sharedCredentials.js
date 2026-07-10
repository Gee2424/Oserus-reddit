const { getAnonClient } = require('./supabaseClient');
const { generateKey, encryptWithKey, decryptWithKey, sha256 } = require('./crypto');

// Team key cache: teamId -> Buffer (in-memory only, never persisted)
const teamKeyCache = new Map();

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function keyWrappingKey() {
  const raw = getServiceRoleKey();
  if (!raw) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return sha256(raw).subarray(0, 32);
}

// Initialize team encryption key. Called when a team is created.
async function initTeamKey(teamId) {
  const teamKey = generateKey();
  const kwk = keyWrappingKey();
  const wrapped = encryptWithKey(teamKey.toString('hex'), kwk);
  const client = getAnonClient();
  if (!client) return { ok: false, error: 'Supabase not configured' };
  const { error } = await client.from('teams').update({
    encrypted_key: wrapped,
    key_version: 1,
  }).eq('id', teamId);
  if (error) return { ok: false, error: error.message };
  teamKeyCache.set(teamId, teamKey);
  return { ok: true };
}

// Load team key into cache. Called on sign in or team switch.
async function loadTeamKey(teamId) {
  if (teamKeyCache.has(teamId)) return { ok: true };
  const client = getAnonClient();
  if (!client) return { ok: false, error: 'Supabase not configured' };
  const { data, error } = await client.from('teams').select('encrypted_key').eq('id', teamId).single();
  if (error || !data?.encrypted_key) return { ok: false, error: error?.message || 'No team key' };
  try {
    const kwk = keyWrappingKey();
    const hex = decryptWithKey(data.encrypted_key, kwk);
    teamKeyCache.set(teamId, Buffer.from(hex, 'hex'));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getTeamKeyBuffer(teamId) {
  return teamKeyCache.get(teamId) || null;
}

// Encrypt and store a credential in Supabase
async function setSharedCredential(teamId, accountId, credentialType, plaintext, userId) {
  const keyBuf = getTeamKeyBuffer(teamId);
  if (!keyBuf) return { ok: false, error: 'Team key not loaded' };
  const payload = encryptWithKey(plaintext, keyBuf);
  const client = getAnonClient();
  if (!client) return { ok: false, error: 'Supabase not configured' };
  const { error } = await client.from('shared_credentials').upsert({
    team_id: teamId,
    account_id: Number(accountId),
    credential_type: credentialType,
    encrypted_payload: payload,
    created_by: userId,
  }, { onConflict: 'team_id,account_id,credential_type' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Retrieve and decrypt a credential from Supabase
async function getSharedCredential(teamId, accountId, credentialType) {
  const keyBuf = getTeamKeyBuffer(teamId);
  if (!keyBuf) return null;
  const client = getAnonClient();
  if (!client) return null;
  const { data, error } = await client.from('shared_credentials')
    .select('encrypted_payload')
    .eq('team_id', teamId)
    .eq('account_id', Number(accountId))
    .eq('credential_type', credentialType)
    .maybeSingle();
  if (error || !data?.encrypted_payload) return null;
  try {
    return decryptWithKey(data.encrypted_payload, keyBuf);
  } catch {
    return null;
  }
}

// Delete a credential from Supabase
async function deleteSharedCredential(teamId, accountId, credentialType) {
  const client = getAnonClient();
  if (!client) return { ok: false, error: 'Supabase not configured' };
  const { error } = await client.from('shared_credentials').delete()
    .eq('team_id', teamId)
    .eq('account_id', Number(accountId))
    .eq('credential_type', credentialType);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function clearTeamKeyCache() {
  teamKeyCache.clear();
}

function removeTeamKey(teamId) {
  teamKeyCache.delete(teamId);
}

module.exports = {
  initTeamKey, loadTeamKey, setSharedCredential, getSharedCredential,
  deleteSharedCredential, getTeamKeyBuffer, clearTeamKeyCache, removeTeamKey,
};

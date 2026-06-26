/**
 * Quick fix for existing CloakManager profiles
 * Run this with: node fix-cdp-profiles.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

// Get the database path (same as main app)
const dbPath = path.join(app.getPath('userData'), 'reddit-manager.db');
console.log('Opening database:', dbPath);

const db = new Database(dbPath);

// Check current state
console.log('\n=== CURRENT STATE ===');
const currentProfiles = db.prepare(`
  SELECT a.id, a.username, bs.browser_mode, bs.cloak_profile_name
  FROM reddit_accounts a
  LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
  WHERE bs.cloak_profile_name IS NOT NULL
`).all();

console.log('Accounts with CloakManager profiles:');
currentProfiles.forEach(profile => {
  console.log(`- ${profile.username} (${profile.browser_mode}): ${profile.cloak_profile_name}`);
});

// Fix records that have cloak_profile_name but wrong browser_mode
console.log('\n=== FIXING RECORDS ===');
const fixCount = db.prepare(`
  UPDATE account_browser_settings
  SET browser_mode = 'cloakmanager'
  WHERE cloak_profile_name IS NOT NULL AND browser_mode != 'cloakmanager'
`).run();

console.log(`Fixed ${fixCount.changes} records`);

// Verify fix
console.log('\n=== AFTER FIX ===');
const fixedProfiles = db.prepare(`
  SELECT a.id, a.username, bs.browser_mode, bs.cloak_profile_name
  FROM reddit_accounts a
  LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
  WHERE bs.cloak_profile_name IS NOT NULL
`).all();

console.log('Accounts with CloakManager profiles:');
fixedProfiles.forEach(profile => {
  console.log(`- ${profile.username} (${profile.browser_mode}): ${profile.cloak_profile_name}`);
});

console.log('\n✅ Fix complete! CDP should now work for existing profiles.');

db.close();

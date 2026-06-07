const path = require('path');
const { execFile } = require('child_process');
const elog = require('electron-log');
const { getKv, setKv } = require('../db');

const KV_ADB = 'tools.adb.path';
const KV_LIBI_DIR = 'tools.libimobiledevice.dir';

function runTool(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ENOENT') return resolve({ ok: false, missing: true, stdout: '', stderr: '' });
          return resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err.message });
        }
        resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    } catch (e) {
      resolve({ ok: false, error: e?.message });
    }
  });
}

function getToolPaths() {
  let adb = 'adb';
  let idevice_id = 'idevice_id';
  let ideviceinfo = 'ideviceinfo';
  try {
    const storedAdb = getKv(KV_ADB);
    if (storedAdb) adb = storedAdb;
    const dir = getKv(KV_LIBI_DIR);
    if (dir) {
      idevice_id = path.join(dir, process.platform === 'win32' ? 'idevice_id.exe' : 'idevice_id');
      ideviceinfo = path.join(dir, process.platform === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo');
    }
  } catch {}
  return { adb, idevice_id, ideviceinfo };
}

function setToolPaths({ adb, libimobiledeviceDir } = {}) {
  if (adb !== undefined) setKv(KV_ADB, adb || null);
  if (libimobiledeviceDir !== undefined) setKv(KV_LIBI_DIR, libimobiledeviceDir || null);
}

function parseAdbDevices(stdout) {
  const lines = stdout.split(/\r?\n/).slice(1);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const id = parts[0];
    const status = parts[1];
    let model = null;
    for (const p of parts.slice(2)) {
      if (p.startsWith('model:')) model = p.slice(6);
    }
    out.push({ id, model: model || id, status });
  }
  return out;
}

async function listDevices() {
  const { adb, idevice_id, ideviceinfo } = getToolPaths();
  const result = { android: [], ios: [] };

  const adbRes = await runTool(adb, ['devices', '-l']);
  if (adbRes.ok) {
    try { result.android = parseAdbDevices(adbRes.stdout); }
    catch (e) { elog.warn('[deviceBridge] adb parse failed:', e?.message); }
  } else if (!adbRes.missing) {
    elog.warn('[deviceBridge] adb error:', adbRes.error);
  }

  const idRes = await runTool(idevice_id, ['-l']);
  if (idRes.ok) {
    const udids = idRes.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const udid of udids) {
      let name = udid;
      const info = await runTool(ideviceinfo, ['-u', udid, '-k', 'ProductType']);
      if (info.ok && info.stdout.trim()) name = info.stdout.trim();
      result.ios.push({ udid, name, jailbroken: null });
    }
  } else if (!idRes.missing) {
    elog.warn('[deviceBridge] idevice_id error:', idRes.error);
  }

  return result;
}

module.exports = { listDevices, getToolPaths, setToolPaths };

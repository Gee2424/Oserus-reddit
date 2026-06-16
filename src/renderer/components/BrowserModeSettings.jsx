import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

/**
 * Browser Mode Settings Component
 *
 * Provides admin-only interface for configuring CloakManager integration:
 * - CloakManager availability indicator
 * - Default browser mode selection (electron/cloakmanager)
 * - CloakManager URL configuration
 * - Help text and tooltips
 *
 * Only accessible to users with admin role.
 */

export default function BrowserModeSettings() {
  const { token, user } = useAuth();
  const [available, setAvailable] = useState(null);
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState({
    defaultMode: 'electron',
    cloakmanagerUrl: 'http://127.0.0.1:7331'
  });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  // Check if user is admin
  if (user?.role !== 'admin') {
    return (
      <div style={{
        padding: '20px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-0)'
      }}>
        <div style={{
          padding: '16px',
          background: 'var(--accent-soft)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          fontSize: 13,
          color: 'var(--text-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-0)' }}>
              Admin Only
            </div>
            <div style={{ fontSize: 12 }}>
              Browser mode settings are restricted to administrators. Contact your admin to change these settings.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Check CloakManager availability on mount
  useEffect(() => {
    let cancelled = false;

    async function checkAvailability() {
      setChecking(true);
      try {
        const result = await window.api.cloakmanager.checkAvailable({ token });
        if (!cancelled) {
          setAvailable(result.available);
          setChecking(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to check CloakManager availability:', err);
          setAvailable(false);
          setChecking(false);
        }
      }
    }

    checkAvailability();
    return () => { cancelled = true; };
  }, [token]);

  // Load current settings on mount
  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const result = await window.api.cloakmanager.getSettings({ token });
        if (!cancelled && result.ok) {
          setSettings({
            defaultMode: result.settings.defaultMode || 'electron',
            cloakmanagerUrl: result.settings.cloakmanagerUrl || 'http://127.0.0.1:7331'
          });
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load settings:', err);
        }
      }
    }

    loadSettings();
    return () => { cancelled = true; };
  }, [token]);

  // Handle settings save
  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);

    try {
      const result = await window.api.cloakmanager.updateSettings({
        token,
        settings: {
          defaultMode: settings.defaultMode,
          cloakmanagerUrl: settings.cloakmanagerUrl
        }
      });

      if (result.ok) {
        setSaveMessage({ type: 'success', text: 'Settings saved successfully' });
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSaveMessage({ type: 'error', text: result.error || 'Failed to save settings' });
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  }

  // Handle CloakManager URL check
  async function handleCheckConnection() {
    setChecking(true);
    setAvailable(null);

    try {
      // Temporarily update the URL for this check
      const originalUrl = settings.cloakmanagerUrl;
      // Note: This would require the backend to support dynamic URL checking
      // For now, we'll just use the current check
      const result = await window.api.cloakmanager.checkAvailable({ token });
      setAvailable(result.available);
    } catch (err) {
      console.error('Connection check failed:', err);
      setAvailable(false);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={{
      padding: '20px 24px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-0)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
            Browser Mode Settings
          </h3>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
            Configure CloakManager integration and default browser mode for all users
          </div>
        </div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            background: 'var(--bg-1)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-2)',
            cursor: 'pointer'
          }}
        >
          {showHelp ? 'Hide Help' : 'Show Help'}
        </button>
      </div>

      {/* Help Section */}
      {showHelp && (
        <div style={{
          padding: 16,
          background: 'var(--bg-1)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          marginBottom: 20,
          fontSize: 13,
          color: 'var(--text-2)',
          lineHeight: 1.5
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-0)' }}>
            About Browser Modes
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>Electron Mode:</strong> Standard browser view using Electron webviews.
            All accounts share the same browser fingerprint. Faster and more stable.
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>CloakManager Mode:</strong> Advanced browser with unique fingerprints per account.
            Provides better account isolation and anti-detection. Requires CloakManager backend service.
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            <strong>Recommendation:</strong> Use CloakManager mode for high-value accounts or when operating
            in regulated markets. Electron mode is sufficient for general use.
          </div>
        </div>
      )}

      {/* CloakManager Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        background: 'var(--bg-1)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        marginBottom: 16
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: checking ? 'var(--gold)' : (available ? 'var(--accent)' : '#ef4444'),
          boxShadow: checking ? '0 0 0 2px rgba(212,166,74,0.2)' : (available ? '0 0 0 2px rgba(26,143,108,0.2)' : '0 0 0 2px rgba(239,68,68,0.2)')
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-0)' }}>
            CloakManager Service
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {checking && 'Checking connection...'}
            {!checking && available && 'Connected and operational'}
            {!checking && !available && 'Not available - check service status'}
          </div>
        </div>
        <button
          onClick={handleCheckConnection}
          disabled={checking}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            background: 'var(--bg-0)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-2)',
            cursor: checking ? 'not-allowed' : 'pointer',
            opacity: checking ? 0.6 : 1
          }}
        >
          {checking ? 'Checking...' : 'Check Connection'}
        </button>
      </div>

      {/* Settings Form */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 2fr',
        gap: 20,
        alignItems: 'start'
      }}>
        {/* Default Browser Mode */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text-0)' }}>
            Default Browser Mode
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8 }}>
            Default mode for users who haven't set account-specific preferences
          </div>
          <select
            value={settings.defaultMode}
            onChange={(e) => setSettings({ ...settings, defaultMode: e.target.value })}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              background: 'var(--bg-0)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-0)'
            }}
          >
            <option value="electron">Electron (Standard)</option>
            <option value="cloakmanager">CloakManager (Advanced)</option>
          </select>
        </div>

        {/* CloakManager URL */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text-0)' }}>
            CloakManager Service URL
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 8 }}>
            API endpoint for CloakManager backend service
          </div>
          <input
            type="text"
            value={settings.cloakmanagerUrl}
            onChange={(e) => setSettings({ ...settings, cloakmanagerUrl: e.target.value })}
            placeholder="http://127.0.0.1:7331"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              background: 'var(--bg-0)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-0)',
              fontFamily: 'monospace'
            }}
          />
        </div>
      </div>

      {/* Save Button and Message */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            background: 'var(--accent)',
            color: '#1a0d08',
            border: 'none',
            borderRadius: 4,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

        {saveMessage && (
          <div style={{
            padding: '6px 12px',
            fontSize: 12,
            background: saveMessage.type === 'success' ? 'var(--accent-soft)' : '#fecaca',
            color: saveMessage.type === 'success' ? 'var(--accent)' : '#b91c1c',
            borderRadius: 4,
            border: `1px solid ${saveMessage.type === 'success' ? 'var(--accent)' : '#b91c1c'}`
          }}>
            {saveMessage.text}
          </div>
        )}
      </div>

      {/* Warning if CloakManager unavailable but set as default */}
      {!checking && !available && settings.defaultMode === 'cloakmanager' && (
        <div style={{
          marginTop: 16,
          padding: 12,
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: 6,
          fontSize: 12,
          color: '#92400e',
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div>
            <strong>Warning:</strong> CloakManager mode is set as default but the service is not available.
            Users will see errors when trying to use CloakManager mode.
          </div>
        </div>
      )}
    </div>
  );
}
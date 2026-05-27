import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './auth.jsx';

const PermissionsContext = createContext({
  permissions: new Set(),
  effectiveRole: null,
  previewing: false,
  previewAs: () => {},
  exitPreview: () => {},
  reload: () => {},
});

export function PermissionsProvider({ children }) {
  const { token, user } = useAuth();
  const [permissions, setPermissions] = useState(new Set());
  const [effectiveRole, setEffectiveRole] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewRole, setPreviewRole] = useState(null);

  const load = useCallback(async () => {
    if (!token || !user) {
      setPermissions(new Set());
      setEffectiveRole(null);
      return;
    }
    try {
      const res = await window.api.roles.myPermissions({ token, previewRoleKey: previewRole });
      if (res.ok) {
        setPermissions(new Set(res.permissions));
        setEffectiveRole(res.role);
        setPreviewing(!!res.previewing);
      }
    } catch (e) {
      // Preview attempt without roles.manage — silently fall back to real role.
      if (previewRole) setPreviewRole(null);
      console.error('[permissions] load failed', e);
    }
  }, [token, user, previewRole]);

  useEffect(() => { load(); }, [load]);

  const previewAs = useCallback((roleKey) => setPreviewRole(roleKey || null), []);
  const exitPreview = useCallback(() => setPreviewRole(null), []);

  return (
    <PermissionsContext.Provider value={{
      permissions, effectiveRole, previewing, previewAs, exitPreview, reload: load,
    }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionsContext);
}

export function useCan() {
  const { permissions } = useContext(PermissionsContext);
  return (key) => permissions.has(key);
}

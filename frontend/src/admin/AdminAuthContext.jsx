import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import adminApi from './services/adminApi';

const AdminAuthContext = createContext(null);

/**
 * Single source of truth for "who is the logged-in admin, and do we even
 * know yet". Every admin page reads this instead of calling adminApi.me()
 * itself — avoids a waterfall of duplicate /admin/me calls and gives
 * ProtectedRoute (AdminApp.jsx) one place to redirect from.
 */
export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'authenticated' | 'anonymous'

  const refresh = useCallback(async () => {
    try {
      const { admin: current } = await adminApi.me();
      setAdmin(current);
      setStatus('authenticated');
    } catch (err) {
      setAdmin(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const { admin: loggedInAdmin } = await adminApi.login(email, password);
    setAdmin(loggedInAdmin);
    setStatus('authenticated');
    return loggedInAdmin;
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApi.logout();
    } finally {
      setAdmin(null);
      setStatus('anonymous');
    }
  }, []);

  return <AdminAuthContext.Provider value={{ admin, status, login, logout, refresh }}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>');
  return ctx;
}

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { UserProfile } from '../../shared/types.ts';
import { api, setStoredToken } from '../api/client.ts';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<UserProfile | null>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.auth.me();
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const res = await api.auth.login({ email, password });
    setStoredToken(res.token);
    setUser(res.user);
  };

  const signup = async (email: string, password: string, name: string) => {
    const res = await api.auth.signup({ email, password, name });
    setStoredToken(res.token);
    setUser(res.user);
  };

  const loginDemo = async () => {
    const res = await api.auth.demo();
    setStoredToken(res.token);
    setUser(res.user);
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } finally {
      setStoredToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, signup, loginDemo, logout, refreshUser, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

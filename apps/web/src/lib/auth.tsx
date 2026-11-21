import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, post } from '../api/client';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  status: string;
}

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { email: string; name: string; password: string; acceptTerms: boolean }) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User | null }>('/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const r = await post<{ user: User }>('/auth/login', { email, password });
    setUser(r.user);
    return r.user;
  };
  const register = async (data: { email: string; name: string; password: string; acceptTerms: boolean }) => {
    const r = await post<{ user: User }>('/auth/register', data);
    setUser(r.user);
    return r.user;
  };
  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, ready, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

export const isAdmin = (u: User | null) => !!u && (u.role === 'ADMIN' || u.role === 'SUPERADMIN');

'use client';

/**
 * Auth context. Reflects the token the backend OIDC/local login flow persists
 * under localStorage["jubileeVerseAuth"]. The provider hydrates from storage on
 * mount and stays in sync across tabs (and after the /auth/callback redirect)
 * via the `storage` event.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import {
  canAccessCms as computeCanAccessCms,
  clearStoredAuth,
  getStoredAuth,
  setStoredAuth,
  userInitials,
} from './authStorage';
import type { AuthUser } from './types';

interface AuthContextValue {
  user: AuthUser | null;
  token: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  canAccessCms: boolean;
  initials: string;
  /** Re-read /api/auth/me and update stored user (keeps the existing token). */
  refresh: () => Promise<void>;
  /** Clear stored auth and reset to the signed-out state. */
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  /** Sync user/token from localStorage. Returns true if a stored session exists. */
  const hydrate = useCallback(() => {
    const stored = getStoredAuth();
    if (stored?.authenticated && stored.user) {
      setUser(stored.user);
      setToken(stored.token || stored.tokens?.access || stored.tokens?.accessToken || '');
      return true;
    }
    setUser(null);
    setToken('');
    return false;
  }, []);

  useEffect(() => {
    const hadStored = hydrate();
    if (hadStored) {
      setIsLoading(false);
    } else {
      // OIDC/cookie reconciliation: there's no local bearer token, but the user
      // may have an httpOnly cookie session from the backend OIDC callback.
      // Probe /api/auth/me once (cookie-based) so they still appear signed in.
      (async () => {
        try {
          const res = await api.get<{ success?: boolean; user?: AuthUser }>('/api/auth/me');
          if (res?.success && res.user) setUser(res.user);
        } catch {
          /* truly signed out */
        } finally {
          setIsLoading(false);
        }
      })();
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === 'jubileeVerseAuth') hydrate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [hydrate]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ success?: boolean; user?: AuthUser }>('/api/auth/me');
      if (!res?.success || !res.user) throw new Error('not authenticated');
      setUser(res.user);
      const stored = getStoredAuth();
      // Only persist when we hold a bearer token (cookie-only sessions have none).
      if (stored?.token || stored?.tokens) {
        setStoredAuth({
          authenticated: true,
          user: res.user,
          token: stored.token,
          tokens: stored.tokens,
        });
      }
    } catch {
      // Token invalid/expired — treat as signed out.
      clearStoredAuth();
      setUser(null);
      setToken('');
    }
  }, []);

  const signOut = useCallback(() => {
    // Best-effort server-side logout (revokes the session) before clearing local state.
    api.post('/api/auth/logout').catch(() => {});
    clearStoredAuth();
    setUser(null);
    setToken('');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!user,
      isLoading,
      canAccessCms: computeCanAccessCms(user),
      initials: userInitials(user),
      refresh,
      signOut,
    }),
    [user, token, isLoading, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}

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
  getRefreshToken,
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
      // api.get transparently redeems the refresh token when the access token has
      // lapsed, so this doubles as the session keepalive.
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
          refreshToken: stored.refreshToken,
          expiresAt: stored.expiresAt,
        });
        setToken(stored.token || '');
      }
    } catch {
      // Token invalid/expired — treat as signed out.
      clearStoredAuth();
      setUser(null);
      setToken('');
    }
  }, []);

  // Keep the session warm: periodically re-validate, which transparently mints a
  // fresh access token via the refresh token, so a long-running or idle tab never
  // silently lapses mid-edit. Only runs while a refresh token exists.
  useEffect(() => {
    const id = setInterval(() => {
      if (getRefreshToken()) void refresh();
    }, 25 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const signOut = useCallback(() => {
    // Best-effort server-side logout. The refresh token must go in the body — it is
    // the durable half of the session and is not otherwise carried on the request.
    api.post('/api/auth/logout', { refreshToken: getRefreshToken() }).catch(() => {});
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

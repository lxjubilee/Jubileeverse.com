/**
 * Low-level helpers for the auth token persisted by the backend OIDC/local
 * login flow under localStorage["jubileeVerseAuth"]. These are framework-free
 * so they can be used from the API client, the auth context, or anywhere.
 *
 * The shape and key match the original static site exactly so that the
 * unchanged backend /auth/callback flow (proxied through Next) keeps working.
 */
import type { AuthUser, StoredAuth } from './types';

export const AUTH_STORAGE_KEY = 'jubileeVerseAuth';

/** Roles that may access the CMS / back office. Mirrors the original site. */
export const PRIVILEGED_ROLES = [
  'admin',
  'site_owner',
  'publisher',
  'reviewer',
  'editor',
  'persona_operator',
] as const;

export function getStoredAuth(): StoredAuth | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist the session. The refresh token is MERGED from what is already stored:
 * a refresh response carries a new access token but echoes (or omits) the refresh
 * token, and dropping it here would silently end the session.
 */
export function setStoredAuth(auth: StoredAuth): void {
  if (typeof window === 'undefined') return;
  const prev = getStoredAuth();
  const merged: StoredAuth = {
    ...auth,
    refreshToken: auth.refreshToken ?? prev?.refreshToken ?? prev?.tokens?.refresh,
  };
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(merged));
}

export function clearStoredAuth(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

/**
 * Returns a *usable* bearer token, tolerating the legacy `tokens.access` shape.
 *
 * Once `expiresAt` has passed this returns '' so the API client refreshes rather
 * than firing a request it knows will 401 — but it deliberately does NOT clear
 * storage, because the refresh token next to it is still perfectly good.
 */
export function getAuthToken(): string {
  const auth = getStoredAuth();
  if (!auth) return '';
  if (auth.expiresAt && Date.parse(auth.expiresAt) <= Date.now()) return '';
  return auth.token || auth.tokens?.access || auth.tokens?.accessToken || '';
}

/** The durable half of the session, if one was issued. */
export function getRefreshToken(): string {
  const auth = getStoredAuth();
  return auth?.refreshToken || auth?.tokens?.refresh || '';
}

export function isAuthenticated(): boolean {
  const auth = getStoredAuth();
  return !!(auth?.authenticated && auth.user);
}

/** Mirrors the original `canAccessCms` rule used to show the Back Office link. */
export function canAccessCms(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  const role = user.role ?? '';
  return (
    (PRIVILEGED_ROLES as readonly string[]).includes(role) ||
    user.has_cms_access === true ||
    (Array.isArray(user.entitlements) && user.entitlements.includes('jubileeverse_cms'))
  );
}

/** Two-letter initials for the profile avatar circle. */
export function userInitials(user: AuthUser | null | undefined): string {
  if (!user) return '?';
  const first = user.firstName?.trim() || '';
  const last = user.lastName?.trim() || '';
  if (first || last) {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '?';
  }
  const display = (user.displayName || user.name || user.email || '').trim();
  if (!display) return '?';
  const parts = display.split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return display.slice(0, 2).toUpperCase();
}

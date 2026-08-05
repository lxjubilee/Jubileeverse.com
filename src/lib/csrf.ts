/**
 * CSRF token for state-changing API calls.
 *
 * The backend guards every non-GET `/api/` request (`requireCsrf` in
 * server.js): when the browser carries a session cookie it demands an
 * `X-CSRF-Token` header matching the `jv-csrf` cookie, and answers 403
 * "CSRF token mismatch" otherwise.
 *
 * That cookie is deliberately NOT HttpOnly — it is set alongside the session
 * at `/auth/callback` and `/auth/local-login` precisely so this file can read
 * it back and echo it. The session cookie itself is HttpOnly and is never
 * touched here.
 *
 * Why this matters in production and not in development: the session cookie is
 * named `jv-session` over plain HTTP but `__Host-jv-session` once APP_BASE_URL
 * is https, and only the deployed site puts readers through the OIDC sign-in
 * that sets it. A developer on localhost is usually signed out, or signed in on
 * the bearer-token path, so the guard never fires and the missing header goes
 * unnoticed until it reaches the live site.
 */

/** The name is fixed and unprefixed — `_setCookie` writes `jv-csrf` as-is. */
const CSRF_COOKIE = 'jv-csrf';

/** The current CSRF token, or null when the reader has no cookie session. */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== CSRF_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return value || null;
  }
  return null;
}

/**
 * Header bag to spread into a `fetch` init for a state-changing request.
 * Empty when there is no cookie session, which is exactly when the backend
 * skips the check and authenticates on the bearer token instead.
 */
export function csrfHeaders(): Record<string, string> {
  const token = getCsrfToken();
  return token ? { 'X-CSRF-Token': token } : {};
}

/**
 * Post-authentication destination resolution, shared by the sign-in and sign-up
 * screens (both of which end by signing the user in and navigating away).
 */

/** Auth screens are never a valid post-login destination — they would bounce
 *  the user straight back to sign-in. */
const AUTH_PATHS = ['/signin', '/signup', '/forgot-password', '/reset-password'];

/**
 * Resolve a safe post-login destination from ?redirect= / ?next=. Only same-site
 * relative paths are honored (must start with a single "/" and not "//"), to
 * avoid open-redirect to an external origin. Anything else — no param, an
 * external URL, or an auth route — lands on the home screen.
 */
export function safeRedirectTarget(): string {
  if (typeof window === 'undefined') return '/';
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('redirect') || params.get('next') || '';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase() || '/';
  if (AUTH_PATHS.includes(path)) return '/';
  return raw;
}

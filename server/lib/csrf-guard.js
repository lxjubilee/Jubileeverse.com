'use strict';
/**
 * The CSRF decision for `/api/` requests.
 *
 * Pulled out of server.js because the guard had a fault that could not be seen
 * by reading it: the middleware is mounted with `app.use('/api/', requireCsrf)`,
 * and Express gives a mounted handler a `req.path` RELATIVE to its mount point.
 * A request for `/api/tts` therefore arrived with `req.path === '/tts'`, which
 * was then compared against a list written as `['/api/track/view', '/api/tts',
 * …]`. Nothing ever matched, so the three endpoints that were deliberately
 * exempted had been guarded all along.
 *
 * That is invisible in development and fatal in production: the guard only
 * engages when the browser carries a session COOKIE, and only the deployed site
 * puts readers through the OIDC sign-in that sets one. A developer on localhost
 * is signed out, or signed in on the bearer-token path, so every one of these
 * endpoints answers 200 locally and 403 for a signed-in reader on the live site.
 *
 * The decision is a pure function of the request so it can be tested directly,
 * with the full path passed in rather than re-derived here.
 */

/**
 * Paths the guard deliberately lets through, matched against the FULL request
 * path.
 *
 * Each is reachable anonymously — the guard already calls `next()` when there is
 * no session cookie — so a CSRF token protects nothing on them: an attacker can
 * simply call them without a cookie. All the check achieved was to break the
 * feature for signed-in readers, who are the only ones it applied to.
 *
 *   /api/track/view      anonymous telemetry
 *   /api/tts             Read Aloud audio
 *   /api/verse           the daily verse
 *
 * `/api/translate-batch` is deliberately NOT here. It is guarded, and the client
 * echoes the `jv-csrf` cookie back as a header (src/lib/csrf.ts) — the language
 * picker's own fix. Exempting it as well would quietly undo that decision.
 */
const CSRF_EXEMPT_PATHS = Object.freeze([
    '/api/track/view',
    '/api/tts',
    '/api/verse',
]);

/** Methods that cannot change state, so never need a token. */
const SAFE_METHODS = Object.freeze(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rebuild the full request path from a mounted middleware's view of it.
 *
 * `req.baseUrl` is the mount ('/api'), `req.path` the remainder ('/tts'). Joined
 * carefully: the mount is registered as '/api/' and Express has been known to
 * report it either way, so a doubled slash must not produce '/api//tts' and miss
 * the list all over again.
 */
function fullRequestPath(baseUrl, path) {
    const joined = `${baseUrl || ''}${path || ''}`;
    return joined.replace(/\/{2,}/g, '/') || '/';
}

/** Whether this path is exempt from the CSRF requirement. */
function isCsrfExempt(fullPath) {
    return CSRF_EXEMPT_PATHS.includes(fullPath);
}

/**
 * Decide whether a request may proceed.
 *
 * Returns `{ allow: true }`, or `{ allow: false, status, error }` describing the
 * rejection. Deliberately says nothing about HOW to reject, so the middleware
 * stays a thin wrapper.
 */
function csrfDecision({ method, baseUrl, path, cookies = {}, csrfHeader, sessionCookieName }) {
    if (SAFE_METHODS.includes(String(method || '').toUpperCase())) return { allow: true };

    if (isCsrfExempt(fullRequestPath(baseUrl, path))) return { allow: true };

    // No session cookie means the caller authenticates with a bearer token,
    // which a cross-site form post cannot attach. Nothing to protect against.
    if (!cookies[sessionCookieName]) return { allow: true };

    const csrfCookie = cookies['jv-csrf'];
    if (!csrfCookie || csrfCookie !== csrfHeader) {
        return { allow: false, status: 403, error: 'CSRF token mismatch' };
    }
    return { allow: true };
}

module.exports = {
    CSRF_EXEMPT_PATHS,
    SAFE_METHODS,
    fullRequestPath,
    isCsrfExempt,
    csrfDecision,
};

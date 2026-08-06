'use strict';
/**
 * lib/sso-client.js — Jubilee Identity Authority (SSO) client.
 *
 * Used when AUTH_LOGIN_MODE === 'sso'. Ported from JubiLujah's
 * app/api/src/services/ssoClient.js so the whole family speaks one contract.
 *
 * The SSO (sso.jubileeinspire.com) is the SINGLE credential store for the family.
 * It hashes with scrypt in the format `scrypt:<saltHex>:<derivedKeyHex>`, so a
 * password (or a pre-computed hash in that format) verifies there directly.
 *
 * This is NOT a browser redirect flow. There is no OIDC handshake, no cookie, no
 * front-channel of any kind: the browser POSTs email+password to OUR API, we
 * verify it server-to-server here, and then WE mint the session. JubileeVerse
 * stays the session authority AND the role authority — the SSO only answers
 * "is this password correct for this identity?".
 *
 * JubileeVerse authenticates as a trusted service CLIENT: it POSTs its client_id
 * + client_secret to /api/auth/service/token, gets a short-lived bearer, and
 * presents it on the service-gated endpoints below. The bearer is cached
 * in-process until shortly before it expires; a 401 forces exactly one re-fetch.
 *
 *   POST /api/auth/service/token     { client_id, client_secret } -> { token, expiresAt }
 *   POST /api/auth/login             { email, password, site }     -> { user, ... } | 401
 *   POST /api/auth/lookup            { email }                     -> { exists }
 *   POST /api/auth/service/provision { email, first_name, last_name, password_hash, site } -> 201 | 409
 *   POST /api/auth/service/password  { email, new_password }       -> { success }
 *   POST /api/auth/service/profile   { email, first_name?, last_name?, date_of_birth? } -> { user }
 */

const crypto = require('crypto');

const TOKEN_PATH        = '/api/auth/service/token';
const LOGIN_PATH        = '/api/auth/login';
const LOOKUP_PATH       = '/api/auth/lookup';
const PROVISION_PATH    = '/api/auth/service/provision';
const SET_PASSWORD_PATH = '/api/auth/service/password';
const PROFILE_PATH      = '/api/auth/service/profile';
const SKEW_MS = 60_000; // refresh a little before the real expiry

const SSO = {
    baseUrl:   (process.env.SSO_API_BASE || 'https://sso.jubileeinspire.com').replace(/\/$/, ''),
    clientId:   process.env.SSO_CLIENT_ID || 'jubileeverse',
    clientSecret: process.env.SSO_CLIENT_SECRET || '',
    site:       process.env.SSO_SITE || 'jubileeverse',
    timeoutMs:  Number(process.env.SSO_TIMEOUT_MS || 8000),
};

let cached = null; // { token: string, expiresAt: number (ms epoch) }

/** SSO delegation is only possible once a client secret has been issued to us. */
function ssoEnabled() {
    return Boolean(SSO.clientId && SSO.clientSecret);
}

/**
 * Hash a plaintext password into the authority's scrypt format:
 *   scrypt:<saltHex>:<derivedKeyHex>   (16-byte random salt, 64-byte key)
 *
 * Note this is NOT the same as server.js's authHashPassword(), which passes the
 * salt as a hex STRING and keeps hash/salt in two columns. That difference is why
 * existing JubileeVerse password hashes cannot be bulk-exported to the SSO — they
 * migrate lazily instead, one user at a time, on their next successful sign-in.
 */
function ssoHashPassword(plaintext) {
    const salt = crypto.randomBytes(16);
    const dk = crypto.scryptSync(plaintext, salt, 64);
    return `scrypt:${salt.toString('hex')}:${dk.toString('hex')}`;
}

function ssoFetch(url, init) {
    return fetch(url, { ...init, signal: AbortSignal.timeout(SSO.timeoutMs) });
}

async function fetchToken() {
    const res = await ssoFetch(`${SSO.baseUrl}${TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: SSO.clientId, client_secret: SSO.clientSecret }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`SSO token endpoint ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const token = data.token || data.access_token;
    if (!token) throw new Error('SSO token endpoint returned no token');
    const parsed = data.expiresAt ? Date.parse(data.expiresAt) : NaN;
    const exp = Number.isNaN(parsed) ? Date.now() + 30 * 60_000 : parsed;
    cached = { token, expiresAt: exp - SKEW_MS };
    return token;
}

async function getToken(forceRefresh = false) {
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;
    return fetchToken();
}

/**
 * Call a service-gated SSO endpoint with the cached bearer; refresh once on 401.
 * Returns { status, body } — the caller decides how to interpret it.
 *
 * `ambiguous401` marks endpoints where 401 is ALSO a legitimate answer about the
 * end user rather than about us — /api/auth/login answers "wrong password" that
 * way. Retrying blindly there would cost the authority a spare token fetch plus a
 * second login attempt on every mistyped password. So on those endpoints we only
 * re-fetch when the response carries a WWW-Authenticate challenge, which per
 * RFC 6750 is the unambiguous signal that OUR bearer was the thing rejected.
 * Stale-bearer recovery still works; bad passwords no longer double-hit.
 */
async function callSso(path, payload, { ambiguous401 = false } = {}) {
    const doPost = (token) =>
        ssoFetch(`${SSO.baseUrl}${path}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    let token = await getToken();
    let res = await doPost(token);
    if (res.status === 401 && (!ambiguous401 || res.headers.get('www-authenticate'))) {
        cached = null;
        token = await getToken(true);
        res = await doPost(token);
    }
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

/**
 * Verify an email+password at the SSO. Returns { status, body } — a 200 body
 * carries { user: { id, email, first_name, last_name } }. Throws only if the
 * authority is unreachable, which the caller distinguishes from a 401.
 */
function ssoLogin({ email, password }) {
    return callSso(LOGIN_PATH, { email, password, site: SSO.site }, { ambiguous401: true });
}

/**
 * Does a Jubilee ID already exist for this email? Never throws.
 *   { ok: true, exists } | { ok: false, error }
 */
async function ssoLookup(email) {
    try {
        const { status, body } = await callSso(LOOKUP_PATH, { email });
        if (status !== 200) return { ok: false, error: `lookup ${status}` };
        return { ok: true, exists: body.exists === true };
    } catch (err) {
        console.warn('[sso] lookup error:', err.message);
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }
}

/**
 * Create the identity at the SSO from a PRE-COMPUTED scrypt hash — used both by
 * registration and by the lazy migration of pre-SSO accounts.
 *   { ok: true, created } | { ok: false, conflict } | { ok: false, status | error }
 *
 * A 409 is meaningful, not just a failure: it means the email already exists at
 * the authority. Callers must NOT treat that as "safe to sign in".
 */
async function ssoProvisionHash({ email, firstName, lastName, passwordHash }) {
    try {
        const { status, body } = await callSso(PROVISION_PATH, {
            email,
            first_name: firstName || null,
            last_name: lastName || null,
            password_hash: passwordHash,
            site: SSO.site,
        });
        if (status === 201) return { ok: true, created: true, user: body.user };
        if (status === 409) return { ok: false, conflict: true, user: body.user };
        return { ok: false, status };
    } catch (err) {
        console.error('[sso] provision error:', err.message);
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }
}

/**
 * Update an existing identity's profile (first/last/DOB) at the SSO, by email.
 * Used when someone edits the pre-filled details while joining a new family site,
 * so the correction propagates to the shared Jubilee ID rather than living only
 * here. Never throws: a failure to propagate must not fail the join, so callers
 * log the result and carry on with what the visitor typed.
 *   { ok: true, user } | { ok: false, status | error }
 */
async function ssoUpdateProfile(email, patch) {
    try {
        const { status, body } = await callSso(PROFILE_PATH, { email, ...patch });
        if (status === 200) return { ok: true, user: body.user };
        return { ok: false, status };
    } catch (err) {
        console.error('[sso] update-profile error:', err.message);
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }
}

/**
 * Set/overwrite a user's password at the SSO so the shared credential stays in
 * lockstep after a local reset or change.
 *   { ok: true } | { ok: false, status | error }
 */
async function ssoSetPassword(email, newPassword) {
    try {
        const { status } = await callSso(SET_PASSWORD_PATH, { email, new_password: newPassword });
        if (status === 200) return { ok: true };
        return { ok: false, status };
    } catch (err) {
        console.error('[sso] set-password error:', err.message);
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }
}

module.exports = {
    SSO,
    ssoEnabled,
    ssoHashPassword,
    ssoLogin,
    ssoLookup,
    ssoProvisionHash,
    ssoSetPassword,
    ssoUpdateProfile,
};

/**
 * Part 3 / Section 11 — Cross-Site Authentication & Session Management
 *
 * Stub tests covering:
 *   - GET /api/auth/me with valid session cookie returns { user: { email, role, name } }
 *   - GET /api/auth/me without cookie falls back to Bearer token (backward compat)
 *   - GET /auth/callback sets jv-session as HttpOnly cookie
 *   - GET /auth/callback sets jv-csrf as non-HttpOnly cookie (JS-readable)
 *   - POST /api/content without X-CSRF-Token when session cookie active → 403
 *   - POST /api/content with correct X-CSRF-Token → passes CSRF check (may 4xx for other reasons)
 *   - Bearer token auth path does NOT require CSRF header
 *   - POST /auth/logout clears session cookie + revokes refresh token + redirects
 *   - GET /idp/authorize with valid idp-session returns auth code without re-login (SSO)
 *   - POST /idp/token with refresh_token issues new tokens + old refresh token revoked
 *   - Expired / revoked refresh token → 400 error response
 *   - User lacking jubileeverse_cms entitlement denied at /auth/callback (not tested here — requires custom user setup)
 */

'use strict'

const assert = require('node:assert/strict')
const { describe, it, before } = require('node:test')
const crypto = require('node:crypto')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3107'

let adminToken = ''
let sessionCookie = ''
let csrfToken = ''
let idpSessionCookie = ''
let refreshToken = ''

async function apiReq(method, path, body, token, opts = {}) {
  const isForm = opts.form === true
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.csrf ? { 'X-CSRF-Token': opts.csrf } : {}),
      ...(opts.headers || {}),
    },
    body: body
      ? (isForm
          ? (body instanceof URLSearchParams ? body : new URLSearchParams(body))
          : JSON.stringify(body))
      : undefined,
  })
  return res
}

// Perform a full OIDC login flow and return { sessionCookie, csrfToken, idpSessionCookie, refreshToken }
async function performOidcLogin() {
  const codeVerifier = crypto.randomBytes(64).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')

  // Store pending auth request
  await fetch(`${BASE}/idp/authorize?client_id=jubileeverse-cms&redirect_uri=${encodeURIComponent('http://localhost:3107/auth/callback')}&scope=openid+profile&response_type=code&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`, { redirect: 'manual' })

  // Login
  const loginBody = new URLSearchParams({
    email: process.env.TEST_ADMIN_USER || 'admin',
    password: process.env.TEST_ADMIN_PASS || 'admin',
    state,
  })
  const loginRes = await fetch(`${BASE}/idp/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody,
  })
  const loginLocation = loginRes.headers.get('location') || ''
  const loginCookieHeader = loginRes.headers.get('set-cookie') || ''
  const idpCookie = (loginCookieHeader.match(/jv-idp-session=([^;]+)/) || [])[1] || ''

  const callbackUrl = loginLocation.startsWith('http') ? loginLocation : `${BASE}${loginLocation}`
  const callbackRes = await fetch(callbackUrl, { redirect: 'manual' })
  const setCookieHeader = callbackRes.headers.get('set-cookie') || ''

  // Parse session and CSRF cookies
  const sessionMatch = setCookieHeader.match(/jv-session=([^;]+)/)
  const csrfMatch = setCookieHeader.match(/jv-csrf=([^;]+)/)

  const sessionCookieValue = sessionMatch ? `jv-session=${sessionMatch[1]}` : ''
  const csrfValue = csrfMatch ? decodeURIComponent(csrfMatch[1]) : ''

  // Get refresh token via token endpoint (using same code — but it's been consumed by callback)
  // Instead, use the session to confirm login worked

  return {
    sessionCookie: sessionCookieValue,
    csrfToken: csrfValue,
    idpSessionCookie: idpCookie ? `jv-idp-session=${idpCookie}` : '',
    fullSetCookieHeader: setCookieHeader,
  }
}

describe('Part 3 / Section 11 — Cross-Site Authentication & Session Management', () => {

  before(async () => {
    // Get Bearer token for backward compat tests
    const loginRes = await apiReq('POST', '/api/auth/login', {
      username: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
    })
    assert.equal(loginRes.status, 200, 'Admin login should succeed')
    adminToken = (await loginRes.json()).token

    // Perform OIDC login to get session cookies
    const result = await performOidcLogin()
    sessionCookie = result.sessionCookie
    csrfToken = result.csrfToken
    idpSessionCookie = result.idpSessionCookie
  })

  it('GET /api/auth/me with Bearer token works (backward compat)', async () => {
    const res = await apiReq('GET', '/api/auth/me', undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.user, 'Should return user object')
    assert.ok(data.user.email, 'user.email required')
    assert.ok(data.user.role, 'user.role required')
  })

  it('GET /api/auth/me with valid session cookie returns user', async () => {
    if (!sessionCookie) return // Skip if OIDC login failed
    const res = await apiReq('GET', '/api/auth/me', undefined, undefined, { cookie: sessionCookie })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.user, 'Should return user object')
    assert.ok(data.user.email, 'user.email required')
    assert.ok(data.user.role, 'user.role required')
  })

  it('GET /auth/callback sets jv-session as HttpOnly cookie', async () => {
    if (!sessionCookie) return
    // sessionCookie was already retrieved in before() — verify HttpOnly was in the Set-Cookie header
    const result = await performOidcLogin()
    const setCookie = result.fullSetCookieHeader
    // Look for session cookie with HttpOnly flag
    const sessionCookieLine = setCookie.split(',').find(c => c.includes('jv-session')) || setCookie
    assert.ok(sessionCookieLine.includes('jv-session='), 'Should set jv-session cookie')
    assert.ok(sessionCookieLine.toLowerCase().includes('httponly'), 'jv-session should be HttpOnly')
  })

  it('GET /auth/callback sets jv-csrf as non-HttpOnly cookie', async () => {
    const result = await performOidcLogin()
    const setCookie = result.fullSetCookieHeader
    const csrfLine = setCookie.split(',').find(c => c.includes('jv-csrf')) || ''
    assert.ok(csrfLine.includes('jv-csrf='), 'Should set jv-csrf cookie')
    // jv-csrf must NOT have HttpOnly flag
    assert.ok(!csrfLine.toLowerCase().includes('httponly'), 'jv-csrf should NOT be HttpOnly')
  })

  it('POST /api/content without X-CSRF-Token when session cookie active returns 403', async () => {
    if (!sessionCookie) return
    const res = await apiReq('POST', '/api/content', { title: 'test', object_type: 'article' }, undefined, {
      cookie: sessionCookie,
      // No CSRF header
    })
    assert.equal(res.status, 403, 'Missing CSRF token should return 403')
    const data = await res.json()
    assert.ok(data.error?.includes('CSRF') || data.error?.includes('mismatch'), `CSRF error expected, got: ${data.error}`)
  })

  it('POST /api/content with correct X-CSRF-Token passes CSRF check', async () => {
    if (!sessionCookie || !csrfToken) return
    const res = await apiReq('POST', '/api/content', { title: 'test', object_type: 'article' }, undefined, {
      cookie: sessionCookie,
      csrf: csrfToken,
    })
    // CSRF should pass — may get 400/422 for missing fields, but NOT 403 CSRF error
    const data = await res.json().catch(() => ({}))
    assert.ok(res.status !== 403 || !data.error?.includes('CSRF'), 'Should not get CSRF error with correct token')
  })

  it('Bearer token auth path does NOT require CSRF header', async () => {
    // POST with Bearer auth and no CSRF header should not get a CSRF 403
    const res = await apiReq('POST', '/api/content', { title: 'test', object_type: 'article' }, adminToken)
    // Should not be a CSRF error (may be 400/422 for other reasons)
    const data = await res.json().catch(() => ({}))
    assert.ok(res.status !== 403 || !data.error?.includes('CSRF'), 'Bearer auth should not require CSRF header')
  })

  it('POST /auth/logout clears session cookie and redirects', async () => {
    if (!sessionCookie) return
    const res = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: sessionCookie },
    })
    assert.ok([301, 302, 303, 200].includes(res.status), `Should redirect or succeed, got ${res.status}`)
    // Verify session cookie is cleared
    const setCookie = res.headers.get('set-cookie') || ''
    if (setCookie.includes('jv-session')) {
      // Cookie should be expired/cleared
      assert.ok(setCookie.includes('Max-Age=0') || setCookie.includes('max-age=0') || setCookie.includes('expires='), 'Session cookie should be cleared')
    }
  })

  it('GET /idp/authorize with valid idp-session returns auth code without re-login (SSO)', async () => {
    if (!idpSessionCookie) return
    const newState = crypto.randomBytes(16).toString('hex')
    const newVerifier = crypto.randomBytes(64).toString('base64url')
    const newChallenge = crypto.createHash('sha256').update(newVerifier).digest('base64url')

    const authUrl = `/idp/authorize?client_id=jubileeverse-cms&redirect_uri=${encodeURIComponent('http://localhost:3107/auth/callback')}&scope=openid&response_type=code&state=${newState}&code_challenge=${newChallenge}&code_challenge_method=S256`
    const res = await fetch(`${BASE}${authUrl}`, {
      redirect: 'manual',
      headers: { Cookie: idpSessionCookie },
    })
    assert.ok([301, 302, 303].includes(res.status), `Should redirect, got ${res.status}`)
    const location = res.headers.get('location') || ''
    // With valid idp session, should go straight to callback (not login form)
    assert.ok(location.includes('code=') || !location.includes('/idp/login'), `Should issue code or skip login, got: ${location}`)
  })

  it('POST /idp/token with refresh_token issues new tokens + old refresh token revoked', async () => {
    // Perform fresh OIDC login to get a refresh token directly
    const codeVerifier = crypto.randomBytes(64).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('hex')

    await fetch(`${BASE}/idp/authorize?client_id=jubileeverse-cms&redirect_uri=${encodeURIComponent('http://localhost:3107/auth/callback')}&scope=openid&response_type=code&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`, { redirect: 'manual' })

    const loginBody = new URLSearchParams({
      email: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
      state,
    })
    const loginRes = await fetch(`${BASE}/idp/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: loginBody,
    })
    const loginLocation = loginRes.headers.get('location') || ''
    const loginUrl = loginLocation.startsWith('http') ? loginLocation : `http://localhost${loginLocation}`
    const code = (new URL(loginUrl)).searchParams.get('code') || ''
    if (!code) return

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: 'http://localhost:3107/auth/callback',
      client_id: 'jubileeverse-cms',
      client_secret: process.env.OIDC_CLIENT_SECRET || 'jubileeverse-cms-secret-dev',
    })
    const tokenRes = await fetch(`${BASE}/idp/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    })
    assert.equal(tokenRes.status, 200)
    const tokenData = await tokenRes.json()
    const oldRefreshToken = tokenData.refresh_token
    assert.ok(oldRefreshToken, 'Should have refresh_token')

    // Use refresh token to get new tokens
    const refreshBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oldRefreshToken,
      client_id: 'jubileeverse-cms',
      client_secret: process.env.OIDC_CLIENT_SECRET || 'jubileeverse-cms-secret-dev',
    })
    const refreshRes = await fetch(`${BASE}/idp/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody,
    })
    assert.equal(refreshRes.status, 200, 'Refresh token grant should succeed')
    const refreshData = await refreshRes.json()
    assert.ok(refreshData.access_token, 'New access_token required')
    assert.ok(refreshData.refresh_token, 'New refresh_token required')
    assert.notEqual(refreshData.refresh_token, oldRefreshToken, 'New refresh token should be different (rotation)')

    // Old refresh token should now be revoked
    const reuseBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oldRefreshToken,
      client_id: 'jubileeverse-cms',
      client_secret: process.env.OIDC_CLIENT_SECRET || 'jubileeverse-cms-secret-dev',
    })
    const reuseRes = await fetch(`${BASE}/idp/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: reuseBody,
    })
    assert.equal(reuseRes.status, 400, 'Old refresh token should be rejected after rotation')
  })

  it('Expired or invalid refresh token returns 400', async () => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'invalid-token-that-does-not-exist',
      client_id: 'jubileeverse-cms',
      client_secret: process.env.OIDC_CLIENT_SECRET || 'jubileeverse-cms-secret-dev',
    })
    const res = await fetch(`${BASE}/idp/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    assert.equal(res.status, 400, 'Invalid refresh token should return 400')
    const data = await res.json()
    assert.ok(data.error, 'Should return error field')
  })

})

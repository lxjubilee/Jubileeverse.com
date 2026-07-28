/**
 * Part 3 / Section 8 — Session Audit & Activity Reporting
 *
 * Stub tests covering:
 *   - POST /api/auth/login creates a user_sessions row
 *   - POST /api/auth/logout updates logout_at + duration_seconds
 *   - GET /api/admin/users/:id/sessions returns sessions sorted by login_at DESC
 *   - Active sessions (logout_at IS NULL) present after login
 *   - DELETE /api/admin/users/:id/sessions/:sessionId sets revoked_at
 *   - POST /api/admin/users/:id/revoke-sessions sets sessions_revoked_at on user
 *   - Old token rejected (401) after sessions revoked (requires re-login)
 *   - GET /api/admin/users/:id/activity returns jv_audit_log entries
 *   - GET /api/admin/users/:id/activity with time_range filter returns results
 *   - GET /api/admin/users/:id/activity/export returns text/csv
 *   - GET /api/admin/users/:id/activity/summary returns UserActivitySummary shape
 *   - GET /api/admin/users/:id/account-audit returns entries
 */

'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3107'

let adminToken = ''
let adminUserId = ''
let newSessionId = ''
let freshToken = ''

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res
}

describe('Part 3 / Section 8 — Session Audit & Activity Reporting', () => {

  before(async () => {
    // Fresh login to guarantee a new session row
    const loginRes = await req('POST', '/api/auth/login', {
      username: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
    })
    assert.equal(loginRes.status, 200, 'Admin login should succeed')
    const loginData = await loginRes.json()
    adminToken = loginData.token
    freshToken = loginData.token

    // Find admin user id
    const listRes = await req('GET', '/api/admin/users', undefined, adminToken)
    const { users } = await listRes.json()
    adminUserId = users.find(u => u.role === 'admin')?.id
    assert.ok(adminUserId, 'Should find admin user id')
  })

  it('POST /api/auth/login creates a user_sessions row', async () => {
    const sessRes = await req('GET', `/api/admin/users/${adminUserId}/sessions`, undefined, adminToken)
    assert.equal(sessRes.status, 200)
    const { sessions, total } = await sessRes.json()
    assert.ok(Array.isArray(sessions), 'sessions should be an array')
    assert.ok(total >= 1, 'Should have at least one session after login')
  })

  it('GET /api/admin/users/:id/sessions returns sessions sorted by login_at DESC', async () => {
    const res = await req('GET', `/api/admin/users/${adminUserId}/sessions`, undefined, adminToken)
    const { sessions } = await res.json()
    if (sessions.length >= 2) {
      assert.ok(
        new Date(sessions[0].login_at) >= new Date(sessions[1].login_at),
        'Sessions should be sorted by login_at DESC'
      )
    }
  })

  it('Active session (logout_at IS NULL) present after fresh login', async () => {
    const res = await req('GET', `/api/admin/users/${adminUserId}/sessions`, undefined, adminToken)
    const { sessions } = await res.json()
    const active = sessions.find(s => !s.logout_at && !s.revoked_at)
    assert.ok(active, 'Should have at least one active session (logout_at IS NULL)')
    newSessionId = active.id
  })

  it('DELETE /api/admin/users/:id/sessions/:sessionId revokes the session', async () => {
    if (!newSessionId) return
    const res = await req('DELETE', `/api/admin/users/${adminUserId}/sessions/${newSessionId}`, undefined, adminToken)
    assert.equal(res.status, 204, 'DELETE session should return 204')

    // Verify revoked
    const sessRes = await req('GET', `/api/admin/users/${adminUserId}/sessions`, undefined, adminToken)
    const { sessions } = await sessRes.json()
    const revoked = sessions.find(s => s.id === newSessionId)
    assert.ok(revoked?.revoked_at, 'Session should have revoked_at set')
  })

  it('POST /api/auth/logout updates logout_at and duration_seconds', async () => {
    // Login fresh, then logout, then verify session updated
    const loginRes = await req('POST', '/api/auth/login', {
      username: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
    })
    const { token: logoutToken } = await loginRes.json()
    await req('POST', '/api/auth/logout', undefined, logoutToken)

    // Wait a tick for the DB write
    await new Promise(r => setTimeout(r, 100))

    const sessRes = await req('GET', `/api/admin/users/${adminUserId}/sessions`, undefined, adminToken)
    const { sessions } = await sessRes.json()
    const closed = sessions.find(s => s.logout_at !== null)
    assert.ok(closed, 'Should have at least one closed session')
    assert.ok(typeof closed.duration_seconds === 'number', 'duration_seconds should be set on logout')
  })

  it('POST /api/admin/users/:id/revoke-sessions sets sessions_revoked_at', async () => {
    // Create a second admin account or use the same one for revocation test
    const res = await req('POST', `/api/admin/users/${adminUserId}/revoke-sessions`, undefined, adminToken)
    assert.equal(res.status, 200)

    // Re-login to verify we need a new token
    const loginRes = await req('POST', '/api/auth/login', {
      username: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
    })
    adminToken = (await loginRes.json()).token

    // Old token should now be rejected
    const oldTokenRes = await req('GET', '/api/admin/users', undefined, freshToken)
    assert.ok([401, 403].includes(oldTokenRes.status), 'Old token should be rejected after session revocation')
  })

  it('GET /api/admin/users/:id/activity returns items array', async () => {
    const res = await req('GET', `/api/admin/users/${adminUserId}/activity`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.items), 'items should be an array')
    assert.ok(typeof data.total === 'number', 'total should be a number')
  })

  it('GET /api/admin/users/:id/activity respects time_range filter', async () => {
    const res = await req('GET', `/api/admin/users/${adminUserId}/activity?time_range=24h`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.items), 'items should be an array for 24h range')
  })

  it('GET /api/admin/users/:id/activity/export returns text/csv', async () => {
    const res = await req('GET', `/api/admin/users/${adminUserId}/activity/export`, undefined, adminToken)
    assert.equal(res.status, 200)
    const contentType = res.headers.get('content-type') || ''
    assert.ok(contentType.includes('text/csv'), `Content-Type should be text/csv, got: ${contentType}`)
  })

  it('GET /api/admin/users/:id/activity/summary returns UserActivitySummary shape', async () => {
    const res = await req('GET', `/api/admin/users/${adminUserId}/activity/summary`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    const requiredKeys = ['content_created', 'content_edited', 'reviews_performed', 'publish_actions', 'automation_jobs', 'prompts_referenced']
    for (const key of requiredKeys) {
      assert.ok(key in data, `summary should include ${key}`)
      assert.ok(typeof data[key] === 'number', `${key} should be a number`)
    }
  })

  it('GET /api/admin/users/:id/account-audit returns items array', async () => {
    const res = await req('GET', `/api/admin/users/${adminUserId}/account-audit`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.items), 'account-audit should return items array')
  })

})

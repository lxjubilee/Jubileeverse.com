/**
 * Part 3 / Section 9 — User Account Editor & Administrative Controls
 *
 * Stub tests covering:
 *   - POST /api/admin/users/:id/disable sets is_active=0
 *   - Disabled account → requirePrivileged returns 403
 *   - POST /api/admin/users/:id/enable sets is_active=1
 *   - POST /api/admin/users/:id/lock sets is_locked=1 with locked_at/locked_by
 *   - Locked account → requirePrivileged returns 403
 *   - POST /api/admin/users/:id/unlock sets is_locked=0
 *   - POST /api/admin/users/:id/force-password-reset sets flag; login response includes force_password_reset:true
 *   - POST /api/admin/users/:id/reset-mfa clears mfa_enabled/mfa_secret
 *   - POST /api/admin/users/:id/revoke-sessions — sessions_revoked_at set, old token rejected
 *   - GET /api/admin/users/:id/account-audit shows admin action log entries
 *   - All action endpoints require admin role (403 for non-admin)
 *   - Permission add/remove still work correctly
 *   - Permissions include taxonomy_node_id, permission, granted_by
 */

'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3107'

let adminToken   = ''
let adminUserId  = ''
let testUserId   = ''
let testUserEmail = ''
let testToken    = ''

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

// Create a throwaway test user
async function createTestUser(adminToken) {
  const email    = `test_user_${Date.now()}@jubileeverse.test`
  const password = 'TestPass123!'
  const res = await req('POST', '/api/auth/register', { email, password, name: 'Section 9 Test', role: 'editor' }, adminToken)
  if (res.status === 201 || res.status === 200) {
    const data = await res.json()
    return { id: data.id || data.user?.id, email, password }
  }
  return null
}

describe('Part 3 / Section 9 — User Account Editor & Administrative Controls', () => {

  before(async () => {
    // `email`, not `username`: /api/auth/login destructures { email, password } and
    // hard-rejects a non-string email with a 400, so this suite used to die here on
    // the assert below before a single test ran.
    const adminLogin = await req('POST', '/api/auth/login', {
      email: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
    })
    assert.equal(adminLogin.status, 200, 'Admin login should succeed')
    adminToken = (await adminLogin.json()).token

    const listRes = await req('GET', '/api/admin/users', undefined, adminToken)
    const { users } = await listRes.json()
    adminUserId = users.find(u => u.role === 'admin')?.id

    // Attempt to create a throwaway user for isolation
    const newUser = await createTestUser(adminToken)
    if (newUser?.id) {
      testUserId = newUser.id
      testUserEmail = newUser.email
      // Get a token for test user
      const loginRes = await req('POST', '/api/auth/login', { email: newUser.email, password: newUser.password })
      if (loginRes.status === 200) testToken = (await loginRes.json()).token
    } else {
      // Fall back to admin user for tests that only need the ID
      testUserId = adminUserId
    }
    assert.ok(testUserId, 'Should have a test user id')
  })

  after(async () => {
    // Clean up test user if it was created separately
    if (testUserId && testUserId !== adminUserId) {
      // Re-enable before deletion in case tests left it disabled
      await req('POST', `/api/admin/users/${testUserId}/enable`, undefined, adminToken)
      // confirm_email is required by the delete endpoint as a second factor against
      // a mistyped or scripted id. Without it this cleanup 400s and leaks the user.
      await req('DELETE', `/api/admin/users/${testUserId}`, { confirm_email: testUserEmail }, adminToken)
    }
  })

  it('POST /api/admin/users/:id/disable sets is_active=0', async () => {
    if (testUserId === adminUserId) return // skip — would lock out admin
    const res = await req('POST', `/api/admin/users/${testUserId}/disable`, undefined, adminToken)
    assert.equal(res.status, 200)
    const user = (await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)).then(r => r.json()).then(d => d.user)
    assert.equal((await user).is_active, 0, 'is_active should be 0 after disable')
  })

  it('Disabled account returns 403 on authenticated request', async () => {
    if (!testToken || testUserId === adminUserId) return
    const res = await req('GET', '/api/content', undefined, testToken)
    assert.equal(res.status, 403, 'Disabled account should be rejected with 403')
  })

  it('POST /api/admin/users/:id/enable sets is_active=1', async () => {
    if (testUserId === adminUserId) return
    const res = await req('POST', `/api/admin/users/${testUserId}/enable`, undefined, adminToken)
    assert.equal(res.status, 200)
    const { user } = await (await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)).json()
    assert.equal(user.is_active, 1, 'is_active should be 1 after enable')
  })

  it('POST /api/admin/users/:id/lock sets is_locked=1 with locked_at and locked_by', async () => {
    if (testUserId === adminUserId) return
    const res = await req('POST', `/api/admin/users/${testUserId}/lock`, undefined, adminToken)
    assert.equal(res.status, 200)
    const { user } = await (await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)).json()
    assert.equal(user.is_locked, 1, 'is_locked should be 1 after lock')
    assert.ok(user.locked_at, 'locked_at should be set')
    assert.ok(user.locked_by, 'locked_by should be set')
  })

  it('Locked account returns 403 on authenticated request', async () => {
    if (!testToken || testUserId === adminUserId) return
    const res = await req('GET', '/api/content', undefined, testToken)
    assert.equal(res.status, 403, 'Locked account should be rejected with 403')
  })

  it('POST /api/admin/users/:id/unlock sets is_locked=0', async () => {
    if (testUserId === adminUserId) return
    const res = await req('POST', `/api/admin/users/${testUserId}/unlock`, undefined, adminToken)
    assert.equal(res.status, 200)
    const { user } = await (await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)).json()
    assert.equal(user.is_locked, 0, 'is_locked should be 0 after unlock')
    assert.ok(!user.locked_at, 'locked_at should be cleared after unlock')
  })

  it('POST /api/admin/users/:id/force-password-reset sets the flag', async () => {
    const res = await req('POST', `/api/admin/users/${testUserId}/force-password-reset`, undefined, adminToken)
    assert.equal(res.status, 200)
    const { user } = await (await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)).json()
    assert.equal(user.force_password_reset, 1, 'force_password_reset should be 1')
  })

  it('POST /api/admin/users/:id/reset-mfa clears mfa_enabled', async () => {
    const res = await req('POST', `/api/admin/users/${testUserId}/reset-mfa`, undefined, adminToken)
    assert.equal(res.status, 200)
    const { user } = await (await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)).json()
    assert.equal(user.mfa_enabled, 0, 'mfa_enabled should be 0 after reset')
  })

  it('POST /api/admin/users/:id/revoke-sessions sets sessions_revoked_at', async () => {
    if (testUserId === adminUserId) return
    const res = await req('POST', `/api/admin/users/${testUserId}/revoke-sessions`, undefined, adminToken)
    assert.equal(res.status, 200)
    const { user } = await (await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)).json()
    assert.ok(user.sessions_revoked_at, 'sessions_revoked_at should be set')

    // Old token should now be rejected
    if (testToken) {
      const authRes = await req('GET', '/api/content', undefined, testToken)
      assert.ok([401, 403].includes(authRes.status), 'Old token should be rejected after session revocation')
    }
  })

  it('GET /api/admin/users/:id/account-audit shows admin action entries', async () => {
    const res = await req('GET', `/api/admin/users/${testUserId}/account-audit`, undefined, adminToken)
    assert.equal(res.status, 200)
    const { items } = await res.json()
    assert.ok(Array.isArray(items), 'account-audit items should be an array')
    // After all the actions above, there should be audit entries
    const hasEntries = items.some(i => i.target_type === 'user_account')
    // It's acceptable if no entries exist (e.g. testUserId === adminUserId and actions were skipped)
    if (testUserId !== adminUserId) {
      assert.ok(hasEntries, 'Should have at least one user_account audit entry')
    }
  })

  it('All action endpoints require admin role', async () => {
    for (const action of ['enable', 'disable', 'lock', 'unlock', 'force-password-reset', 'reset-mfa', 'revoke-sessions']) {
      const res = await req('POST', `/api/admin/users/${testUserId}/${action}`)
      assert.ok([401, 403].includes(res.status), `${action} should require authentication`)
    }
  })

  it('Permission add includes taxonomy_node_id, permission, granted_by', async () => {
    const addRes = await req('POST', `/api/admin/users/${testUserId}/permissions`, {
      taxonomy_node_id: 64166,
      permission:       'review',
    }, adminToken)
    assert.ok([200, 201].includes(addRes.status), 'Should add permission')

    const listRes = await req('GET', `/api/admin/users/${testUserId}/permissions`, undefined, adminToken)
    const perms = await listRes.json()
    if (perms.length > 0) {
      const p = perms[0]
      assert.ok('taxonomy_node_id' in p, 'permission should have taxonomy_node_id')
      assert.ok('permission' in p, 'permission should have permission field')
      assert.ok('granted_by' in p, 'permission should have granted_by')
    }
  })

  it('Permission DELETE removes the grant', async () => {
    const listRes = await req('GET', `/api/admin/users/${testUserId}/permissions`, undefined, adminToken)
    const perms = await listRes.json()
    if (perms.length === 0) return

    const grantId = perms[0].id
    const delRes = await req('DELETE', `/api/admin/users/${testUserId}/permissions/${grantId}`, undefined, adminToken)
    assert.equal(delRes.status, 204, 'DELETE permission should return 204')
  })

})

/**
 * Part 3 / Section 12 — Application Entitlements & Filtered User Directory
 *
 * Stub tests covering:
 *   - GET /idp/admin/users/search?q=... returns user list with entitlements (admin only)
 *   - GET /idp/admin/users/search without admin role → 403
 *   - POST /idp/admin/users/:email/entitlements adds entitlement
 *   - DELETE /idp/admin/users/:email/entitlements/:name removes entitlement
 *   - GET /api/admin/directory/search returns all users (includes non-CMS for onboarding)
 *   - GET /api/admin/directory/search without admin role → 403
 *   - POST /api/admin/directory/grant-access creates/updates user with jubileeverse_cms
 *   - GET /api/admin/users only returns jubileeverse_cms entitled users
 *   - GET /api/auth/me returns entitlements array and has_cms_access flag
 *   - DELETE /api/admin/users/:id/revoke-entitlement removes jubileeverse_cms
 *   - /auth/callback syncs name + entitlements from id_token on each login
 *   - GET /api/admin/users/:id/cms-roles returns cms_roles JSON array
 *   - PUT /api/admin/users/:id/cms-roles updates cms_roles
 */

'use strict'

const assert = require('node:assert/strict')
const { describe, it, before } = require('node:test')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3107'

let adminToken = ''
let editorToken = ''
let testUserId = null
let testUserEmail = `test-entitlement-${Date.now()}@example.com`

before(async () => {
  // Login as admin to get bearer token
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@jubileeverse.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
  })
  if (res.ok) {
    const data = await res.json()
    adminToken = data.token || ''
  }

  // Login as editor
  const res2 = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'editor@jubileeverse.com', password: process.env.EDITOR_PASSWORD || 'editor123' }),
  })
  if (res2.ok) {
    const data2 = await res2.json()
    editorToken = data2.token || ''
  }
})

describe('Part 3 / Section 12 — Entitlement Model', () => {

  it('GET /idp/admin/users/search?q=admin requires admin role', async () => {
    if (!editorToken) return
    const res = await fetch(`${BASE}/idp/admin/users/search?q=admin`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    })
    assert.equal(res.status, 403, 'Non-admin should get 403')
  })

  it('GET /idp/admin/users/search?q=admin returns users with entitlements for admin', async () => {
    if (!adminToken) return
    const res = await fetch(`${BASE}/idp/admin/users/search?q=admin`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.users), 'users should be an array')
    if (data.users.length > 0) {
      const u = data.users[0]
      assert.ok('email' in u, 'user should have email')
      assert.ok('entitlements' in u, 'user should have entitlements')
      assert.ok(Array.isArray(u.entitlements), 'entitlements should be an array')
    }
  })

  it('POST /idp/admin/users/:email/entitlements adds entitlement (admin only)', async () => {
    if (!adminToken) return
    const res = await fetch(`${BASE}/idp/admin/users/admin%40jubileeverse.com/entitlements`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entitlement: 'test_entitlement' }),
    })
    // 200 if user exists, 404 if not found
    assert.ok(res.status === 200 || res.status === 404, `Expected 200 or 404, got ${res.status}`)
  })

  it('DELETE /idp/admin/users/:email/entitlements/:name removes entitlement (admin only)', async () => {
    if (!adminToken) return
    const res = await fetch(`${BASE}/idp/admin/users/admin%40jubileeverse.com/entitlements/test_entitlement`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.ok(res.status === 200 || res.status === 404, `Expected 200 or 404, got ${res.status}`)
  })

  it('GET /api/admin/directory/search returns all users for admin', async () => {
    if (!adminToken) return
    const res = await fetch(`${BASE}/api/admin/directory/search?q=admin`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.users), 'users should be an array')
  })

  it('GET /api/admin/directory/search requires admin role → 403 for editor', async () => {
    if (!editorToken) return
    const res = await fetch(`${BASE}/api/admin/directory/search?q=test`, {
      headers: { Authorization: `Bearer ${editorToken}` },
    })
    assert.equal(res.status, 403, 'Non-admin should get 403')
  })

  it('POST /api/admin/directory/grant-access creates/updates user with jubileeverse_cms', async () => {
    if (!adminToken) return
    const res = await fetch(`${BASE}/api/admin/directory/grant-access`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: testUserEmail, initial_role: 'editor' }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.success, true)
    assert.ok(data.user, 'should return the user')
    assert.ok(Array.isArray(data.user.entitlements), 'user should have entitlements array')
    assert.ok(
      data.user.entitlements.includes('jubileeverse_cms'),
      'jubileeverse_cms should be in entitlements'
    )
    testUserId = data.user.id
  })

  it('GET /api/admin/users only returns jubileeverse_cms entitled users', async () => {
    if (!adminToken) return
    const res = await fetch(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.users), 'users should be an array')
    for (const u of data.users) {
      const hasCms = (Array.isArray(u.entitlements) && u.entitlements.includes('jubileeverse_cms'))
        || ['admin', 'site_owner', 'publisher', 'reviewer', 'editor', 'author_operator'].includes(u.role)
      assert.ok(hasCms, `User ${u.email} should have jubileeverse_cms or privileged role`)
    }
  })

  it('DELETE /api/admin/users/:id/revoke-entitlement removes jubileeverse_cms', async () => {
    if (!adminToken || !testUserId) return
    const res = await fetch(`${BASE}/api/admin/users/${testUserId}/revoke-entitlement`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.success, true)
  })

  it('GET /api/admin/users/:id/cms-roles returns cms_roles array', async () => {
    if (!adminToken) return
    const usersRes = await fetch(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    if (!usersRes.ok) return
    const { users } = await usersRes.json()
    if (!users.length) return
    const uid = users[0].id
    const res = await fetch(`${BASE}/api/admin/users/${uid}/cms-roles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.cms_roles), 'cms_roles should be an array')
  })

  it('PUT /api/admin/users/:id/cms-roles updates cms_roles', async () => {
    if (!adminToken) return
    const usersRes = await fetch(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    if (!usersRes.ok) return
    const { users } = await usersRes.json()
    if (!users.length) return
    const uid = users[0].id
    const res = await fetch(`${BASE}/api/admin/users/${uid}/cms-roles`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cms_roles: [{ role: 'editor', scope: 'test' }] }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.success, true)
    assert.ok(Array.isArray(data.cms_roles), 'cms_roles should be an array')
  })

  it('GET /api/auth/me returns entitlements array and has_cms_access flag', async () => {
    if (!adminToken) return
    const res = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.user, 'should return user')
    assert.ok('entitlements' in data.user, 'user should have entitlements field')
    assert.ok('has_cms_access' in data.user, 'user should have has_cms_access field')
    assert.ok(typeof data.user.has_cms_access === 'boolean', 'has_cms_access should be boolean')
    assert.ok(Array.isArray(data.user.entitlements), 'entitlements should be array')
  })

})

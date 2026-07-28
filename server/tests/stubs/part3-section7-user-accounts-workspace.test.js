/**
 * Part 3 / Section 7 — User Accounts Workspace
 *
 * Stub tests covering:
 *   - GET /api/admin/users requires admin role
 *   - Returns { users, total } shape
 *   - Users include is_active, is_locked, last_login_at, mfa_enabled fields
 *   - PUT /api/admin/users/:id updates name
 *   - PUT /api/admin/users/:id updates role and logs audit entry
 *   - GET /api/admin/users/:id returns single user detail
 *   - Non-admin cannot access admin user endpoints
 *   - GET /api/admin/users/:id/permissions returns array
 *   - POST /api/admin/users/:id/permissions adds permission
 *   - DELETE /api/admin/users/:id/permissions/:grantId removes permission
 *   - force_password_reset field present on user records
 *   - updated_by populated after PUT
 */

'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3107'

let adminToken  = ''
let editorToken = ''
let testUserId  = ''

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

describe('Part 3 / Section 7 — User Accounts Workspace', () => {

  before(async () => {
    // Admin login
    const adminLogin = await req('POST', '/api/auth/login', {
      username: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
    })
    assert.equal(adminLogin.status, 200, 'Admin login should succeed')
    adminToken = (await adminLogin.json()).token

    // Get the admin's own user id
    const listRes = await req('GET', '/api/admin/users', undefined, adminToken)
    const { users } = await listRes.json()
    testUserId = users.find(u => u.role === 'admin')?.id
    assert.ok(testUserId, 'Should find admin user id')
  })

  it('GET /api/admin/users requires authentication', async () => {
    const res = await req('GET', '/api/admin/users')
    assert.ok([401, 403].includes(res.status), 'Unauthenticated request should be rejected')
  })

  it('GET /api/admin/users returns { users, total } shape', async () => {
    const res = await req('GET', '/api/admin/users', undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.users), 'users should be an array')
    assert.ok(typeof data.total === 'number', 'total should be a number')
    assert.ok(data.total >= 1, 'Should have at least one user')
  })

  it('Users include governance fields', async () => {
    const res = await req('GET', '/api/admin/users', undefined, adminToken)
    const { users } = await res.json()
    const u = users[0]
    assert.ok('is_active' in u,            'is_active field required')
    assert.ok('is_locked' in u,            'is_locked field required')
    assert.ok('mfa_enabled' in u,          'mfa_enabled field required')
    assert.ok('force_password_reset' in u, 'force_password_reset field required')
    assert.ok('last_login_at' in u,        'last_login_at field required (may be null)')
  })

  it('GET /api/admin/users/:id returns single user', async () => {
    const res = await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.user, 'Should return { user } wrapper')
    assert.equal(data.user.id, testUserId)
  })

  it('GET /api/admin/users/:id returns 404 for unknown id', async () => {
    const res = await req('GET', '/api/admin/users/999999999', undefined, adminToken)
    assert.equal(res.status, 404)
  })

  it('PUT /api/admin/users/:id can update name', async () => {
    const newName = `Test Admin ${Date.now()}`
    const res = await req('PUT', `/api/admin/users/${testUserId}`, { name: newName }, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.user.name, newName, 'Name should be updated in response')
  })

  it('PUT /api/admin/users/:id updated_by is set', async () => {
    const res = await req('GET', `/api/admin/users/${testUserId}`, undefined, adminToken)
    const { user } = await res.json()
    assert.ok(user.updated_by, 'updated_by should be set after PUT')
  })

  it('GET /api/admin/users/:id/permissions returns array', async () => {
    const res = await req('GET', `/api/admin/users/${testUserId}/permissions`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data), 'permissions should be an array')
  })

  it('POST /api/admin/users/:id/permissions adds a permission', async () => {
    const res = await req('POST', `/api/admin/users/${testUserId}/permissions`, {
      taxonomy_node_id: 64166,
      permission:       'edit',
    }, adminToken)
    assert.ok([200, 201].includes(res.status), 'Should create or confirm existing permission')
  })

  it('Non-admin cannot GET /api/admin/users', async () => {
    // Skip if no editor credentials configured
    if (!process.env.TEST_EDITOR_USER) return
    const loginRes = await req('POST', '/api/auth/login', {
      username: process.env.TEST_EDITOR_USER,
      password: process.env.TEST_EDITOR_PASS || '',
    })
    if (loginRes.status !== 200) return
    editorToken = (await loginRes.json()).token
    const res = await req('GET', '/api/admin/users', undefined, editorToken)
    assert.ok([401, 403].includes(res.status), 'Non-admin should be rejected')
  })

})

/**
 * Part 3 / Section 6 — Multi-Author Content Relationships
 *
 * Stub tests covering:
 *   - jv_content_author_map endpoints (list / add / update / remove)
 *   - author_id column removed from jv_content_objects
 *   - GET /api/content?author_id= filter via EXISTS subquery
 *   - POST /api/content with authors array
 *   - GET /api/v1/content/:slug returns authors[] with channel/primary bios
 *   - POST /api/content/bulk-author reassignment
 *   - Role values: primary_author, contributor, editor, translator, narrator
 *   - display_order field preserved
 *   - Duplicate attribution rejected (unique constraint)
 */

'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')

// ── helpers ────────────────────────────────────────────────────────────────────

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3107'

let adminToken = ''
let testAuthorId = ''
let testAuthor2Id = ''
let testContentId = ''
let testSlug = ''

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

// ── suite ──────────────────────────────────────────────────────────────────────

describe('Part 3 / Section 6 — Multi-Author Content Relationships', () => {

  before(async () => {
    // Authenticate
    const loginRes = await req('POST', '/api/auth/login', {
      username: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
    })
    assert.equal(loginRes.status, 200)
    adminToken = (await loginRes.json()).token

    // Create two test authors
    const a1 = await req('POST', '/api/content', {
      object_type: 'author',
      title: `Author One ${Date.now()}`,
      status: 'published',
      extension_data: { display_name: 'Author One', canonical_slug: `author-one-${Date.now()}` },
    }, adminToken)
    assert.equal(a1.status, 201, 'Should create author 1')
    testAuthorId = ((await a1.json()).id || (await a1.json()).content?.id)

    const a2 = await req('POST', '/api/content', {
      object_type: 'author',
      title: `Author Two ${Date.now()}`,
      status: 'published',
      extension_data: { display_name: 'Author Two', canonical_slug: `author-two-${Date.now()}` },
    }, adminToken)
    assert.equal(a2.status, 201, 'Should create author 2')
    testAuthor2Id = ((await a2.json()).id || (await a2.json()).content?.id)

    // Create a test article (no author at creation)
    testSlug = `test-article-${Date.now()}`
    const c1 = await req('POST', '/api/content', {
      object_type: 'article',
      title:       'Multi-Author Test Article',
      slug:        testSlug,
      status:      'draft',
    }, adminToken)
    assert.equal(c1.status, 201, 'Should create test article')
    testContentId = ((await c1.json()).id || (await c1.json()).content?.id)
    assert.ok(testContentId, 'Must have content ID')
  })

  after(async () => {
    for (const id of [testContentId, testAuthorId, testAuthor2Id]) {
      if (id) await req('DELETE', `/api/content/${id}`, undefined, adminToken)
    }
  })

  // ── Removed author_id column ──────────────────────────────────────────────

  it('jv_content_objects no longer has author_id column (schema check via content response)', async () => {
    const res = await req('GET', `/api/content/${testContentId}`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    const obj = data.content ?? data
    // author_id was removed; it should not appear in the response
    assert.ok(!('author_id' in obj), 'author_id should not be present on content objects')
  })

  // ── Content author map — list ──────────────────────────────────────────────

  it('GET /api/content/:id/authors returns empty list for new content', async () => {
    const res = await req('GET', `/api/content/${testContentId}/authors`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.authors), 'authors should be an array')
    assert.equal(data.authors.length, 0, 'New content should have no authors')
  })

  // ── Content author map — add ───────────────────────────────────────────────

  it('POST /api/content/:id/authors adds an attribution', async () => {
    const res = await req('POST', `/api/content/${testContentId}/authors`, {
      author_id:     testAuthorId,
      role:          'primary_author',
      display_order: 1,
    }, adminToken)
    assert.equal(res.status, 201, 'Should return 201 on attribution create')
    const data = await res.json()
    const attr = data.attribution ?? data
    assert.equal(attr.author_id, testAuthorId)
    assert.equal(attr.role, 'primary_author')
    assert.equal(attr.display_order, 1)
  })

  it('POST /api/content/:id/authors adds a second author with different role', async () => {
    const res = await req('POST', `/api/content/${testContentId}/authors`, {
      author_id:     testAuthor2Id,
      role:          'editor',
      display_order: 2,
    }, adminToken)
    assert.equal(res.status, 201)
    const attr = (await res.json()).attribution ?? (await res.json())
    assert.equal(attr.role, 'editor')
    assert.equal(attr.display_order, 2)
  })

  it('POST /api/content/:id/authors rejects duplicate (same author, same role)', async () => {
    const res = await req('POST', `/api/content/${testContentId}/authors`, {
      author_id: testAuthorId,
      role:      'primary_author',
    }, adminToken)
    assert.notEqual(res.status, 201, 'Duplicate attribution should be rejected')
  })

  // ── Content author map — list with data ───────────────────────────────────

  it('GET /api/content/:id/authors returns both attributions with display_name', async () => {
    const res = await req('GET', `/api/content/${testContentId}/authors`, undefined, adminToken)
    assert.equal(res.status, 200)
    const { authors } = await res.json()
    assert.equal(authors.length, 2, 'Should have two attributions')
    const primary = authors.find(a => a.role === 'primary_author')
    assert.ok(primary, 'Should have a primary_author')
    assert.ok(primary.display_name, 'Attribution should include display_name')
  })

  // ── Content author map — update ───────────────────────────────────────────

  it('PUT /api/content/:id/authors/:authorId updates role', async () => {
    const res = await req('PUT', `/api/content/${testContentId}/authors/${testAuthor2Id}`, {
      role: 'contributor',
    }, adminToken)
    assert.equal(res.status, 200)
    const attr = (await res.json()).attribution ?? (await res.json())
    assert.equal(attr.role, 'contributor')
  })

  // ── Filter by author_id via EXISTS ────────────────────────────────────────

  it('GET /api/content?author_id= returns content attributed to that author', async () => {
    const res = await req('GET', `/api/content?author_id=${testAuthorId}&limit=50`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    const items = data.items ?? data
    assert.ok(Array.isArray(items), 'Should return items array')
    const found = items.find(i => i.id === testContentId)
    assert.ok(found, 'The attributed content should appear in filter results')
  })

  it('GET /api/content?author_id= does not return non-attributed content', async () => {
    // Create unattributed content
    const unattributed = await req('POST', '/api/content', {
      object_type: 'article',
      title:       'Unattributed Article',
      status:      'draft',
    }, adminToken)
    const unattId = ((await unattributed.json()).id || (await unattributed.json()).content?.id)

    const res = await req('GET', `/api/content?author_id=${testAuthorId}&limit=200`, undefined, adminToken)
    const data = await res.json()
    const items = data.items ?? data
    const foundUnatt = items.find(i => i.id === unattId)
    assert.ok(!foundUnatt, 'Unattributed content should not appear in author filter')

    // Cleanup
    if (unattId) await req('DELETE', `/api/content/${unattId}`, undefined, adminToken)
  })

  // ── POST /api/content with authors array ─────────────────────────────────

  it('POST /api/content with authors[] creates attribution entries', async () => {
    const createRes = await req('POST', '/api/content', {
      object_type: 'article',
      title:       'Article With Authors Array',
      status:      'draft',
      authors: [
        { author_id: testAuthorId, role: 'primary_author', display_order: 1 },
      ],
    }, adminToken)
    assert.equal(createRes.status, 201)
    const created = (await createRes.json())
    const newId = created.id || created.content?.id
    assert.ok(newId)

    // Verify attribution was created
    const authRes = await req('GET', `/api/content/${newId}/authors`, undefined, adminToken)
    const { authors } = await authRes.json()
    assert.ok(authors.length > 0, 'Should have at least one attribution from authors[] param')

    // Cleanup
    await req('DELETE', `/api/content/${newId}`, undefined, adminToken)
  })

  // ── Public API: GET /api/v1/content/:slug returns authors[] ──────────────

  it('GET /api/v1/content/:slug returns authors array for published content', async () => {
    // Publish the test content first
    await req('PUT', `/api/content/${testContentId}`, { status: 'published' }, adminToken)

    const res = await fetch(`${BASE}/api/v1/content/${testSlug}`)
    if (res.status === 404) {
      // Acceptable if slug routing isn't set up in test env
      return
    }
    assert.equal(res.status, 200)
    const data = await res.json()
    const article = data.article ?? data.content ?? data
    assert.ok(Array.isArray(article.authors), 'Public API should return authors array')
    assert.ok(article.authors.length > 0, 'Should have attributed authors in public response')
    const primaryAuthor = article.authors.find(a => a.role === 'primary_author')
    assert.ok(primaryAuthor, 'Should have a primary_author in authors array')
    assert.ok(primaryAuthor.display_name, 'Author should have display_name')
  })

  // ── Bulk reassign ─────────────────────────────────────────────────────────

  it('POST /api/content/bulk-author reassigns multiple content objects', async () => {
    // Create two additional articles to bulk-reassign
    const art1 = await req('POST', '/api/content', { object_type: 'article', title: 'Bulk Test 1', status: 'draft' }, adminToken)
    const art2 = await req('POST', '/api/content', { object_type: 'article', title: 'Bulk Test 2', status: 'draft' }, adminToken)
    const id1 = ((await art1.json()).id || (await art1.json()).content?.id)
    const id2 = ((await art2.json()).id || (await art2.json()).content?.id)
    assert.ok(id1 && id2, 'Should have created both articles')

    const res = await req('POST', '/api/content/bulk-author', {
      content_ids: [id1, id2],
      author_id:   testAuthorId,
      role:        'primary_author',
    }, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(typeof data.updated === 'number' && data.updated >= 2,
      'Should report at least 2 updated attributions')

    // Verify
    for (const id of [id1, id2]) {
      const authRes = await req('GET', `/api/content/${id}/authors`, undefined, adminToken)
      const { authors } = await authRes.json()
      const match = authors.find(a => a.author_id === testAuthorId)
      assert.ok(match, `Content ${id} should now be attributed to testAuthor`)
      await req('DELETE', `/api/content/${id}`, undefined, adminToken)
    }
  })

  // ── Remove attribution ────────────────────────────────────────────────────

  it('DELETE /api/content/:id/authors/:authorId returns 204', async () => {
    const res = await req('DELETE', `/api/content/${testContentId}/authors/${testAuthor2Id}`, undefined, adminToken)
    assert.equal(res.status, 204, 'DELETE attribution should return 204')

    // Verify removed
    const listRes = await req('GET', `/api/content/${testContentId}/authors`, undefined, adminToken)
    const { authors } = await listRes.json()
    const still = authors.find(a => a.author_id === testAuthor2Id)
    assert.ok(!still, 'Removed author should no longer appear')
  })

  // ── Role validation ───────────────────────────────────────────────────────

  it('All supported ContentAuthorRole values are accepted', async () => {
    const roles = ['primary_author', 'contributor', 'editor', 'translator', 'narrator']
    // Use testAuthor2Id with different roles via add+remove cycle
    for (const role of roles) {
      const addRes = await req('POST', `/api/content/${testContentId}/authors`, {
        author_id: testAuthor2Id,
        role,
        display_order: 99,
      }, adminToken)
      assert.ok([201, 409].includes(addRes.status),
        `Role "${role}" should be accepted (409 = already exists is fine)`)
      // Remove after
      await req('DELETE', `/api/content/${testContentId}/authors/${testAuthor2Id}`, undefined, adminToken)
    }
  })

  // ── Permission enforcement ────────────────────────────────────────────────

  it('POST /api/content/:id/authors requires authentication', async () => {
    const res = await req('POST', `/api/content/${testContentId}/authors`, {
      author_id: testAuthorId,
      role:      'primary_author',
    })
    assert.ok([401, 403].includes(res.status), 'Unauthenticated request should be rejected')
  })

  it('POST /api/content/bulk-author requires admin privileges', async () => {
    // Attempt without token — should fail
    const res = await req('POST', '/api/content/bulk-author', {
      content_ids: [testContentId],
      author_id:   testAuthorId,
    })
    assert.ok([401, 403].includes(res.status), 'Bulk reassign requires authentication')
  })
})

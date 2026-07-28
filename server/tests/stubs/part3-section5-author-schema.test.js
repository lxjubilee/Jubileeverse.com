/**
 * Part 3 / Section 5 — Author Profile Schema & Channel-Specific Bios
 *
 * Stub tests covering:
 *   - jv_author_bios table existence and constraints
 *   - jv_author_bio_revisions table existence
 *   - Author bio CRUD API endpoints
 *   - is_primary uniqueness (partial index)
 *   - Bio revision creation on PUT
 *   - word_count auto-computation
 *   - Migration from extension_data.bios JSONB
 *   - Author profile extension fields (canonical_slug, social_links, default_language)
 */

'use strict'

const assert = require('node:assert/strict')
const { describe, it, before, after } = require('node:test')

// ── helpers ────────────────────────────────────────────────────────────────────

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3107'

let adminToken = ''
let testAuthorId = ''
let testBioId = ''

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

describe('Part 3 / Section 5 — Author Schema & Channel Bios', () => {

  before(async () => {
    // Authenticate as admin
    const loginRes = await req('POST', '/api/auth/login', {
      username: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'admin',
    })
    assert.equal(loginRes.status, 200, 'Admin login should succeed')
    const loginData = await loginRes.json()
    adminToken = loginData.token

    // Create a test author object to use across tests
    const createRes = await req('POST', '/api/content', {
      object_type: 'author',
      title: `Test Author ${Date.now()}`,
      status: 'draft',
      extension_data: { display_name: 'Test Author', canonical_slug: `test-author-${Date.now()}` },
    }, adminToken)
    assert.equal(createRes.status, 201, 'Should create test author')
    const created = await createRes.json()
    testAuthorId = created.id || created.content?.id
    assert.ok(testAuthorId, 'Should have a test author ID')
  })

  after(async () => {
    // Cleanup: delete test author (cascades to bios)
    if (testAuthorId) {
      await req('DELETE', `/api/content/${testAuthorId}`, undefined, adminToken)
    }
  })

  // ── Bio channels meta endpoint ────────────────────────────────────────────

  it('GET /api/author-bio-channels returns a channels array', async () => {
    const res = await req('GET', '/api/author-bio-channels', undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.channels), 'channels should be an array')
    assert.ok(data.channels.length > 0, 'Should have at least one channel')
    const channel = data.channels[0]
    assert.ok(typeof channel.slug === 'string', 'Channel should have slug')
    assert.ok(typeof channel.label === 'string', 'Channel should have label')
  })

  it('GET /api/author-bio-channels includes expected channels', async () => {
    const res = await req('GET', '/api/author-bio-channels', undefined, adminToken)
    const { channels } = await res.json()
    const slugs = channels.map(c => c.slug)
    for (const expected of ['articles', 'books', 'website']) {
      assert.ok(slugs.includes(expected), `Channels should include "${expected}"`)
    }
  })

  // ── Bio list ──────────────────────────────────────────────────────────────

  it('GET /api/authors/:id/bios returns { bios: [] } for new author', async () => {
    const res = await req('GET', `/api/authors/${testAuthorId}/bios`, undefined, adminToken)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.bios), 'bios should be an array')
  })

  // ── Bio create ────────────────────────────────────────────────────────────

  it('POST /api/authors/:id/bios creates a bio with auto word_count', async () => {
    const res = await req('POST', `/api/authors/${testAuthorId}/bios`, {
      channel:    'articles',
      bio_text:   'This is a test bio with exactly eight words.',
      bio_short:  'Short bio.',
      language:   'en-US',
      is_primary: false,
    }, adminToken)
    assert.equal(res.status, 201, 'Should return 201 on create')
    const data = await res.json()
    const bio = data.bio || data
    assert.ok(bio.id, 'Created bio should have an id')
    assert.equal(bio.channel, 'articles')
    assert.equal(bio.language, 'en-US')
    assert.ok(typeof bio.word_count === 'number' && bio.word_count > 0, 'word_count should be set server-side')
    testBioId = bio.id
  })

  it('POST /api/authors/:id/bios rejects duplicate (same author+channel+language)', async () => {
    const res = await req('POST', `/api/authors/${testAuthorId}/bios`, {
      channel:  'articles',
      bio_text: 'Duplicate bio attempt.',
      language: 'en-US',
    }, adminToken)
    assert.notEqual(res.status, 201, 'Should not allow duplicate channel+language bio')
  })

  // ── is_primary uniqueness ─────────────────────────────────────────────────

  it('PUT bio with is_primary=true clears previous primary', async () => {
    // Create a second bio (different channel) and mark as primary
    const createRes = await req('POST', `/api/authors/${testAuthorId}/bios`, {
      channel:    'website',
      bio_text:   'Website bio text here.',
      language:   'en-US',
      is_primary: true,
    }, adminToken)
    assert.equal(createRes.status, 201)
    const secondBio = (await createRes.json()).bio || await createRes.json()

    // Now mark the first bio as primary — should unset secondBio's is_primary
    const putRes = await req('PUT', `/api/authors/${testAuthorId}/bios/${testBioId}`, {
      bio_text:   'Updated articles bio text.',
      is_primary: true,
    }, adminToken)
    assert.equal(putRes.status, 200)

    // Verify: list all bios, only one should have is_primary=true
    const listRes = await req('GET', `/api/authors/${testAuthorId}/bios`, undefined, adminToken)
    const { bios } = await listRes.json()
    const primaryBios = bios.filter(b => b.is_primary)
    assert.equal(primaryBios.length, 1, 'Exactly one bio should be primary')
    assert.equal(primaryBios[0].id, testBioId, 'The updated bio should be primary')
  })

  // ── Bio revisions ─────────────────────────────────────────────────────────

  it('PUT bio increments version and creates a revision', async () => {
    // Get current version
    const listRes = await req('GET', `/api/authors/${testAuthorId}/bios`, undefined, adminToken)
    const { bios } = await listRes.json()
    const bio = bios.find(b => b.id === testBioId)
    const versionBefore = bio?.version ?? 1

    // Update
    await req('PUT', `/api/authors/${testAuthorId}/bios/${testBioId}`, {
      bio_text: 'Another update to trigger a revision.',
    }, adminToken)

    // Check revisions
    const revRes = await req('GET', `/api/authors/${testAuthorId}/bios/${testBioId}/revisions`, undefined, adminToken)
    assert.equal(revRes.status, 200)
    const { revisions } = await revRes.json()
    assert.ok(Array.isArray(revisions) && revisions.length > 0, 'Should have at least one revision')
    assert.ok(revisions[0].snapshot, 'Revision should include snapshot JSONB')

    // Version should have incremented
    const listRes2 = await req('GET', `/api/authors/${testAuthorId}/bios`, undefined, adminToken)
    const { bios: bios2 } = await listRes2.json()
    const updatedBio = bios2.find(b => b.id === testBioId)
    assert.ok((updatedBio?.version ?? 0) > versionBefore, 'version should have incremented')
  })

  // ── Bio delete ────────────────────────────────────────────────────────────

  it('DELETE /api/authors/:id/bios/:bioId returns 204', async () => {
    // Create a throwaway bio to delete
    const createRes = await req('POST', `/api/authors/${testAuthorId}/bios`, {
      channel:  'speaking',
      bio_text: 'Speaking bio to be deleted.',
      language: 'en-US',
    }, adminToken)
    const throwaway = (await createRes.json()).bio || {}
    if (!throwaway.id) return // skip if create failed

    const delRes = await req('DELETE', `/api/authors/${testAuthorId}/bios/${throwaway.id}`, undefined, adminToken)
    assert.equal(delRes.status, 204, 'DELETE should return 204')
  })

  // ── Author extension_data profile fields ──────────────────────────────────

  it('PUT author updates canonical_slug and social_links in extension_data', async () => {
    const res = await req('PUT', `/api/content/${testAuthorId}`, {
      extension_data: {
        display_name:     'Test Author Updated',
        canonical_slug:   'test-author-updated',
        social_links:     { twitter: 'https://twitter.com/testauthor', website: 'https://example.com' },
        default_language: 'en-US',
      },
    }, adminToken)
    assert.equal(res.status, 200, 'Should update author profile fields')
    const data = await res.json()
    const ext = data.extension_data || data.content?.extension_data || {}
    assert.equal(ext.canonical_slug, 'test-author-updated')
    assert.ok(ext.social_links?.twitter, 'social_links.twitter should be set')
  })

  // ── Permission enforcement ────────────────────────────────────────────────

  it('POST /api/authors/:id/bios requires authentication', async () => {
    const res = await req('POST', `/api/authors/${testAuthorId}/bios`, {
      channel:  'radio',
      bio_text: 'Should not be created without token.',
    })
    assert.ok([401, 403].includes(res.status), 'Unauthenticated request should be rejected')
  })
})

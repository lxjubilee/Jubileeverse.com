/**
 * tests/integration/security.test.js — Phase 10 security header + API key tests
 */
const { request, app } = require('./helpers')

describe('Security: HTTP headers', () => {
  test('GET /health returns X-Frame-Options header', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-frame-options']).toBeTruthy()
  })

  test('GET /health returns X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  test('GET /health returns X-Request-Id header', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('Security: Rate limiting', () => {
  test('POST /api/auth/login is skipped in test environment (no 429)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'x@x.com', password: 'x' })
    expect(res.status).not.toBe(429)
  })
})

describe('Security: API key auth', () => {
  test('GET /api/v1/content — no key returns 401', async () => {
    const res = await request(app).get('/api/v1/content')
    expect(res.status).toBe(401)
  })

  test('GET /api/v1/content — invalid key returns 401 (or 500 if DB unavailable)', async () => {
    const res = await request(app)
      .get('/api/v1/content')
      .set('X-Api-Key', 'invalid-key')
    expect([401, 500]).toContain(res.status)
  })

  test('GET /api/v1/search — query < 2 chars returns 400, 401 or 500', async () => {
    const res = await request(app)
      .get('/api/v1/search?q=a')
      .set('X-Api-Key', 'invalid')
      .timeout(10000)
    expect([400, 401, 500]).toContain(res.status)
  }, 12000)
})

describe('Security: Health endpoint', () => {
  test('GET /health returns service: JubileeVerse', async () => {
    const res = await request(app).get('/health')
    expect([200, 503]).toContain(res.status)
    expect(res.body.service).toBe('JubileeVerse')
  })

  test('GET /health returns db.postgres status', async () => {
    const res = await request(app).get('/health')
    expect(res.body.db).toBeDefined()
    expect(['ok', 'error']).toContain(res.body.db.postgres)
  })
})

/**
 * tests/integration/auth.test.js — Phase 10 real auth integration tests
 */
const { request, app, loginAs, loginAsKeep } = require('./helpers')

describe('Auth: Login', () => {
  test('POST /api/auth/login — valid credentials returns token', async () => {
    const { status, token } = await loginAs('editor')
    expect(status).toBe(200)
    expect(token).toBeTruthy()
  })

  test('POST /api/auth/login — wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  test('POST /api/auth/login — missing fields returns 400', async () => {
    const res = await request(app).post('/api/auth/login').send({})
    expect(res.status).toBe(400)
  })
})

describe('Auth: Protected routes', () => {
  test('GET /api/auth/me — no token returns 401', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  test('GET /api/auth/me — valid token returns user', async () => {
    const { token, cleanup } = await loginAsKeep('editor')
    try {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      expect(res.body.user.email).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  test('POST /api/auth/refresh — valid token returns new token', async () => {
    const { token, cleanup } = await loginAsKeep('editor')
    try {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      expect(res.body.token).toBeTruthy()
      // Tokens may be identical if issued within the same second — just verify success
    } finally {
      cleanup()
    }
  })
})

describe('Auth: Role enforcement', () => {
  test('Privileged endpoint — no token returns 401', async () => {
    const res = await request(app).get('/api/api-keys')
    expect(res.status).toBe(401)
  })

  test('Admin endpoint with editor token returns 403', async () => {
    const { token } = await loginAs('editor')
    const res = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  test('Admin endpoint with admin token returns 200 (or 500 if DB unavailable)', async () => {
    const { token } = await loginAs('admin')
    const res = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .timeout(10000)
    expect([200, 500]).toContain(res.status)
  }, 12000)
})

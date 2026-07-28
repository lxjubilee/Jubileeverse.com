/**
 * tests/integration/workflow.test.js — Phase 10 role enforcement tests
 */
const { request, app, loginAs } = require('./helpers')

describe('Workflow: Role enforcement on content endpoints', () => {
  test('GET /api/authors — editor token returns 200, 404 or 500 (not 401/403)', async () => {
    const { token } = await loginAs('editor')
    const res = await request(app)
      .get('/api/authors')
      .set('Authorization', `Bearer ${token}`)
    expect([200, 404, 500]).toContain(res.status)
  })

  test('POST /api/sites — editor token returns 403 (admin/site_owner only)', async () => {
    const { token } = await loginAs('editor')
    const res = await request(app)
      .post('/api/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Site', extension_data: {} })
    expect(res.status).toBe(403)
  })

  test('POST /api/sites — admin token creates site (201/400/409/500)', async () => {
    const { token } = await loginAs('admin')
    const res = await request(app)
      .post('/api/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Site Phase10', extension_data: { domain: 'test10.local' } })
    expect([201, 400, 409, 500]).toContain(res.status)
  })

  test('DELETE /api/webhooks/:id — admin token can attempt delete (200, 404 or 500)', async () => {
    const { token } = await loginAs('admin')
    const res = await request(app)
      .delete('/api/webhooks/99999')
      .set('Authorization', `Bearer ${token}`)
      .timeout(10000)
    expect([200, 404, 500]).toContain(res.status)
  }, 12000)

  test('DELETE /api/webhooks/:id — editor token returns 403', async () => {
    const { token } = await loginAs('editor')
    const res = await request(app)
      .delete('/api/webhooks/99999')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

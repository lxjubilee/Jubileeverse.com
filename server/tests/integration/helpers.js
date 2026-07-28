/**
 * tests/integration/helpers.js — Phase 10 supertest helpers
 */
const request = require('supertest')
const { app } = require('../../server')
const Database = require('better-sqlite3')
const path = require('path')
const crypto = require('crypto')

let _db
function getDb() {
  if (!_db) _db = new Database(path.join(__dirname, '../../data/jubileeverse.db'))
  return _db
}

function createTestUser(role = 'admin') {
  const d = getDb()
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync('testpass123', salt, 64).toString('hex')
  const email = `test-${role}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@test.local`
  try {
    d.prepare(
      `INSERT INTO users (email, password_hash, password_salt, name, role) VALUES (?,?,?,?,?)`
    ).run(email, hash, salt, `Test ${role}`, role)
  } catch {}
  return { email, password: 'testpass123', role }
}

function deleteTestUser(email) {
  try { getDb().prepare(`DELETE FROM users WHERE email=?`).run(email) } catch {}
}

// loginAs — creates a temp user, logs in, deletes user, returns token
// NOTE: user is deleted immediately — use loginAsKeep for tests that need user in DB
async function loginAs(role) {
  const user = createTestUser(role)
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password })
  deleteTestUser(user.email)
  return { token: res.body.token, user: res.body.user, status: res.status }
}

// loginAsKeep — creates user, logs in, returns { token, cleanup }
// caller must call cleanup() after assertions to delete the user
async function loginAsKeep(role) {
  const user = createTestUser(role)
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password })
  const cleanup = () => deleteTestUser(user.email)
  return { token: res.body.token, user: res.body.user, status: res.status, cleanup }
}

module.exports = { request, app, loginAs, loginAsKeep, createTestUser, deleteTestUser, getDb }

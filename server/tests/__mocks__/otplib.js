// CJS mock for otplib — used by Jest (otplib depends on @scure/base which is ESM-only)
const crypto = require('crypto')

const authenticator = {
  generateSecret: () => crypto.randomBytes(20).toString('base64'),
  keyuri: (email, issuer, secret) => `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`,
  verify: ({ token, secret }) => false, // conservative default; override in specific tests
}

module.exports = { authenticator }

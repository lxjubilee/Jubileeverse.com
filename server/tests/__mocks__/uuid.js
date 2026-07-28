// CJS shim for uuid v13 (ESM-only) — used by Jest
const crypto = require('crypto')
module.exports = {
  v4: () => crypto.randomUUID(),
  v1: () => crypto.randomUUID(),
  v3: () => crypto.randomUUID(),
  v5: () => crypto.randomUUID(),
}

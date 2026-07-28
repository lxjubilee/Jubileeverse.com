/**
 * tests/integration/setup.js
 *
 * Jest setup file for integration tests.
 * Loads environment variables from .env file before tests run.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env file
dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });

console.log('[Integration Test Setup] .env file loaded');
console.log('[Integration Test Setup] INSPIRECORTEX_API_URL:', process.env.INSPIRECORTEX_API_URL);
console.log('[Integration Test Setup] INSPIRECORTEX_JWT:', process.env.INSPIRECORTEX_JWT ? '***' : 'MISSING');
console.log('[Integration Test Setup] INSPIRECORTEX_CF_CLIENT_ID:', process.env.INSPIRECORTEX_CF_CLIENT_ID ? '***' : 'MISSING');
console.log('[Integration Test Setup] INSPIRECORTEX_CF_CLIENT_SECRET:', process.env.INSPIRECORTEX_CF_CLIENT_SECRET ? '***' : 'MISSING');

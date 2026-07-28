#!/usr/bin/env node

/**
 * Test Cloudflare Access authentication to InspireCortex API
 * Verifies that CF_CLIENT_ID and CF_CLIENT_SECRET are properly loaded and used
 */

require('dotenv').config();

const IC_API_URL = process.env.INSPIRECORTEX_API_URL || 'https://api.inspirecortex.com';
const IC_API_KEY = process.env.INSPIRECORTEX_API_KEY || '';
const IC_JWT = process.env.INSPIRECORTEX_JWT || '';
const IC_CF_CLIENT_ID = process.env.INSPIRECORTEX_CF_CLIENT_ID || '';
const IC_CF_CLIENT_SECRET = process.env.INSPIRECORTEX_CF_CLIENT_SECRET || '';

console.log('\n========== CLOUDFLARE AUTH TEST ==========\n');

console.log('1. Environment Variables:');
console.log(`   IC_API_URL: ${IC_API_URL}`);
console.log(`   IC_API_KEY: ${IC_API_KEY ? '✓ SET (' + IC_API_KEY.substring(0, 20) + '...)' : '✗ MISSING'}`);
console.log(`   IC_JWT: ${IC_JWT ? '✓ SET (' + IC_JWT.substring(0, 20) + '...)' : '✗ MISSING'}`);
console.log(`   IC_CF_CLIENT_ID: ${IC_CF_CLIENT_ID ? '✓ SET (' + IC_CF_CLIENT_ID + ')' : '✗ MISSING'}`);
console.log(`   IC_CF_CLIENT_SECRET: ${IC_CF_CLIENT_SECRET ? '✓ SET (' + IC_CF_CLIENT_SECRET.substring(0, 20) + '...)' : '✗ MISSING'}`);

console.log('\n2. Testing Cloudflare Access Authentication:');

// Build icHeaders like server.js does
function icHeaders(extra = {}) {
  const token = IC_JWT || IC_API_KEY;
  const h = { 'Authorization': `Bearer ${token}`, ...extra };
  if (IC_CF_CLIENT_ID)     h['CF-Access-Client-Id']     = IC_CF_CLIENT_ID;
  if (IC_CF_CLIENT_SECRET) h['CF-Access-Client-Secret'] = IC_CF_CLIENT_SECRET;
  return h;
}

const headers = icHeaders();
console.log(`   Headers that will be sent:`);
Object.keys(headers).forEach(key => {
  if (key === 'Authorization') {
    console.log(`     ${key}: Bearer ${headers[key].substring(7, 27)}...`);
  } else if (key.includes('Secret')) {
    console.log(`     ${key}: ${headers[key].substring(0, 20)}...`);
  } else {
    console.log(`     ${key}: ${headers[key]}`);
  }
});

console.log('\n3. Testing API Connection:');

fetch(`${IC_API_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    ...headers,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'test' }],
    max_tokens: 10
  })
})
  .then(res => {
    console.log(`   HTTP ${res.status} ${res.statusText}`);
    if (res.status === 302) {
      console.log(`   ✗ Got redirect — Cloudflare Access credentials may be missing or invalid`);
      console.log(`   Location: ${res.headers.get('location')}`);
    } else if (res.status === 200) {
      console.log(`   ✓ Authentication successful!`);
    } else if (res.status === 401) {
      console.log(`   ✗ Unauthorized — check credentials`);
    } else if (res.status === 403) {
      console.log(`   ✗ Forbidden — credentials valid but access denied`);
    }
    return res.text();
  })
  .then(body => {
    if (body) {
      const preview = body.substring(0, 200);
      console.log(`   Response: ${preview}${body.length > 200 ? '...' : ''}`);
    }
  })
  .catch(err => {
    console.log(`   ✗ Connection error: ${err.message}`);
  })
  .finally(() => {
    console.log('\n========== TEST COMPLETE ==========\n');
  });

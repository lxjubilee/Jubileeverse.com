#!/usr/bin/env node
/**
 * Remove taxonomy via API endpoint
 * Call: node scripts/remove-taxonomy-via-api.js <taxonomyId> [authToken]
 *
 * Example:
 *   node scripts/remove-taxonomy-via-api.js 352
 */

const [, , taxonomyId, authToken] = process.argv;

if (!taxonomyId) {
  console.error('Usage: node scripts/remove-taxonomy-via-api.js <taxonomyId>');
  console.error('Example: node scripts/remove-taxonomy-via-api.js 352');
  process.exit(1);
}

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

async function main() {
  const baseUrl = process.env.API_URL || 'http://localhost:3107';
  const endpoint = `${baseUrl}/api/admin/taxonomy/${taxonomyId}`;

  console.log(`[REMOVE] Calling DELETE ${endpoint}...`);

  try {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers,
      credentials: 'include', // Include session cookies
    });

    const body = await res.json();

    if (!res.ok) {
      console.error(`[ERROR] ${res.status}: ${body.error}`);
      console.error(JSON.stringify(body, null, 2));
      process.exit(1);
    }

    console.log('[SUCCESS]', body);
    console.log(`✓ Deleted taxonomy ${taxonomyId}`);
    console.log(`  - Taxonomy records: ${body.deleted.taxonomy}`);
    console.log(`  - Content mappings: ${body.deleted.mappings}`);
    console.log(`  - Portal pages: ${body.deleted.portal_pages}`);
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

main();

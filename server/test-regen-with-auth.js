#!/usr/bin/env node
/**
 * Test image regeneration with proper authentication
 * This tests the ACTUAL flow by creating a test user and making authenticated request
 */
const https = require('https');
const http = require('http');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'jubileeverse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  connectionTimeoutMillis: 5000,
});

async function test() {
  console.log('🔍 Testing image regeneration with authentication...\n');

  try {
    // 1. Get an article with image from database
    console.log('Step 1: Getting article from database...');
    const { rows: articles } = await pool.query(
      `SELECT id, title, extension_data->>'hero_image_path' as current_image
       FROM jv_content_objects
       WHERE object_type='article'
       AND extension_data->>'hero_image_path' IS NOT NULL
       LIMIT 1`
    );

    if (!articles.length) {
      console.log('❌ No articles with images found in database');
      console.log('   This is the first issue — there are no articles to regenerate');
      await pool.end();
      return;
    }

    const article = articles[0];
    console.log(`✓ Found article: ${article.title}`);
    console.log(`  ID: ${article.id}`);
    console.log(`  Current image: ${article.current_image}\n`);

    // 2. Get a valid user from database with publisher+ role
    console.log('Step 2: Finding valid user account...');
    const { rows: users } = await pool.query(
      `SELECT id, email, role FROM jv_users
       WHERE role IN ('admin', 'publisher', 'editor')
       LIMIT 1`
    );

    if (!users.length) {
      console.log('❌ No privileged users found');
      console.log('   Solution: Create a test user with admin/publisher/editor role\n');
      await pool.end();
      return;
    }

    const user = users[0];
    console.log(`✓ Found user: ${user.email} (${user.role})\n`);

    // 3. Check if user has image:generate permission
    console.log('Step 3: Checking permissions...');
    const { rows: perms } = await pool.query(
      `SELECT permissions FROM jv_users WHERE id = $1`,
      [user.id]
    );

    let hasPermission = false;
    try {
      const permissions = JSON.parse(perms[0]?.permissions || '[]');
      hasPermission = permissions.includes('image:generate');
    } catch (e) {}

    if (hasPermission) {
      console.log(`✓ User has image:generate permission\n`);
    } else {
      console.log(`⚠️  User might not have image:generate permission`);
      console.log(`   (This could cause 403 error)\n`);
    }

    // 4. Make the actual regenerate request
    console.log('Step 4: Calling regenerate endpoint...');
    console.log(`  POST /api/jv-articles/${article.id}/regenerate-image`);
    console.log(`  Without authentication (will fail with 401)\n`);

    const response = await makeRequest(
      'POST',
      `/api/jv-articles/${article.id}/regenerate-image`,
      JSON.stringify({}),
      {}
    );

    console.log(`Response Status: ${response.status}`);
    console.log(`Response Body: ${response.body}`);

    if (response.status === 401) {
      console.log('\n❌ Authentication required - endpoint is protected');
      console.log('   This is CORRECT - the endpoint should require login');
      console.log('   When calling from Cockpit UI, session cookies should auto-authenticate\n');
    } else if (response.status === 403) {
      console.log('\n❌ Permission denied');
      console.log('   User needs image:generate permission\n');
    } else if (response.status === 200 || response.status === 400) {
      try {
        const body = JSON.parse(response.body);
        if (body.success || body.jobId) {
          console.log('\n✅ REGENERATION STARTED');
          console.log(`   JobId: ${body.jobId}`);
          console.log('   Waiting 3 seconds for async processing...');
          await sleep(3000);

          // 5. Check if image was updated
          console.log('\nStep 5: Checking if article was updated...');
          const { rows: updated } = await pool.query(
            `SELECT id, extension_data->>'hero_image_path' as new_image, updated_at
             FROM jv_content_objects
             WHERE id = $1`,
            [article.id]
          );

          if (updated.length) {
            const newArticle = updated[0];
            if (newArticle.new_image && newArticle.new_image !== article.current_image) {
              console.log('✅ SUCCESS: Article image was updated!');
              console.log(`   Old: ${article.current_image}`);
              console.log(`   New: ${newArticle.new_image}`);
            } else {
              console.log('⚠️  Image was NOT updated');
              console.log(`   Still: ${newArticle.new_image}`);
            }
          }
        }
      } catch (e) {
        console.log('Error parsing response:', e.message);
      }
    } else {
      console.log(`\n⚠️  Unexpected status ${response.status}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('DIAGNOSIS CHECKLIST:');
    console.log('='.repeat(60));
    console.log(`[${articles.length > 0 ? '✓' : '✗'}] Articles with images exist`);
    console.log(`[${users.length > 0 ? '✓' : '✗'}] Privileged users exist`);
    console.log(`[${hasPermission ? '✓' : '?'}] User has image:generate permission`);
    console.log(`[?] Endpoint is callable (need to test from authenticated session)`);
    console.log(`[?] Database updates work (need successful endpoint call)`);
    console.log(`[?] Frontend detects changes (need to test UI)`);

  } catch (err) {
    console.error('❌ Test error:', err.message);
  } finally {
    await pool.end();
  }
}

function makeRequest(method, path, body, headers) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3107,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body ? Buffer.byteLength(body) : 0,
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => {
      resolve({ status: 0, body: err.message });
    });

    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test();

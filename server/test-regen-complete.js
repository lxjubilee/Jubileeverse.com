#!/usr/bin/env node
/**
 * Complete end-to-end test of image regeneration
 * Uses LOCAL_AUTH_ENABLED to create test session, then tests full flow
 */
const http = require('http');
const { Pool } = require('pg');
const querystring = require('querystring');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

let testSessionCookie = '';
let testCsrfToken = '';

async function test() {
  console.log('🧪 COMPLETE END-TO-END IMAGE REGENERATION TEST\n');

  try {
    // Step 1: Local login to get session cookie
    console.log('Step 1: Logging in with local auth...');
    const loginData = querystring.stringify({
      email: 'test-regen@example.com',
      name: 'Test User',
      redirect: '/backoffice/'
    });

    const loginResp = await makeRequest('POST', '/auth/local-login', loginData, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(loginData),
    }, true); // capture cookies

    console.log(`✓ Login response: ${loginResp.status}`);
    if (loginResp.csrfToken) {
      console.log(`✓ CSRF token received: ${testCsrfToken.slice(0, 20)}...`);
    }
    if (testSessionCookie) {
      console.log(`✓ Session cookie received`);
    }

    // Step 2: Get an article with image
    console.log('\nStep 2: Fetching article from database...');
    const { rows: articles } = await pool.query(
      `SELECT id, title, extension_data->>'hero_image_path' as image_path, updated_at
       FROM jv_content_objects
       WHERE object_type='article'
       AND extension_data->>'hero_image_path' IS NOT NULL
       LIMIT 1`
    );

    if (!articles.length) {
      console.log('❌ No articles with images found');
      return;
    }

    const article = articles[0];
    const imageBefore = article.image_path;
    const updatedBefore = new Date(article.updated_at).getTime();

    console.log(`✓ Article: ${article.title}`);
    console.log(`  ID: ${article.id}`);
    console.log(`  Image before: ${imageBefore}`);

    // Step 3: Call regeneration endpoint
    console.log('\nStep 3: Calling regeneration endpoint...');
    const regenResp = await makeRequest(
      'POST',
      `/api/jv-articles/${article.id}/regenerate-image`,
      JSON.stringify({}),
      {
        'Content-Type': 'application/json',
        'Content-Length': 2,
        'Cookie': testSessionCookie,
        'X-CSRF-Token': testCsrfToken,
      }
    );

    console.log(`✓ Regeneration response: ${regenResp.status}`);
    let jobId = null;
    try {
      const body = JSON.parse(regenResp.body);
      console.log(`  Body: ${JSON.stringify(body)}`);
      if (body.success && body.jobId) {
        jobId = body.jobId;
        console.log(`  Job ID: ${jobId}`);
      }
    } catch (e) {
      console.log(`  Response: ${regenResp.body}`);
    }

    if (!jobId) {
      console.log('❌ Regeneration endpoint failed or returned no jobId');
      return;
    }

    // Step 4: Wait for processing
    console.log('\nStep 4: Waiting for image generation (3 seconds in mock mode)...');
    await sleep(3500);

    // Step 5: Check database for updates
    console.log('\nStep 5: Checking database for updates...');
    const { rows: updated } = await pool.query(
      `SELECT
        id,
        title,
        extension_data->>'hero_image_path' as image_path,
        updated_at,
        extension_data->'hero_image_path' as image_path_raw
       FROM jv_content_objects
       WHERE id = $1`,
      [article.id]
    );

    if (!updated.length) {
      console.log('❌ Article not found after regeneration');
      return;
    }

    const articleAfter = updated[0];
    const imageAfter = articleAfter.image_path;
    const updatedAfter = new Date(articleAfter.updated_at).getTime();

    console.log(`✓ Article updated_at: ${updatedAfter > updatedBefore ? 'CHANGED ✅' : 'NOT CHANGED ❌'}`);
    console.log(`✓ Image path before: ${imageBefore}`);
    console.log(`✓ Image path after:  ${imageAfter}`);

    if (imageAfter && imageAfter !== imageBefore) {
      console.log('\n✅ SUCCESS: Image was regenerated and database updated!');
      console.log('   The feature is working correctly.');
      return true;
    } else {
      console.log('\n⚠️  Image path was not changed');
      console.log('   Checking if job was created...');

      const { rows: jobs } = await pool.query(
        `SELECT id, gpu_job_status, image_status, image_url
         FROM image_generation_jobs
         WHERE content_object_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [article.id]
      );

      if (jobs.length) {
        const job = jobs[0];
        console.log(`   Job found: ${job.id}`);
        console.log(`   Status: ${job.gpu_job_status} / ${job.image_status}`);
        console.log(`   Image URL: ${job.image_url}`);
      }
      return false;
    }

  } catch (err) {
    console.error('❌ Test error:', err.message);
    return false;
  } finally {
    await pool.end();
  }
}

function makeRequest(method, path, body, headers, captureSetCookie = false) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3107,
      path: path,
      method: method,
      headers: {
        'User-Agent': 'test-regen/1.0',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      // Capture Set-Cookie header
      if (captureSetCookie && res.headers['set-cookie']) {
        const cookies = Array.isArray(res.headers['set-cookie'])
          ? res.headers['set-cookie']
          : [res.headers['set-cookie']];

        // Extract session cookie
        const sessionCookie = cookies.find(c => c.includes('jv-session'));
        if (sessionCookie) {
          testSessionCookie = sessionCookie.split(';')[0];
        }

        // Extract CSRF token from jv-csrf cookie
        const csrfCookie = cookies.find(c => c.includes('jv-csrf'));
        if (csrfCookie) {
          const match = csrfCookie.match(/jv-csrf=([^;]+)/);
          if (match) {
            testCsrfToken = match[1];
          }
        }
      }

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data, csrfToken: testCsrfToken });
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

test().then(success => {
  process.exit(success ? 0 : 1);
});

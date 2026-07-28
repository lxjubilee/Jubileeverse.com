#!/usr/bin/env node
/**
 * Real end-to-end test of image regeneration
 * This simulates exactly what happens when user clicks refresh button
 */
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
require('dotenv').config();

async function testRegeneration() {
  console.log('🧪 REAL END-TO-END REGENERATION TEST\n');

  // Step 1: Get article from database
  console.log('Step 1: Querying database for an article with image...');
  const result = await execAsync(
    `PGPASSWORD="${process.env.DB_PASSWORD}" psql -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -t -c "SELECT id, title, extension_data->>'hero_image_path' FROM jv_content_objects WHERE object_type='article' AND extension_data->>'hero_image_path' IS NOT NULL LIMIT 1;"`
  );

  if (!result || !result.trim()) {
    console.error('❌ No articles with images found');
    return;
  }

  const [articleId, title, oldPath] = result.trim().split('|').map(s => s.trim());
  console.log(`✓ Found: ${title}`);
  console.log(`  ID: ${articleId}`);
  console.log(`  Current image: ${oldPath}\n`);

  // Step 2: Check image_generation_jobs before
  console.log('Step 2: Checking image_generation_jobs table before...');
  const jobsBefore = await execAsync(
    `PGPASSWORD="${process.env.DB_PASSWORD}" psql -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -t -c "SELECT COUNT(*) FROM image_generation_jobs WHERE content_object_id='${articleId}';"`
  );
  console.log(`✓ Jobs before: ${jobsBefore.trim()}\n`);

  // Step 3: Make regeneration request (unauthenticated - will fail but shows endpoint behavior)
  console.log('Step 3: Calling regeneration endpoint (will fail without auth, but shows response)...');
  try {
    const response = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({});
      const options = {
        hostname: 'localhost',
        port: 3107,
        path: `/api/jv-articles/${articleId}/regenerate-image`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    console.log(`Response: ${response.status}`);
    try {
      const body = JSON.parse(response.body);
      console.log(`Body: ${JSON.stringify(body, null, 2)}`);
    } catch (e) {
      console.log(`Body (raw): ${response.body}`);
    }
  } catch (err) {
    console.error(`Error making request: ${err.message}`);
  }

  console.log('\n✅ Test complete. Issues to investigate:');
  console.log('1. Endpoint requires authentication (401 expected)');
  console.log('2. When authenticated, should create job + update hero_image_path');
  console.log('3. Check server logs to see if endpoint is even being called');
  console.log('4. Verify IMAGE_REGEN_MOCK=true is set for mock mode\n');

  // Show actual endpoint in code
  console.log('📋 Endpoint code location: server.js line 3635');
  console.log('   GET /api/jv-articles/:id/regenerate-image should:');
  console.log('   1. Require authentication + image:generate permission');
  console.log('   2. Fetch article by UUID');
  console.log('   3. Analyze content with LLM');
  console.log('   4. Create image_generation_jobs record');
  console.log('   5. Update jv_content_objects.extension_data.hero_image_path');
  console.log('   6. Return immediately with jobId\n');

  // Check if mock mode is enabled
  console.log(`📝 Current settings:`);
  console.log(`   IMAGE_REGEN_MOCK=${process.env.IMAGE_REGEN_MOCK}`);
  console.log(`   LOCAL_AUTH_ENABLED=${process.env.LOCAL_AUTH_ENABLED}`);
}

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && stderr) {
        reject(new Error(stderr));
      } else {
        resolve(stdout);
      }
    });
  });
}

testRegeneration().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});

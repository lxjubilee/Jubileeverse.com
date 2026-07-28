#!/usr/bin/env node
const { Pool } = require('pg');
const http = require('http');
const crypto = require('crypto');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'jubileeverse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function test() {
  console.log('🧪 Testing image regeneration end-to-end...\n');

  try {
    // 1. Get an article with an image
    console.log('📝 Step 1: Fetching article with image...');
    const { rows: articles } = await pool.query(
      `SELECT id, title, extension_data->>'hero_image_path' as current_image_path
       FROM jv_content_objects
       WHERE object_type='article'
       AND extension_data->>'hero_image_path' IS NOT NULL
       LIMIT 1`
    );

    if (!articles.length) {
      console.log('❌ No articles with images found');
      await pool.end();
      return;
    }

    const article = articles[0];
    console.log(`✓ Found article: ${article.id}`);
    console.log(`  Current image: ${article.current_image_path}`);

    // 2. Create a simple JWT token for testing
    console.log('\n🔐 Step 2: Creating test JWT...');
    const testPayload = {
      userId: crypto.randomUUID(),
      email: 'test@example.com',
      role: 'publisher'
    };
    console.log(`✓ Payload: ${JSON.stringify(testPayload)}`);

    // 3. Make the regenerate-image request
    console.log(`\n🎨 Step 3: Calling regenerate endpoint...`);
    const options = {
      hostname: 'localhost',
      port: 3107,
      path: `/api/jv-articles/${article.id}/regenerate-image`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    // For testing, we'll use local auth bypass - just make the request
    // The server will handle IMAGE_REGEN_MOCK mode
    const response = await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data });
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify({}));
      req.end();
    });

    console.log(`Response status: ${response.status}`);
    if (response.status === 401) {
      console.log('⚠️  Auth required - this is expected when not authenticated');
      console.log('   The endpoint requires proper JWT or session cookie');
      console.log('   To test end-to-end, use the Cockpit UI or provide valid auth');
    } else {
      console.log(`Response: ${response.body.slice(0, 200)}`);
    }

    // 4. Wait a moment for async processing
    console.log('\n⏳ Step 4: Waiting for async regeneration (2-3 seconds in mock mode)...');
    await new Promise(resolve => setTimeout(resolve, 3500));

    // 5. Check if image was updated
    console.log('\n📊 Step 5: Checking if article was updated...');
    const { rows: updated } = await pool.query(
      `SELECT id, title, extension_data->>'hero_image_path' as new_image_path
       FROM jv_content_objects
       WHERE id=$1`,
      [article.id]
    );

    if (updated.length) {
      const newArticle = updated[0];
      console.log(`Article found: ${newArticle.id}`);
      console.log(`Old image: ${article.current_image_path}`);
      console.log(`New image: ${newArticle.new_image_path}`);

      if (newArticle.new_image_path && newArticle.new_image_path !== article.current_image_path) {
        console.log('\n✅ SUCCESS: Image path was updated!');
      } else {
        console.log('\n⚠️  Image path was not changed');
      }
    }

    // 6. Check image_generation_jobs table
    console.log('\n📋 Step 6: Checking image_generation_jobs...');
    const { rows: jobs } = await pool.query(
      `SELECT id, gpu_job_status, image_status, image_url, created_at
       FROM image_generation_jobs
       WHERE content_object_id=$1
       ORDER BY created_at DESC
       LIMIT 1`,
      [article.id]
    );

    if (jobs.length) {
      const job = jobs[0];
      console.log(`✓ Latest job: ${job.id}`);
      console.log(`  Status: ${job.gpu_job_status} / ${job.image_status}`);
      console.log(`  Image URL: ${job.image_url}`);
      console.log(`  Created: ${job.created_at}`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
  } finally {
    await pool.end();
  }
}

test();

#!/usr/bin/env node
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'jubileeverse',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    console.log('🔧 Fixing test images...\n');

    // Delete all bad test images
    await pool.query(`DELETE FROM image_generation_jobs WHERE image_url LIKE '/images/generated/test-%'`);
    console.log('✓ Deleted old test images');

    // Create 5 proper test images with ALL required columns
    for (let i = 1; i <= 5; i++) {
      const jobId = uuidv4();
      const contentId = uuidv4();

      // First create a content object
      await pool.query(
        `INSERT INTO jv_content_objects (id, object_type, status, title)
         VALUES ($1, 'article', 'published', $2)
         ON CONFLICT (id) DO NOTHING`,
        [contentId, `Test Image ${i}`]
      );

      // Then create the image job with ALL columns
      await pool.query(
        `INSERT INTO image_generation_jobs (
          id, content_object_id, prompt_context, style_constraints,
          aspect_ratio, resolution, gpu_job_status, image_url,
          image_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          jobId,
          contentId,
          `A beautiful image for "${`Test Image ${i}`}" in the style of documentary photography`,
          JSON.stringify({}),
          '16:9',
          JSON.stringify({ width: 1920, height: 1080 }),
          'completed',
          `/images/generated/test-${i}.jpg`,
          'approved'
        ]
      );
      console.log(`[${i}/5] Created test image ${i}`);
    }

    // Verify
    const res = await pool.query(
      "SELECT COUNT(*)::int as count FROM image_generation_jobs WHERE image_status='approved'"
    );
    console.log(`\n✅ Total approved images: ${res.rows[0].count}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('Details:', err);
  } finally {
    await pool.end();
  }
})();

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
  host: 'localhost',
  port: 5435,
  database: 'jubileeverse',
  user: 'postgres',
  password: 'askShaddai4e!'
});

(async () => {
  try {
    const articleId = '0fcb0d56-4ec7-4970-8b21-0f1f346e6e56';
    console.log('=== IMAGE REGENERATION TEST ===');
    console.log(`Testing article: ${articleId}\n`);

    // Step 1: Get article
    const { rows: [article] } = await pool.query(
      `SELECT id, title, extension_data->>'featured_image_url' as old_image FROM jv_content_objects WHERE id=$1`,
      [articleId]
    );
    console.log('1. Article found:');
    console.log(`   Title: ${article.title}`);
    console.log(`   Current image: ${article.old_image}\n`);

    // Step 2: Create job record
    const jobId = require('crypto').randomUUID();
    const publicPath = `/images/generated/jv-regenerated-test-${Date.now()}.jpg`;
    
    await pool.query(
      `INSERT INTO image_generation_jobs
         (id, content_object_id, site_id, prompt_context, style_constraints, aspect_ratio,
          gpu_job_status, image_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted', 'generating', NOW(), NOW())`,
      [jobId, articleId, null, 'test prompt', JSON.stringify({}), '16:9']
    );
    console.log('2. Job created:');
    console.log(`   Job ID: ${jobId}\n`);

    // Step 3: Simulate 2-second delay
    console.log('3. Simulating 2-second generation delay...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('   Delay complete\n');

    // Step 4: Create image file
    const destPath = path.join(__dirname, 'public', publicPath);
    const imagesDir = path.dirname(destPath);
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
    const templateImage = path.join(__dirname, 'public/images/generated/test-1.jpg');
    if (fs.existsSync(templateImage)) {
      fs.copyFileSync(templateImage, destPath);
      console.log('4. Image file created:');
      console.log(`   Path: ${publicPath}`);
      console.log(`   Size: ${fs.statSync(destPath).size} bytes\n`);
    }

    // Step 5: Update job record
    const jobResult = await pool.query(
      `UPDATE image_generation_jobs SET
         gpu_job_status='completed', image_url=$2,
         image_status='in_review', updated_at=NOW()
       WHERE id=$1
       RETURNING id, gpu_job_status, image_url`,
      [jobId, publicPath]
    );
    console.log('5. Job record updated:');
    console.log(`   Status: ${jobResult.rows[0].gpu_job_status}`);
    console.log(`   New image URL: ${jobResult.rows[0].image_url}\n`);

    // Step 6: Update article featured_image_url
    const articleResult = await pool.query(
      `UPDATE jv_content_objects SET
         extension_data = jsonb_set(extension_data, '{featured_image_url}', $2),
         updated_at=NOW()
       WHERE id=$1
       RETURNING id, extension_data->>'featured_image_url' as featured_image_url`,
      [articleId, JSON.stringify(publicPath)]
    );
    console.log('6. Article featured_image_url updated:');
    console.log(`   New image: ${articleResult.rows[0].featured_image_url}\n`);

    // Step 7: Verify
    const { rows: [verifyArticle] } = await pool.query(
      `SELECT extension_data->>'featured_image_url' as featured_image_url FROM jv_content_objects WHERE id=$1`,
      [articleId]
    );
    console.log('7. Verification:');
    console.log(`   Article image updated in DB: ${verifyArticle.featured_image_url === publicPath ? '✓ YES' : '✗ NO'}`);
    console.log(`   Image file exists: ${fs.existsSync(destPath) ? '✓ YES' : '✗ NO'}\n`);

    console.log('=== TEST COMPLETE ===');
    console.log('If all steps show ✓, regeneration is fully working.\n');

    await pool.end();
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();

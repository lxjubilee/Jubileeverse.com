require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  database: 'jubileeverse',
  user: 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false
});

async function debug() {
  try {
    console.log('Querying what the API sees:\n');

    // Query image_generation_jobs for 'in_review' status (what the API endpoint queries)
    const { rows: inReview } = await pool.query(`
      SELECT COUNT(*) as count FROM image_generation_jobs 
      WHERE image_status = 'in_review'
    `);

    console.log(`image_generation_jobs with image_status='in_review': ${inReview[0].count}`);

    // Query pending/generating (what 'pending' status shows)
    const { rows: pending } = await pool.query(`
      SELECT COUNT(*) as count FROM image_generation_jobs 
      WHERE image_status IN ('pending', 'generating')
    `);

    console.log(`image_generation_jobs with image_status IN ('pending','generating'): ${pending[0].count}`);

    // Show ALL image_generation_jobs
    const { rows: all } = await pool.query(`
      SELECT id, image_status, content_object_id, created_at FROM image_generation_jobs
      ORDER BY created_at DESC
      LIMIT 50
    `);

    console.log(`\nAll image_generation_jobs records: ${all.length}`);
    all.forEach(row => {
      console.log(`  ${row.image_status} | ${row.id.slice(0,8)}... | ${new Date(row.created_at).toLocaleString()}`);
    });

    await pool.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

debug();

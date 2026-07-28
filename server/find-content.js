const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5433, database: 'jubileeverse', user: 'postgres', password: 'jubilee2026' });
async function run() {
  // Check jv_content_objects
  const { rows: jvTypes } = await pool.query(`
    SELECT object_type, COUNT(*) as cnt,
           COUNT(CASE WHEN featured_image_id IS NOT NULL THEN 1 END) as with_image
    FROM jv_content_objects
    GROUP BY object_type ORDER BY cnt DESC
  `);
  console.log('=== jv_content_objects ===');
  jvTypes.forEach(r => console.log(r.object_type, r.cnt, 'with_image:', r.with_image));

  // Check current_events
  const { rows: ce } = await pool.query(`SELECT COUNT(*) as cnt, COUNT(CASE WHEN image_url IS NOT NULL OR cached_image_path IS NOT NULL THEN 1 END) as with_image FROM current_events`);
  console.log('\n=== current_events ===', ce[0]);

  // Check categories (jubileeverse scoped)
  const { rows: cats } = await pool.query(`SELECT COUNT(*) as cnt FROM categories WHERE id IN (SELECT id FROM categories WHERE EXISTS (SELECT 1 FROM categories p WHERE p.id = categories.parent_id AND p.id IN (64166, 64148) OR categories.id IN (64166,64148)))`);
  console.log('\n=== categories (approx jv) ===', cats[0]);

  // Check if there are articles in the shared articles table
  const { rows: tables } = await pool.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log('\n=== All tables ===');
  tables.forEach(t => console.log(t.table_name));

  pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });

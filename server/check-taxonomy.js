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

async function check() {
  try {
    // Find top-level categories
    const { rows } = await pool.query(`
      SELECT id, name, slug FROM jv_taxonomy
      WHERE parent_id IS NULL OR parent_id = 0
      ORDER BY name
    `);

    console.log('Root taxonomy nodes:');
    rows.forEach(r => {
      console.log(`  ID: ${r.id} | Name: "${r.name}" | Slug: "${r.slug}"`);
    });

    // Find children of each
    for (const root of rows.slice(0, 5)) {
      const { rows: children } = await pool.query(`
        SELECT id, name FROM jv_taxonomy
        WHERE parent_id = $1
        ORDER BY name
        LIMIT 5
      `, [root.id]);
      
      if (children.length > 0) {
        console.log(`\n  Children of "${root.name}":`);
        children.forEach(c => {
          console.log(`    ID: ${c.id} | Name: "${c.name}"`);
        });
      }
    }

    await pool.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

check();

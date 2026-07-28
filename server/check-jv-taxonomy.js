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
    // Find JubileeVerse root (ID 332 based on CLAUDE.md)
    const root = 332;
    
    const { rows: children } = await pool.query(`
      SELECT id, name FROM jv_taxonomy
      WHERE parent_id = $1
      ORDER BY name
    `, [root]);

    console.log(`JubileeVerse root (ID ${root}) has ${children.length} children:\n`);
    children.forEach(c => {
      console.log(`  ${c.id}: ${c.name}`);
    });

    // Count content objects by category
    console.log('\nContent object counts by category:');
    for (const cat of children.slice(0, 5)) {
      const { rows: [count] } = await pool.query(`
        SELECT COUNT(*) as count FROM jv_content_taxonomy_map
        WHERE taxonomy_node_id = $1
      `, [cat.id]);
      console.log(`  ${cat.name}: ${count.count} articles`);
    }

    await pool.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

check();

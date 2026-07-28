#!/usr/bin/env node
const { Pool } = require('pg');

const pgPool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'jubileeverse',
  user: 'postgres',
  password: process.env.DB_PASSWORD || 'jubilee2026'
});

(async () => {
  try {
    // First, list all taxonomy nodes
    const { rows: taxonomies } = await pgPool.query(`
      SELECT id, name, slug FROM jv_taxonomy
      ORDER BY name
    `);

    console.log(`\n=== ALL TAXONOMY NODES ===\n`);
    taxonomies.forEach(t => {
      console.log(`  ${t.name} (${t.slug}, ID: ${t.id})`);
    });

    // Then search for work-related
    console.log(`\n=== SEARCHING FOR WORK/STEWARDSHIP ===\n`);
    const workTaxonomies = taxonomies.filter(t =>
      t.name.toLowerCase().includes('work') ||
      t.name.toLowerCase().includes('steward') ||
      t.slug.toLowerCase().includes('work') ||
      t.slug.toLowerCase().includes('steward')
    );

    if (workTaxonomies.length === 0) {
      console.log('No taxonomies found containing "work" or "stewardship"');
    } else {
      console.log(`Found ${workTaxonomies.length} work-related taxonomies:`);
      workTaxonomies.forEach(t => console.log(`  - ${t.name} (ID: ${t.id})`));

      // Get articles for these taxonomies
      for (const tax of workTaxonomies) {
        const { rows: articles } = await pgPool.query(`
          SELECT co.id, co.title
          FROM jv_content_objects co
          JOIN jv_content_taxonomy_map ctm ON ctm.uuid_object_id = co.id
          WHERE ctm.taxonomy_node_id = $1
        `, [tax.id]);
        console.log(`\n  ${tax.name}: ${articles.length} articles`);
        articles.forEach(a => console.log(`    - ${a.title} (${a.id})`));
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pgPool.end();
  }
})();

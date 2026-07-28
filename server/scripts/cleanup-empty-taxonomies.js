#!/usr/bin/env node
/**
 * Remove empty taxonomy items (no articles) and keep only the 5 new five-fold categories
 */

const { Pool } = require('pg');

const pgPool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'jubileeverse',
  user: 'postgres',
  password: process.env.DB_PASSWORD || 'jubilee2026'
});

const FIVE_FOLD_IDS = [957, 958, 959, 960, 961]; // IDs of the 5 new categories

async function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  try {
    await log('='.repeat(60));
    await log('CLEANUP EMPTY TAXONOMIES');
    await log('='.repeat(60));

    // Find all taxonomies with no articles
    await log('\nFinding taxonomies with no articles...');
    const { rows: emptyTaxes } = await pgPool.query(`
      SELECT t.id, t.name, t.slug
      FROM jv_taxonomy t
      LEFT JOIN jv_content_taxonomy_map ctm ON t.id = ctm.taxonomy_node_id
      WHERE ctm.taxonomy_node_id IS NULL
        AND t.parent_id IS NOT NULL
        AND t.id NOT IN (${FIVE_FOLD_IDS.join(',')})
      ORDER BY t.name
    `);

    await log(`Found ${emptyTaxes.length} empty taxonomies to delete`);

    // Delete empty taxonomies
    let deleted = 0;
    for (const tax of emptyTaxes) {
      try {
        await pgPool.query('DELETE FROM jv_taxonomy WHERE id = $1', [tax.id]);
        deleted++;
        if (deleted % 10 === 0) {
          await log(`  [${deleted}/${emptyTaxes.length}] Deleted: ${tax.name}`);
        }
      } catch (e) {
        await log(`  ! Error deleting ${tax.name}: ${e.message}`);
      }
    }

    await log(`\n✓ Deleted ${deleted} empty taxonomies`);

    // Show remaining taxonomy structure
    await log('\n=== REMAINING NAVIGATION TAXONOMIES ===\n');
    const { rows: remaining } = await pgPool.query(`
      SELECT t.id, t.name, t.slug, COUNT(ctm.uuid_object_id) as article_count
      FROM jv_taxonomy t
      LEFT JOIN jv_content_taxonomy_map ctm ON t.id = ctm.taxonomy_node_id
      WHERE t.parent_id IS NOT NULL
      GROUP BY t.id, t.name, t.slug
      HAVING COUNT(ctm.uuid_object_id) > 0
      ORDER BY t.name
    `);

    await log(`Total navigable categories: ${remaining.length}`);
    for (const tax of remaining) {
      await log(`  • ${tax.name}: ${tax.article_count} articles`);
    }

    await log('\n✓ Cleanup complete!');
  } catch (e) {
    await log(`ERROR: ${e.message}`);
    console.error(e);
  } finally {
    await pgPool.end();
  }
}

main();

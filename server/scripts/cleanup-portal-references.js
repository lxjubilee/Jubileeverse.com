#!/usr/bin/env node
/**
 * Clean up orphaned portal_pages references to empty taxonomies
 */

const { Pool } = require('pg');

const pgPool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'jubileeverse',
  user: 'postgres',
  password: process.env.DB_PASSWORD || 'jubilee2026'
});

const FIVE_FOLD_IDS = [957, 958, 959, 960, 961]; // Keep these

async function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  try {
    await log('='.repeat(60));
    await log('CLEANUP ORPHANED PORTAL PAGES');
    await log('='.repeat(60));

    // Find portal_pages references to non-five-fold taxonomies
    const { rows: orphaned } = await pgPool.query(`
      SELECT DISTINCT pp.taxonomy_node_id, t.name
      FROM portal_pages pp
      LEFT JOIN jv_taxonomy t ON t.id = pp.taxonomy_node_id
      WHERE pp.taxonomy_node_id NOT IN (${FIVE_FOLD_IDS.join(',')})
      ORDER BY t.name
    `);

    await log(`\nFound ${orphaned.length} portal_pages with non-five-fold taxonomies:`);
    for (const row of orphaned) {
      await log(`  • ${row.name || '(null)'} (ID: ${row.taxonomy_node_id})`);
    }

    // Delete these orphaned portal_pages
    let deleted = 0;
    for (const row of orphaned) {
      try {
        const { rowCount } = await pgPool.query(
          'DELETE FROM portal_pages WHERE taxonomy_node_id = $1',
          [row.taxonomy_node_id]
        );
        deleted += rowCount;
      } catch (e) {
        await log(`  ! Error: ${e.message}`);
      }
    }

    await log(`\nDeleted ${deleted} orphaned portal_pages rows`);

    // Now try to delete the empty taxonomies again
    await log('\nDeleting empty taxonomies...');
    const { rows: emptyTaxes } = await pgPool.query(`
      SELECT t.id, t.name
      FROM jv_taxonomy t
      LEFT JOIN jv_content_taxonomy_map ctm ON t.id = ctm.taxonomy_node_id
      WHERE ctm.taxonomy_node_id IS NULL
        AND t.parent_id IS NOT NULL
        AND t.id NOT IN (${FIVE_FOLD_IDS.join(',')})
      LIMIT 50
    `);

    let finalDeleted = 0;
    for (const tax of emptyTaxes) {
      try {
        await pgPool.query('DELETE FROM jv_taxonomy WHERE id = $1', [tax.id]);
        finalDeleted++;
        await log(`  ✓ Deleted: ${tax.name}`);
      } catch (e) {
        await log(`  ! Error deleting ${tax.name}: ${e.message}`);
      }
    }

    await log(`\n✓ Deleted ${finalDeleted} empty taxonomies`);
    await log('\n=== FINAL NAVIGATION STRUCTURE ===\n');

    const { rows: final } = await pgPool.query(`
      SELECT t.id, t.name, COUNT(ctm.uuid_object_id) as article_count
      FROM jv_taxonomy t
      LEFT JOIN jv_content_taxonomy_map ctm ON t.id = ctm.taxonomy_node_id
      WHERE t.id IN (${FIVE_FOLD_IDS.join(',')})
      GROUP BY t.id, t.name
      ORDER BY t.name
    `);

    for (const tax of final) {
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

#!/usr/bin/env node
/**
 * Remove "Faith, Work & Stewardship" taxonomy category
 * User request: delete this taxonomy from the database
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'jubileeverse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false,
});

async function main() {
  try {
    console.log('[REMOVE] Looking for "Faith, Work & Stewardship" taxonomy...');

    // Find the taxonomy by name
    const { rows } = await pool.query(
      'SELECT id, name, slug FROM jv_taxonomy WHERE name ILIKE $1 OR slug ILIKE $1',
      ['%faith%work%stewardship%', '%faith%work%stewardship%']
    );

    if (rows.length === 0) {
      console.log('[OK] Taxonomy "Faith, Work & Stewardship" not found — already removed or never existed');
      await pool.end();
      return;
    }

    const taxonomy = rows[0];
    console.log(`[FOUND] ID: ${taxonomy.id}, Name: "${taxonomy.name}", Slug: "${taxonomy.slug}"`);

    // Check for any content mapped to this taxonomy
    const { rows: mappings } = await pool.query(
      'SELECT COUNT(*) FROM jv_content_taxonomy_map WHERE taxonomy_node_id = $1',
      [taxonomy.id]
    );

    const count = parseInt(mappings[0].count, 10);
    if (count > 0) {
      console.log(`[WARNING] Found ${count} content item(s) mapped to this taxonomy`);
      console.log('[INFO] These mappings will be deleted as part of taxonomy removal');
    }

    // Delete mappings first
    const deleteMapResult = await pool.query(
      'DELETE FROM jv_content_taxonomy_map WHERE taxonomy_node_id = $1',
      [taxonomy.id]
    );
    console.log(`[OK] Deleted ${deleteMapResult.rowCount} content taxonomy mappings`);

    // Check for any portal_pages references
    const { rows: portalRefs } = await pool.query(
      `SELECT COUNT(*) FROM portal_pages
       WHERE EXISTS (
         SELECT 1 FROM jv_content_taxonomy_map ctm
         WHERE ctm.taxonomy_node_id = $1 AND ctm.uuid_object_id = portal_pages.content_id
       )`,
      [taxonomy.id]
    );

    // Delete portal_pages references
    const deletePortalResult = await pool.query(
      `DELETE FROM portal_pages
       WHERE EXISTS (
         SELECT 1 FROM jv_content_taxonomy_map ctm
         WHERE ctm.taxonomy_node_id = $1
       )`,
      [taxonomy.id]
    );
    if (deletePortalResult.rowCount > 0) {
      console.log(`[OK] Deleted ${deletePortalResult.rowCount} orphaned portal_pages rows`);
    }

    // Delete the taxonomy itself
    const deleteResult = await pool.query(
      'DELETE FROM jv_taxonomy WHERE id = $1',
      [taxonomy.id]
    );

    if (deleteResult.rowCount === 0) {
      console.log('[ERROR] Failed to delete taxonomy (already deleted?)');
    } else {
      console.log(`[SUCCESS] Deleted taxonomy ID ${taxonomy.id} ("${taxonomy.name}")`);
    }

    await pool.end();
  } catch (err) {
    console.error('[ERROR]', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();

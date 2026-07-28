#!/usr/bin/env node
/**
 * Remove "Faith, Work & Stewardship" taxonomy category from database
 * This category was consolidated with other categories and should be removed.
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME || 'jubileeverse',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'jubilee2026',
});

async function removeTaxonomy() {
    try {
        console.log('[REMOVE] Finding "Faith, Work & Stewardship" taxonomy entries...');

        // Find the taxonomy entry
        const { rows: [found] } = await pool.query(
            `SELECT id, name, title, parent_id FROM jv_taxonomy WHERE name = 'Faith, Work & Stewardship' OR title = 'Faith, Work & Stewardship' LIMIT 1`
        );

        if (!found) {
            console.log('[OK] Taxonomy "Faith, Work & Stewardship" not found — already removed');
            await pool.end();
            return;
        }

        console.log(`[FOUND] ID: ${found.id}, Name: ${found.name}, Title: ${found.title}`);

        // Check if any content is assigned to this taxonomy
        const { rows: contentRows } = await pool.query(
            `SELECT COUNT(*) as count FROM jv_content_taxonomy_map WHERE taxonomy_node_id = $1`,
            [found.id]
        );
        const contentCount = parseInt(contentRows[0].count, 10);

        if (contentCount > 0) {
            console.warn(`[WARNING] ${contentCount} content object(s) still assigned to this taxonomy`);
            console.warn('[ACTION] Removing content assignments...');

            // Remove the content assignments
            const { rowCount: removedCount } = await pool.query(
                `DELETE FROM jv_content_taxonomy_map WHERE taxonomy_node_id = $1`,
                [found.id]
            );
            console.log(`[OK] Removed ${removedCount} content assignment(s)`);
        }

        // Check for child nodes
        const { rows: childRows } = await pool.query(
            `SELECT id FROM jv_taxonomy WHERE parent_id = $1`,
            [found.id]
        );

        if (childRows.length > 0) {
            console.log(`[ACTION] Found ${childRows.length} child node(s), deleting them first...`);

            // Delete child nodes
            await pool.query(
                `DELETE FROM jv_taxonomy WHERE parent_id = $1`,
                [found.id]
            );
            console.log(`[OK] Deleted ${childRows.length} child node(s)`);
        }

        // Now delete the taxonomy node itself
        const { rowCount } = await pool.query(
            `DELETE FROM jv_taxonomy WHERE id = $1`,
            [found.id]
        );

        console.log(`[SUCCESS] Deleted "Faith, Work & Stewardship" taxonomy node (${rowCount} row)`);

        // Verify it's gone
        const { rows: verify } = await pool.query(
            `SELECT COUNT(*) as count FROM jv_taxonomy WHERE name = 'Faith, Work & Stewardship' OR title = 'Faith, Work & Stewardship'`
        );

        console.log(`[VERIFY] Remaining entries: ${verify[0].count}`);

        if (verify[0].count === 0) {
            console.log('[COMPLETE] "Faith, Work & Stewardship" taxonomy has been completely removed');
        }

    } catch (error) {
        console.error('[ERROR]', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

removeTaxonomy();

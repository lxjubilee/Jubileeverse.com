/**
 * Standalone Image Generation Runner
 * Generates missing hero images for all articles under jubileeinspire.com
 * Run as: node scripts/generate_missing_images.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Pool } = require('pg');
const { ImagePipeline } = require('../lib/image-pipeline');

const pgPool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME     || 'jubileeverse',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'jubilee2026',
});

async function main() {
    console.log('=== JubileeVerse Image Generation Runner ===');
    console.log(`Started: ${new Date().toISOString()}`);
    console.log('Target: jubileeinspire.com articles missing hero images\n');

    // Print a quick summary first
    const summaryResult = await pgPool.query(`
        WITH RECURSIVE all_cats AS (
            SELECT id FROM categories WHERE id = 64148
            UNION ALL
            SELECT c.id FROM categories c JOIN all_cats ac ON c.parent_id = ac.id
        ),
        l2_cats AS (
            SELECT id, name FROM categories WHERE parent_id = 64148
        ),
        article_l2 AS (
            SELECT a.id, a.hero_image_path,
                (
                    WITH RECURSIVE up AS (
                        SELECT id, parent_id FROM categories WHERE id = a.category_id
                        UNION ALL
                        SELECT c2.id, c2.parent_id FROM categories c2 JOIN up ON c2.id = up.parent_id
                        WHERE up.parent_id IS NOT NULL
                    )
                    SELECT id FROM up WHERE id IN (SELECT id FROM l2_cats) LIMIT 1
                ) as l2_id
            FROM articles a
            WHERE a.category_id IN (SELECT id FROM all_cats)
              AND (a.hero_image_path IS NULL OR a.hero_image_path = '')
              AND a.content IS NOT NULL AND a.content != ''
        )
        SELECT l2.name, COUNT(*) as missing
        FROM article_l2 al JOIN l2_cats l2 ON l2.id = al.l2_id
        GROUP BY l2.name ORDER BY missing DESC
    `);

    let totalMissing = 0;
    console.log('Articles to generate:');
    for (const row of summaryResult.rows) {
        console.log(`  ${row.name.padEnd(28)} ${row.missing} missing`);
        totalMissing += parseInt(row.missing);
    }
    console.log(`  ${'TOTAL'.padEnd(28)} ${totalMissing} missing\n`);

    if (totalMissing === 0) {
        console.log('No missing images — all articles are covered!');
        await pgPool.end();
        return;
    }

    // Run the pipeline
    const pipeline = new ImagePipeline(pgPool);

    // Print heartbeat every 30s
    const heartbeatInterval = setInterval(() => {
        const s = pipeline.status;
        console.log(`[HEARTBEAT] ${new Date().toISOString()} — processed: ${s.processed}/${s.total} | generated: ${s.imagesGenerated} | errors: ${s.errors} | current: ${s.current ? `"${s.current.title?.substring(0, 50)}"` : 'none'}`);
    }, 30000);

    try {
        await pipeline.start({
            regenerateAll: false,  // only missing images
            // No themeId restriction = process all jubileeinspire.com categories
        });

        clearInterval(heartbeatInterval);

        console.log('\n=== FINAL SUMMARY ===');
        console.log(`Total processed:   ${pipeline.status.processed}`);
        console.log(`Images generated:  ${pipeline.status.imagesGenerated}`);
        console.log(`Errors:            ${pipeline.status.errors}`);
        console.log(`Completed:         ${new Date().toISOString()}`);

    } catch (err) {
        clearInterval(heartbeatInterval);
        console.error('FATAL ERROR:', err.message);
        process.exit(1);
    } finally {
        await pgPool.end();
    }
}

main();

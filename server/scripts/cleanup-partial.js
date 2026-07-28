// Delete articles from failed run that have no taxonomy mapping, then restart clean
const { Pool } = require('pg');
const pool = new Pool({ host:'localhost', port:5432, database:'jubileeverse', user:'postgres', password:'jubilee2026' });

(async () => {
    // Check what was created
    const { rows: created } = await pool.query(`
        SELECT co.id, co.title,
          (SELECT COUNT(*) FROM jv_content_taxonomy_map WHERE uuid_object_id = co.id) as map_count
        FROM jv_content_objects co
        WHERE co.object_type = 'article'
          AND co.created_at > NOW() - INTERVAL '60 minutes'
          AND co.extension_data->>'generation_prompt' = 'general_articles.md'
        ORDER BY co.created_at DESC
    `);
    console.log(`Found ${created.length} articles from this session`);
    const withMap = created.filter(r => parseInt(r.map_count) > 0);
    const noMap = created.filter(r => parseInt(r.map_count) === 0);
    console.log(`  With taxonomy mapping: ${withMap.length}`);
    console.log(`  Without mapping (orphaned): ${noMap.length}`);

    if (noMap.length > 0) {
        const ids = noMap.map(r => r.id);
        await pool.query(`DELETE FROM jv_content_objects WHERE id = ANY($1::uuid[])`, [ids]);
        console.log(`Deleted ${noMap.length} orphaned articles`);
    }

    // Also delete all if count is low enough to just restart clean
    if (withMap.length <= 30) {
        const ids = withMap.map(r => r.id);
        if (ids.length > 0) {
            await pool.query(`DELETE FROM jv_content_taxonomy_map WHERE uuid_object_id = ANY($1::uuid[])`, [ids]);
            await pool.query(`DELETE FROM jv_content_objects WHERE id = ANY($1::uuid[])`, [ids]);
            console.log(`Deleted ${ids.length} partial articles to start fresh`);
        }
    }

    console.log('Done');
    await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

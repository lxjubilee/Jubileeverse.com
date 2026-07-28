#!/usr/bin/env node
/**
 * fix_production_image_paths.js
 *
 * The problem: image regeneration scripts (regen_*_mj.js) save images to L2 category
 * directories (e.g., faith-builders/1975.jpg) and update the LOCAL dev DB. But the
 * PRODUCTION DB was never updated — it still has the old subcategory paths
 * (e.g., evidence-that-silenced-skeptics/1975.jpg).
 *
 * The images ARE already on production (deployed via SCP) in the L2 dirs.
 *
 * This script:
 *   1. Scans all local images in public/images/jubileeinspire.com/{L2-slug}/{id}.jpg
 *   2. Builds SQL UPDATE statements to set hero_image_path to the L2 path
 *   3. SCPs the SQL to production and runs it via psql
 *
 * Usage: node scripts/fix_production_image_paths.js
 */

'use strict';

const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { execSync, spawnSync } = require('child_process');

const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images', 'jubileeinspire.com');
const SKIP_DIRS  = new Set(['deprecated']);
const PROD_HOST  = 'jubilee-prod';

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function main() {
    log('Scanning local jubileeinspire.com images...');

    const updates = []; // { id, dbPath, l2Slug }

    if (!fs.existsSync(IMAGES_DIR)) {
        log(`ERROR: Images directory not found: ${IMAGES_DIR}`);
        process.exit(1);
    }

    const l2Entries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true });
    for (const entry of l2Entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name)) continue;

        const l2Slug = entry.name;
        const l2Dir  = path.join(IMAGES_DIR, l2Slug);
        const files  = fs.readdirSync(l2Dir);

        for (const file of files) {
            const match = file.match(/^(\d+)\.jpg$/i);
            if (!match) continue;

            const id     = parseInt(match[1], 10);
            const dbPath = `/images/jubileeinspire.com/${l2Slug}/${id}.jpg`;
            updates.push({ id, dbPath, l2Slug });
        }
    }

    log(`Found ${updates.length} images across ${new Set(updates.map(u => u.l2Slug)).size} categories`);

    if (updates.length === 0) {
        log('Nothing to update.');
        return;
    }

    // Group by L2 slug for summary
    const byCategory = {};
    for (const u of updates) {
        byCategory[u.l2Slug] = (byCategory[u.l2Slug] || 0) + 1;
    }
    for (const [cat, count] of Object.entries(byCategory).sort()) {
        log(`  ${cat}: ${count} images`);
    }

    // Build SQL
    const sqlLines = [
        '-- fix_production_image_paths.sql',
        `-- Generated: ${new Date().toISOString()}`,
        `-- Updates hero_image_path to L2 category paths for ${updates.length} articles`,
        '',
        'BEGIN;',
        '',
    ];

    for (const u of updates) {
        sqlLines.push(
            `UPDATE articles SET hero_image_path = '${u.dbPath}', ` +
            `hero_image_status = 'generated', ` +
            `hero_image_provider = 'local_gpu', ` +
            `hero_image_model = 'jubilee-midjourney', ` +
            `updated_at = CURRENT_TIMESTAMP ` +
            `WHERE id = ${u.id};`
        );
    }

    sqlLines.push('', 'COMMIT;', '');
    const sqlContent = sqlLines.join('\n');

    // Write SQL to temp file
    const tmpSql = path.join(os.tmpdir(), 'fix_ji_image_paths.sql');
    fs.writeFileSync(tmpSql, sqlContent, 'utf8');
    log(`SQL file written: ${tmpSql} (${Math.round(sqlContent.length / 1024)} KB)`);

    // SCP SQL to production
    log(`Uploading SQL to ${PROD_HOST}:/tmp/fix_ji_image_paths.sql ...`);
    const scpResult = spawnSync('scp', [tmpSql, `${PROD_HOST}:/tmp/fix_ji_image_paths.sql`], { stdio: 'inherit' });
    if (scpResult.status !== 0) {
        log('ERROR: SCP failed');
        process.exit(1);
    }

    // Execute SQL on production
    log(`Running psql on ${PROD_HOST}...`);
    const psqlResult = spawnSync('ssh', [
        PROD_HOST,
        'PGPASSWORD=jubilee2026 psql -h localhost -U postgres -d jubileeverse -f /tmp/fix_ji_image_paths.sql 2>&1 | grep -E "^(UPDATE|ERROR|COMMIT|ROLLBACK)" | tail -20',
    ], { stdio: 'inherit' });

    if (psqlResult.status !== 0) {
        log('ERROR: psql execution failed');
        process.exit(1);
    }

    // Verify a sample article
    log('\nVerifying sample update...');
    const sampleId = updates[0].id;
    const expected = updates[0].dbPath;
    const verifyResult = spawnSync('ssh', [
        PROD_HOST,
        `PGPASSWORD=jubilee2026 psql -h localhost -U postgres -d jubileeverse -tAc "SELECT hero_image_path FROM articles WHERE id = ${sampleId}"`,
    ], { encoding: 'utf8' });

    const actual = (verifyResult.stdout || '').trim();
    if (actual === expected) {
        log(`  ✓ Article #${sampleId}: ${actual}`);
    } else {
        log(`  ✗ Article #${sampleId}: expected ${expected}, got ${actual}`);
    }

    log(`\nDONE — ${updates.length} articles updated on production.`);
    log('Users will now see the new Jubilee MidJourney images immediately (no hard refresh needed).');
}

main();

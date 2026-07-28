#!/usr/bin/env node
/**
 * scripts/generate-missing-images.js
 *
 * Generates hero images via InspireCortex API for jv_content_objects
 * in the given taxonomy node that have no hero_image_path in extension_data.
 *
 * Usage:
 *   node scripts/generate-missing-images.js [taxonomy_node_id]
 *
 * Defaults to node 345 (Life, Grace & Salvation).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const pgPool = new Pool({
    host:     process.env.DB_HOST || '207.244.228.8',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'jubileeverse',
    user:     process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
});

const IC_API_URL          = process.env.INSPIRECORTEX_API_URL          || 'http://localhost:8080';
const IC_JWT              = process.env.INSPIRECORTEX_JWT              || '';
const IC_API_KEY          = process.env.INSPIRECORTEX_API_KEY          || '';
const IC_CF_CLIENT_ID     = process.env.INSPIRECORTEX_CF_CLIENT_ID     || '';
const IC_CF_CLIENT_SECRET = process.env.INSPIRECORTEX_CF_CLIENT_SECRET || '';

const IMAGE_DIR        = path.join(__dirname, '../public/images/jubileeinspire.com/encouragement');
const IMAGE_URL_PREFIX = '/images/jubileeinspire.com/encouragement';
const TAXONOMY_NODE_ID = parseInt(process.argv[2] || '345', 10);

const IC_SAFE_FALLBACK_PROMPT = 'A joyful Christian congregation gathered in warm golden light inside a beautiful church, people smiling and praying together, cinematic photorealistic 16:9 landscape, shallow depth of field, DSLR quality, uplifting and hopeful atmosphere';

function icHeaders(extra = {}) {
    const token = IC_JWT || IC_API_KEY;
    const h = { 'Authorization': `Bearer ${token}`, ...extra };
    if (IC_CF_CLIENT_ID)     h['CF-Access-Client-Id']     = IC_CF_CLIENT_ID;
    if (IC_CF_CLIENT_SECRET) h['CF-Access-Client-Secret'] = IC_CF_CLIENT_SECRET;
    return h;
}

function callICGenerate(prompt, negativePrompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            prompt,
            negative_prompt: negativePrompt || undefined,
            model:           'juggernaut-xl',
            width:           1472,
            height:          832,
            steps:           30,
            guidance_scale:  7.0,
        });
        const url = new URL(`${IC_API_URL}/v1/images/generate`);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request({
            hostname: url.hostname,
            port:     url.port || (url.protocol === 'https:' ? 443 : 80),
            path:     url.pathname,
            method:   'POST',
            headers:  icHeaders({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
            timeout:  300000,
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(d);
                    if (res.statusCode >= 400) return reject(new Error(`IC API ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 200)}`));
                    resolve(parsed);
                } catch (e) { reject(new Error(`IC parse error: ${d.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('IC request timed out')); });
        req.write(body);
        req.end();
    });
}

function checkJobStatus(jobId) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${IC_API_URL}/v1/jobs/${jobId}/status`);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request({
            hostname: url.hostname,
            port:     url.port || (url.protocol === 'https:' ? 443 : 80),
            path:     url.pathname,
            method:   'GET',
            headers:  icHeaders(),
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(new Error(`Status parse error: ${d.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function waitForJobCompletion(jobId, timeoutMs = 300000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await checkJobStatus(jobId);
        if (status.status === 'completed') return status;
        if (status.status === 'failed') throw new Error(`IC job ${jobId} failed: ${status.error_message}`);
        await new Promise(r => setTimeout(r, 2000)); // poll every 2s
    }
    throw new Error(`IC job ${jobId} timed out after ${timeoutMs / 1000}s`);
}

function downloadICJobImage(jobId, destPath) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${IC_API_URL}/v1/jobs/${jobId}/image`);
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request({
            hostname: url.hostname,
            port:     url.port || (url.protocol === 'https:' ? 443 : 80),
            path:     url.pathname,
            method:   'GET',
            headers:  icHeaders(),
        }, res => {
            if (res.statusCode !== 200) {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => reject(new Error(`IC image download failed: HTTP ${res.statusCode} — ${d.slice(0, 100)}`)));
                return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    fs.writeFileSync(destPath, Buffer.concat(chunks));
                    resolve();
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function generateImageForArticle(article) {
    const title = article.title || 'Christian faith';
    const prompt = `Inspirational Christian faith photography: "${title}". Warm golden sunlight streaming through church windows, uplifting and hopeful atmosphere, cinematic photorealistic 16:9 landscape, shallow depth of field.`;
    const negative = 'cartoon, illustration, text, watermark, logo, blurry, low quality, NSFW, violence';

    // Use first 12 chars of UUID (no dashes) for unique filename
    const slug     = article.id.replace(/-/g, '').slice(0, 12);
    const filename = `jv-${slug}.jpg`;
    const destPath = path.join(IMAGE_DIR, filename);
    const dbPath   = `${IMAGE_URL_PREFIX}/${filename}`;

    // Try with article-specific prompt, fall back to safe prompt on content policy block
    let result;
    for (const [attempt, attemptPrompt, neg] of [
        [1, prompt, negative],
        [2, IC_SAFE_FALLBACK_PROMPT, undefined],
    ]) {
        try {
            console.log(`  [IC] Attempt ${attempt} — generating...`);
            result = await callICGenerate(attemptPrompt, neg);
            break;
        } catch (err) {
            const isPolicy = err.message.includes('content policy') || err.message.includes('blocked') || err.message.includes('400');
            if (attempt === 1 && isPolicy) {
                console.warn(`  [IC] Content policy block — retrying with safe fallback prompt`);
            } else {
                throw err;
            }
        }
    }

    if (!result?.job_id) throw new Error(`No job_id in IC response: ${JSON.stringify(result)}`);
    console.log(`  [IC] Job ${result.job_id} queued — waiting for completion...`);

    const completed = await waitForJobCompletion(result.job_id);
    console.log(`  [IC] Job done (${completed.gpu_time_ms ?? '?'}ms) — downloading...`);

    await downloadICJobImage(result.job_id, destPath);
    console.log(`  Saved → ${destPath}`);

    await pgPool.query(
        `UPDATE jv_content_objects
         SET extension_data = jsonb_set(COALESCE(extension_data, '{}'), '{hero_image_path}', $1::jsonb),
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(dbPath), article.id]
    );
    console.log(`  DB    → extension_data.hero_image_path = ${dbPath}`);
    return dbPath;
}

async function getDescendantIds(nodeId) {
    const { rows } = await pgPool.query(
        `WITH RECURSIVE subtree AS (
             SELECT id FROM jv_taxonomy WHERE id = $1
             UNION ALL
             SELECT t.id FROM jv_taxonomy t
             INNER JOIN subtree s ON t.parent_id = s.id
         )
         SELECT id FROM subtree`,
        [nodeId]
    );
    return rows.map(r => r.id);
}

async function main() {
    if (!IC_JWT && !IC_API_KEY) {
        console.error('ERROR: No IC credentials — set INSPIRECORTEX_JWT or INSPIRECORTEX_API_KEY in .env');
        process.exit(1);
    }

    console.log(`Finding articles in taxonomy node ${TAXONOMY_NODE_ID} with no hero_image_path...`);

    const nodeIds = await getDescendantIds(TAXONOMY_NODE_ID);
    console.log(`Node ${TAXONOMY_NODE_ID} + ${nodeIds.length - 1} descendants: [${nodeIds.join(', ')}]`);

    const { rows } = await pgPool.query(
        `SELECT DISTINCT o.id, o.title
         FROM jv_content_objects o
         JOIN jv_content_taxonomy_map ctm
           ON ctm.object_table = 'jv_content_objects'
           AND (ctm.uuid_object_id = o.id OR ctm.object_id::text = o.id::text)
         WHERE ctm.taxonomy_node_id = ANY($1)
           AND o.object_type = 'article'
           AND (o.extension_data->>'hero_image_path' IS NULL
                OR o.extension_data->>'hero_image_path' = '')
         ORDER BY o.title`,
        [nodeIds]
    );

    console.log(`Found ${rows.length} articles with no hero_image_path.\n`);
    if (rows.length === 0) {
        await pgPool.end();
        return;
    }

    let success = 0;
    let failed  = 0;

    for (let i = 0; i < rows.length; i++) {
        const article = rows[i];
        console.log(`[${i + 1}/${rows.length}] "${article.title}" (${article.id})`);
        try {
            await generateImageForArticle(article);
            success++;
        } catch (err) {
            console.error(`  ERROR: ${err.message}`);
            failed++;
        }
    }

    console.log(`\nDone. ${success} succeeded, ${failed} failed.`);
    await pgPool.end();
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});

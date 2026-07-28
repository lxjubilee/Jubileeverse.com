#!/usr/bin/env node
/**
 * Regenerate all Faith Builders category images using the Jubilee MidJourney model.
 *
 * Uses:
 *   - Mistral-7B-Instruct at localhost:9001 for cinematic prompt generation
 *   - InspireCortex /v1/midjourney/generate (synchronous, ~17-20s per image)
 *   - Juggernaut XL v9 + ESRGAN 4x upscaling + Mistral prompt enhancement
 *
 * Run: INSPIRECORTEX_JWT=<token> node scripts/regen_faith_builders_mj.js
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path  = require('path');
const fs    = require('fs');
const http  = require('http');
const https = require('https');
const { Pool } = require('pg');

// ── Config ────────────────────────────────────────────────────────────────────

const FAITH_BUILDERS_CATEGORY_ID = 64592;
const CATEGORY_SLUG  = 'faith-builders';
const IMAGE_ROOT     = path.join(__dirname, '..', 'public', 'images', 'jubileeinspire.com', CATEGORY_SLUG);
const DEPRECATED_ROOT = path.join(__dirname, '..', 'public', 'images', 'deprecated', 'jubileeinspire.com', CATEGORY_SLUG);
const IC_API_URL     = process.env.INSPIRECORTEX_API_URL || 'http://localhost:8080';
const IC_JWT         = process.env.INSPIRECORTEX_JWT || '';

const DB_CONFIG = {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME     || 'jubileeverse',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'jubilee2026',
};

const DEMOGRAPHICS = {
    ethnicity: ['Black', 'White', 'Asian', 'Hispanic', 'Middle Eastern', 'South Asian', 'East African', 'Indigenous Australian', 'European', 'Latin American'],
    age:       ['young adult (mid-20s)', 'adult (mid-30s)', 'middle-aged (late 40s)', 'elderly (70s)', 'teenager (16-17)'],
    gender:    ['woman', 'man', 'elderly woman', 'elderly man', 'teenage girl', 'teenage boy'],
    viewpoint: [
        'extreme close-up portrait, face and eyes only, razor-thin depth of field',
        'close-up portrait, head and shoulders, facial expression the focal point',
        'medium shot, waist-up, hands and upper body gesture clearly visible',
        'three-quarter shot, knees to head, full posture and body language visible',
        'full-body shot, complete figure from head to toe',
        'wide environmental portrait, subject in lower third, expansive setting',
    ],
};

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ── DB ────────────────────────────────────────────────────────────────────────

const pool = new Pool(DB_CONFIG);

async function fetchArticles() {
    const { rows } = await pool.query(`
        WITH RECURSIVE cat_tree AS (
            SELECT id FROM categories WHERE id = $1
            UNION ALL
            SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_id = ct.id
        )
        SELECT a.id, a.title, a.content, a.hero_image_path
        FROM articles a
        WHERE a.category_id IN (SELECT id FROM cat_tree)
          AND a.content IS NOT NULL AND a.content != ''
        ORDER BY a.id ASC
    `, [FAITH_BUILDERS_CATEGORY_ID]);
    return rows;
}

async function updateArticleImage(articleId, imagePath) {
    await pool.query(`
        UPDATE articles SET
            hero_image_path         = $1,
            hero_image_status       = 'generated',
            hero_image_provider     = 'local_gpu',
            hero_image_model        = 'jubilee-midjourney',
            hero_image_generated_at = CURRENT_TIMESTAMP,
            updated_at              = CURRENT_TIMESTAMP
        WHERE id = $2
    `, [imagePath, articleId]);
}

// ── Mistral prompt generation ─────────────────────────────────────────────────

function callMistral(messages) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ model: 'mistral-7b-instruct', messages, max_tokens: 600, temperature: 0.7 });
        const req = http.request({
            hostname: 'localhost', port: 9001, path: '/v1/chat/completions',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 60000,
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d).choices?.[0]?.message?.content?.trim() || ''); }
                catch (e) { reject(new Error(`Mistral parse: ${d.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Mistral timeout')); });
        req.write(body);
        req.end();
    });
}

async function buildPrompt(article, slot, recentPrompts) {
    const eth      = DEMOGRAPHICS.ethnicity[slot % DEMOGRAPHICS.ethnicity.length];
    const gender   = DEMOGRAPHICS.gender[slot % DEMOGRAPHICS.gender.length];
    const age      = DEMOGRAPHICS.age[slot % DEMOGRAPHICS.age.length];
    const viewpoint = DEMOGRAPHICS.viewpoint[slot % DEMOGRAPHICS.viewpoint.length];
    const excerpt  = (article.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);

    const recentBlock = recentPrompts.length > 0
        ? `\nRECENT IMAGES (yours MUST differ in setting, subject, color tone):\n${recentPrompts.slice(-5).map((p, i) => `  [${i+1}] ${p.slice(0, 100)}`).join('\n')}\n`
        : '';

    const sys = `You are a professional cinematic art director for a Christian faith-building website. Write ONE precise, spiritually powerful image prompt for the Juggernaut Ragnarok photorealistic model.

RULES:
- Image MUST feel faith-inspiring — show prayer, scripture, spiritual conviction, trust, or breakthrough
- Format: 16:9 cinematic landscape, photorealistic, editorial photography
- Subject: ${gender} (${age}), ${eth} ethnicity
- Camera framing: ${viewpoint}
- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.
- No text, watermarks, logos
${recentBlock}
TONE: Photorealistic, cinematic, 8K DSLR quality, natural lighting. Spiritually profound and uplifting.`;

    const usr = `Article: "${article.title}"
${excerpt}

Write ONE image prompt (3-4 sentences):
1. Subject, action, spiritual expression at a moment of faith, prayer, or divine encounter
2. Exact setting, time of day, lighting that reflects the spiritual theme
3. Photographic specs: ${viewpoint}, lens, aperture, color palette
4. End with: "Negative: nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, underwear, cleavage, ugly, deformed, noisy, blurry, bad anatomy, extra fingers, missing fingers, fused digits, distorted hands, watermarks, text, dark mood, despair, hopeless, studio lights, overexposed, low quality"

Output ONLY the prompt text.`;

    try {
        const r = await callMistral([{ role: 'system', content: sys }, { role: 'user', content: usr }]);
        return r.slice(0, 1800) || buildFallbackPrompt(article, gender, age, eth, viewpoint);
    } catch (e) {
        log(`  Mistral error for ${article.id}: ${e.message} — using fallback`);
        return buildFallbackPrompt(article, gender, age, eth, viewpoint);
    }
}

function buildFallbackPrompt(article, gender, age, eth, viewpoint) {
    const settings = [
        'a sunlit chapel with warm light streaming through stained-glass windows',
        'a peaceful hilltop at golden hour, open Bible on a weathered wooden bench',
        'a quiet forest clearing with dappled morning light filtering through ancient trees',
        'a cliff overlooking a vast ocean, arms raised in worship at sunrise',
        'a warm candlelit room with hands folded in prayer over an open scripture',
        'a stone church courtyard with warm evening light and blooming gardens',
        'a mountain summit at dawn, golden horizon stretching endlessly ahead',
    ];
    const setting = settings[article.id % settings.length];
    return `A ${age} ${eth} ${gender} fully clothed in modest attire, experiencing a profound moment of faith and spiritual renewal in ${setting}. ${viewpoint}, expression radiates deep conviction and quiet trust as warm golden light bathes the scene. Shot on 85mm f/2.0, shallow depth of field, rich amber and golden tones evoking spiritual warmth. Photorealistic, cinematic, 8K DSLR quality. Negative: nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, underwear, cleavage, ugly, deformed, noisy, blurry, bad anatomy, extra fingers, missing fingers, fused digits, distorted hands, watermarks, text, dark mood, despair, hopeless, studio lights, overexposed, low quality`;
}

// ── InspireCortex MidJourney API ──────────────────────────────────────────────

function icHeaders(extra = {}) {
    return { 'Authorization': `Bearer ${IC_JWT}`, ...extra };
}

function callMidjourneyGenerate(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ prompt, style_preset: 'cinematic', steps: 30, guidance_scale: 7.0, num_variations: 1 });
        const url  = new URL(`${IC_API_URL}/v1/midjourney/generate`);
        const isHttps = url.protocol === 'https:';
        const lib  = isHttps ? https : http;
        const opts = {
            hostname: url.hostname,
            port:     url.port || (isHttps ? 443 : 80),
            path:     url.pathname,
            method:   'POST',
            headers:  icHeaders({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
            timeout:  300000,
        };
        const req = lib.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`MJ generate HTTP ${res.statusCode}: ${d.slice(0, 300)}`));
                }
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(new Error(`MJ parse error: ${d.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('MidJourney request timed out (300s)')); });
        req.write(body);
        req.end();
    });
}

function downloadMidjourneyImage(minioKey, destPath) {
    return new Promise((resolve, reject) => {
        const encodedKey = minioKey.split('/').map(encodeURIComponent).join('/');
        const url  = new URL(`${IC_API_URL}/v1/midjourney/image/${encodedKey}`);
        const isHttps = url.protocol === 'https:';
        const lib  = isHttps ? https : http;
        const req  = lib.request({
            hostname: url.hostname,
            port:     url.port || (isHttps ? 443 : 80),
            path:     `${url.pathname}`,
            method:   'GET',
            headers:  icHeaders(),
            timeout:  30000,
        }, res => {
            if (res.statusCode !== 200) {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => reject(new Error(`MJ download HTTP ${res.statusCode}: ${d.slice(0, 100)}`)));
                return;
            }
            const out = fs.createWriteStream(destPath);
            res.pipe(out);
            out.on('finish', resolve);
            out.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('MJ image download timed out')); });
        req.end();
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    log('='.repeat(70));
    log('JubileeVerse — Faith Builders Images via Jubilee MidJourney Model');
    log(`IC API:  ${IC_API_URL}`);
    log(`JWT:     ${IC_JWT ? IC_JWT.slice(0, 30) + '...' : '(not set)'}`);
    log('='.repeat(70));

    if (!IC_JWT) {
        log('ERROR: INSPIRECORTEX_JWT is not set. Export it before running.');
        process.exit(1);
    }

    fs.mkdirSync(IMAGE_ROOT, { recursive: true });
    fs.mkdirSync(DEPRECATED_ROOT, { recursive: true });

    // 1. Fetch articles
    log('\n[1] Fetching Faith Builders articles...');
    const articles = await fetchArticles();
    log(`Found ${articles.length} articles`);

    // 2. Archive existing images
    log('\n[2] Archiving existing images...');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let archived = 0;
    for (const a of articles) {
        const src = path.join(IMAGE_ROOT, `${a.id}.jpg`);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(DEPRECATED_ROOT, `${a.id}_${ts}.jpg`));
            archived++;
        }
    }
    log(`Archived ${archived} existing images`);

    // 3. Generate prompts via Mistral
    log(`\n[3] Generating prompts via Mistral-7B for ${articles.length} articles...`);
    const jobs = [];
    const recentPrompts = [];

    for (let i = 0; i < articles.length; i++) {
        const a = articles[i];
        process.stdout.write(`  [${i+1}/${articles.length}] #${a.id} "${(a.title||'').slice(0,50)}" ... `);
        const prompt = await buildPrompt(a, i, recentPrompts);
        jobs.push({ id: a.id, prompt });
        recentPrompts.push(prompt);
        if (recentPrompts.length > 8) recentPrompts.shift();
        console.log('OK');
        if (i < articles.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    // 4. Generate images via MidJourney (one at a time — synchronous)
    log(`\n[4] Generating ${jobs.length} images via Jubilee MidJourney model...`);
    log('    (num_variations=1: exactly 1 image generated and saved per article)');
    log('    (~20s per article, total estimate: ' + Math.round(jobs.length * 20 / 60) + ' minutes)\n');

    let saved = 0, failed = 0;
    const failures = [];

    for (let i = 0; i < jobs.length; i++) {
        const { id, prompt } = jobs[i];
        const destPath = path.join(IMAGE_ROOT, `${id}.jpg`);
        const dbPath   = `/images/jubileeinspire.com/${CATEGORY_SLUG}/${id}.jpg`;

        try {
            log(`  [${i+1}/${jobs.length}] Generating #${id}...`);
            const mjResult = await callMidjourneyGenerate(prompt);
            const variation = mjResult.variations?.[0];
            if (!variation?.minio_key) throw new Error(`No variation in response: ${JSON.stringify(mjResult).slice(0, 200)}`);

            log(`    GPU done (${variation.gpu_time_ms}ms) — downloading...`);
            await downloadMidjourneyImage(variation.minio_key, destPath);

            const stat = fs.statSync(destPath);
            if (stat.size < 10000) throw new Error(`File too small: ${stat.size} bytes`);

            await updateArticleImage(id, dbPath);
            log(`  ✓ #${id}: saved (${Math.round(stat.size/1024)} KB)`);
            saved++;
        } catch (e) {
            log(`  ✗ #${id}: ${e.message}`);
            failures.push({ id, error: e.message });
            failed++;
        }
    }

    // 5. Summary
    log('\n' + '='.repeat(70));
    log('DONE');
    log(`Saved:  ${saved}/${jobs.length}`);
    log(`Failed: ${failed}`);
    if (failures.length > 0) {
        log('Failures:');
        failures.forEach(f => log(`  #${f.id}: ${f.error}`));
    }
    log('='.repeat(70));

    await pool.end();
}

main().catch(e => { log(`FATAL: ${e.message}`); pool.end().finally(() => process.exit(1)); });

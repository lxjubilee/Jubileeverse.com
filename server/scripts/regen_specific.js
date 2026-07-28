#!/usr/bin/env node
/**
 * One-off: regenerate images for specific article IDs using InspireCortex GPU HTTP API.
 * Usage: node scripts/regen_specific.js
 */
'use strict';

const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const https  = require('https');
const { Pool } = require('pg');

const TARGET_IDS = [1926, 1974, 1980, 1994, 2035, 2038, 2295];
const CATEGORY_SLUG    = 'faith-builders';
const IMAGE_ROOT       = path.join(__dirname, '..', 'public', 'images', 'jubileeinspire.com', CATEGORY_SLUG);
const MISTRAL_API_URL  = 'http://localhost:9001/v1/chat/completions';
const MISTRAL_MODEL    = 'mistral-7b-instruct';
const IC_API_URL       = process.env.INSPIRECORTEX_API_URL || 'http://localhost:8080';
const IC_JWT_TOKEN     = process.env.INSPIRECORTEX_JWT || '';

const DB_CONFIG = {
    host: 'localhost', port: 5433, database: 'jubileeverse',
    user: 'postgres', password: 'jubilee2026',
};

function log(msg) { console.error(`[${new Date().toISOString()}] ${msg}`); }

const pool = new Pool(DB_CONFIG);

function callMistral(messages) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ model: MISTRAL_MODEL, messages, max_tokens: 600, temperature: 0.7 });
        const url  = new URL(MISTRAL_API_URL);
        const req = http.request({
            hostname: url.hostname, port: url.port || 9001, path: url.pathname,
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d).choices?.[0]?.message?.content?.trim() || ''); }
                catch (e) { resolve(''); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function icRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(IC_API_URL);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const bodyStr = body ? JSON.stringify(body) : undefined;
        const headers = {
            'Authorization': `Bearer ${IC_JWT_TOKEN}`,
            'Content-Type': 'application/json',
        };
        if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
        const req = lib.request({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path,
            method,
            headers,
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
                catch (e) { reject(new Error(`IC parse error (status ${res.statusCode}): ${d.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

async function submitICJob(prompt) {
    const resp = await icRequest('POST', '/v1/images/generate', {
        prompt:          prompt.substring(0, 1800),
        negative_prompt: 'nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, underwear, cleavage, ugly, deformed, noisy, blurry, bad anatomy, extra fingers, missing fingers, fused digits, distorted hands, watermarks, text, dark mood, despair, crying, hopeless, studio lights, overexposed, low quality',
        model:           'juggernaut-xl',
        width:           1280,
        height:          720,
        steps:           35,
        guidance_scale:  5.0,
    });
    if (resp.status !== 200 && resp.status !== 201) {
        throw new Error(`IC generate failed (${resp.status}): ${JSON.stringify(resp.body).slice(0, 200)}`);
    }
    return resp.body.job_id;
}

async function pollICJob(jobId, timeoutMs = 300000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        const resp = await icRequest('GET', `/v1/jobs/${jobId}/status`, null);
        if (resp.status !== 200) {
            log(`  Poll error for ${jobId}: HTTP ${resp.status}`);
            continue;
        }
        const { status, error_message } = resp.body;
        if (status === 'completed') return true;
        if (status === 'failed')    { log(`  Job ${jobId} failed: ${error_message}`); return false; }
        log(`    ${jobId}: ${status}...`);
    }
    log(`  Timeout waiting for ${jobId}`);
    return false;
}

async function downloadICImage(jobId, destPath) {
    return new Promise((resolve, reject) => {
        const url = new URL(IC_API_URL);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const req = lib.request({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: `/v1/jobs/${jobId}/image`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${IC_JWT_TOKEN}` },
        }, res => {
            if (res.statusCode !== 200) {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => reject(new Error(`Download failed (${res.statusCode}): ${d.slice(0,100)}`)));
                return;
            }
            const out = fs.createWriteStream(destPath);
            res.pipe(out);
            out.on('finish', resolve);
            out.on('error', reject);
        });
        req.on('error', reject);
        req.end();
    });
}

const VIEWPOINTS = [
    'extreme close-up portrait, face and eyes only, razor-thin depth of field',
    'close-up portrait, head and shoulders, facial expression the focal point',
    'medium shot, waist-up, hands and upper body gesture clearly visible',
    'three-quarter shot, knees to head, full posture and body language visible',
    'full-body shot, complete figure from head to toe',
    'wide environmental portrait, subject in lower third, expansive setting',
];
const ETHNICITIES = ['Caucasian', 'African-American', 'Hispanic', 'Asian', 'Middle Eastern', 'South Asian', 'Mixed-race'];
const GENDERS     = ['man', 'woman', 'person'];
const AGES        = ['young adult (20s)', 'adult (30s–40s)', 'middle-aged (50s)', 'senior (60s+)'];

function buildPrompt(article, slot) {
    const eth      = ETHNICITIES[slot % ETHNICITIES.length];
    const gender   = GENDERS[slot % GENDERS.length];
    const age      = AGES[slot % AGES.length];
    const viewpoint = VIEWPOINTS[slot % VIEWPOINTS.length];
    const excerpt  = (article.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);

    const sys = `You are a professional cinematic art director for a faith-based devotional website. Write ONE precise, emotionally uplifting image prompt for the Juggernaut Ragnarok photorealistic model.

RULES:
- Image must feel uplifting, warm, encouraging — show breakthrough, peace, or joy
- Format: 16:9 cinematic landscape, photorealistic, editorial photography
- Subject: ${gender} (${age}), ${eth} ethnicity
- Camera framing: ${viewpoint}
- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.
- No text, watermarks, logos
TONE: Photorealistic, cinematic, 8K DSLR quality, natural lighting.`;

    const usr = `Article: "${article.title}"
${excerpt}

Write ONE image prompt (3-4 sentences):
1. Describe subject, action, emotional expression at a moment of joy or breakthrough
2. Specify exact setting, time of day, lighting
3. List photographic specs: ${viewpoint}, lens, aperture, color palette
4. End with: "Negative: nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, underwear, cleavage, ugly, deformed, noisy, blurry, bad anatomy, extra fingers, missing fingers, fused digits, distorted hands, watermarks, text, dark mood, despair, crying, hopeless, studio lights, overexposed, low quality"

Output ONLY the prompt text.`;

    return callMistral([{ role: 'system', content: sys }, { role: 'user', content: usr }])
        .then(r => r || `A ${age} ${eth} ${gender} fully clothed in modest attire, experiencing peaceful joy and spiritual renewal, ${viewpoint}. Photorealistic, cinematic, 8K DSLR, golden-hour lighting. Negative: nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, underwear, cleavage, ugly, deformed, noisy, blurry, bad anatomy, extra fingers, missing fingers, watermarks, text, dark mood, despair, hopeless, studio lights, low quality.`)
        .catch(() => `A ${age} ${eth} ${gender} fully clothed in modest attire, experiencing peaceful joy and spiritual renewal, ${viewpoint}. Photorealistic, cinematic, 8K DSLR, golden-hour lighting. Negative: nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, underwear, cleavage, ugly, deformed, noisy, blurry, bad anatomy, extra fingers, missing fingers, watermarks, text, dark mood, despair, hopeless, studio lights, low quality.`);
}

async function main() {
    log(`Regenerating ${TARGET_IDS.length} images: ${TARGET_IDS.join(', ')}`);
    log(`Using IC API: ${IC_API_URL}`);
    fs.mkdirSync(IMAGE_ROOT, { recursive: true });

    const result = await pool.query(`SELECT id, title, content FROM articles WHERE id = ANY($1)`, [TARGET_IDS]);
    const articles = result.rows;

    log(`Building prompts for ${articles.length} articles...`);
    const prompts = [];
    for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        const prompt  = await buildPrompt(article, i);
        prompts.push({ id: article.id, prompt });
        log(`  Prompt for ${article.id}: ${prompt.slice(0, 80)}...`);
    }

    log(`Submitting ${prompts.length} jobs to IC GPU...`);
    let saved = 0, failed = 0;

    for (const p of prompts) {
        try {
            log(`  Submitting job for article ${p.id}...`);
            const jobId = await submitICJob(p.prompt);
            log(`  Job ${jobId} queued for article ${p.id}, polling...`);

            const ok = await pollICJob(jobId);
            if (!ok) { log(`  ✗ ${p.id}: job failed or timed out`); failed++; continue; }

            const finalPath = path.join(IMAGE_ROOT, `${p.id}.jpg`);
            await downloadICImage(jobId, finalPath);

            const stat = fs.statSync(finalPath);
            if (stat.size < 10000) { log(`  ✗ ${p.id}: file too small (${stat.size} bytes)`); failed++; continue; }

            await pool.query(
                `UPDATE articles SET hero_image_path = $1, hero_image_status = 'generated',
                 hero_image_provider = 'local_gpu', hero_image_model = 'juggernautXL_ragnarokBy',
                 hero_image_generated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [`/images/jubileeinspire.com/${CATEGORY_SLUG}/${p.id}.jpg`, p.id]
            );
            log(`  ✓ ${p.id}: saved (${Math.round(stat.size/1024)} KB)`);
            saved++;
        } catch (e) {
            log(`  ✗ ${p.id}: ${e.message}`);
            failed++;
        }
    }

    log(`\nDone. Saved: ${saved}, Failed: ${failed}`);
    await pool.end();
}

main().catch(e => { log(`Fatal: ${e.message}`); process.exit(1); });

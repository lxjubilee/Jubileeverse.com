#!/usr/bin/env node
/**
 * Regenerate all remaining jubileeinspire.com category images using the Jubilee MidJourney model.
 *
 * Processes categories sequentially (one at a time) so the GPU isn't overloaded.
 * Skips encouragement and faith-builders which are already regenerated.
 *
 * Uses:
 *   - Mistral-7B-Instruct at localhost:9001 for cinematic prompt generation
 *   - InspireCortex /v1/midjourney/generate (synchronous, ~17-20s per image)
 *   - Juggernaut XL v9 + ESRGAN 4x upscaling
 *
 * Run: node scripts/regen_ji_all_mj.js
 * Run single: node scripts/regen_ji_all_mj.js overcoming-obstacles
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path  = require('path');
const fs    = require('fs');
const http  = require('http');
const https = require('https');
const { Pool } = require('pg');

// ── Category definitions ───────────────────────────────────────────────────────
// Each entry: [categoryId, imageSlug, promptStyle, displayName]
// imageSlug = directory name used in hero_image_path (may differ from DB slug)
// promptStyle controls the Mistral system prompt tone

const CATEGORIES = [
    [64595, 'overcoming-obstacles',  'resilience',     'Overcoming Obstacles'],
    [64593, 'hope-restored',         'hope',           'Hope Restored'],
    [64589, 'motivational-messages', 'motivational',   'Motivational Messages'],
    [64588, 'inspirational-stories', 'stories',        'Inspirational Stories'],
    [64597, 'lets-celebrate',        'celebration',    'Lets Celebrate'],
    [64599, 'live-inspired',         'inspired',       'Live Inspired'],
    [64594, 'positive-living',       'positive',       'Positive Living'],
    [64598, 'purpose-driven',        'purpose',        'Purpose Driven'],
    [64591, 'uplifting-content',     'uplifting',      'Uplifting Content'],
    [64596, 'victory-stories',       'victory',        'Victory Stories'],
];

// Filter to a single category if passed as CLI arg
const filterSlug = process.argv[2] || null;
const ACTIVE_CATEGORIES = filterSlug
    ? CATEGORIES.filter(([, slug]) => slug === filterSlug)
    : CATEGORIES;

if (filterSlug && ACTIVE_CATEGORIES.length === 0) {
    console.error(`Unknown category slug: ${filterSlug}`);
    console.error(`Valid slugs: ${CATEGORIES.map(c => c[1]).join(', ')}`);
    process.exit(1);
}

// ── Prompt style system prompts ────────────────────────────────────────────────

const STYLE_PROMPTS = {
    resilience: {
        sys: 'You are a professional cinematic art director for a Christian resilience website. Write ONE precise, emotionally powerful image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST show perseverance, breakthrough, triumph over adversity, or resilient hope\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, natural lighting. Resilient and victorious.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject at a moment of breakthrough or triumphant perseverance\n2. Setting, time of day, lighting that reflects resilience and hope\n3. Photographic specs: {viewpoint}, lens, aperture, color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, dark despair, hopeless, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a mountain summit at dawn with golden light breaking through stormy clouds',
            'a runner crossing a finish line with hands raised in triumph at sunset',
            'a person standing strong on a rocky cliff overlooking a vast valley',
            'a sunlit road stretching forward through a dense forest clearing',
            'a crowded stadium finish line with warm light and cheering crowds',
            'a quiet garden with broken chains on the ground and open sky above',
            'a misty hilltop at sunrise, solitary figure arms raised in victory',
        ],
    },
    hope: {
        sys: 'You are a professional cinematic art director for a Christian hope-restoration website. Write ONE precise, emotionally healing image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST convey restored hope, healing, peaceful expectation, or gentle renewal\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, soft warm natural lighting. Peaceful and healing.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject experiencing a quiet, hopeful moment of renewal or restored peace\n2. Serene setting, soft lighting, time of day that evokes hope\n3. Photographic specs: {viewpoint}, lens, aperture, soft warm color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, despair, crying, hopeless, dark, gloomy, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a peaceful meadow at sunrise with soft golden light and morning mist',
            'a lighthouse on a calm sea at dusk with warm amber light',
            'a cozy reading nook with warm lamplight and a vase of fresh flowers',
            'a garden in full bloom with gentle sunlight filtering through petals',
            'a wooden dock on a still lake at sunrise with golden reflections',
            'a hilltop with wildflowers and a wide blue sky at golden hour',
            'a sunlit forest path with rays of light breaking through the canopy',
        ],
    },
    motivational: {
        sys: 'You are a professional cinematic art director for a Christian motivational website. Write ONE precise, energizing image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST feel motivating, determined, ambitious, or energetically purposeful\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, dynamic natural lighting. Energetic and inspiring.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject in a powerful, determined, or purposeful action\n2. Dynamic setting and lighting that energizes and motivates\n3. Photographic specs: {viewpoint}, lens, aperture, bold warm color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, defeated, hopeless, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a city skyline at dawn viewed from a rooftop, person looking forward with purpose',
            'a running track at sunrise with a determined athlete in full stride',
            'a whiteboard full of goals and plans in a bright sunlit office',
            'a mountain trail with a hiker looking toward the summit at golden hour',
            'a library at night with warm desk lamps and an open notebook',
            'a sunrise over an open highway, person standing beside a car looking ahead',
            'a modern gym at early morning, person lifting weights in focused effort',
        ],
    },
    stories: {
        sys: 'You are a professional cinematic art director for a Christian inspirational stories website. Write ONE precise, story-driven image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST convey a real human story — authentic emotion, transformation, or meaningful encounter\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, authentic warm lighting. Genuine and emotionally resonant.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject in a genuine, story-filled moment of transformation or meaningful emotion\n2. Authentic setting that evokes real-life depth and warmth\n3. Photographic specs: {viewpoint}, lens, aperture, warm documentary color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, staged, fake, hopeless, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a kitchen table with two people sharing a warm conversation over coffee',
            'a community center with diverse group of people sharing stories together',
            'a porch swing at sunset with a person writing in a journal thoughtfully',
            'an old photo album open on a wooden table with warm afternoon light',
            'a hospital room with soft sunlight and a person holding someone\'s hand warmly',
            'a church fellowship hall with people gathered in authentic conversation',
            'a park bench at dusk with a person in quiet, peaceful reflection',
        ],
    },
    celebration: {
        sys: 'You are a professional cinematic art director for a Christian celebration website. Write ONE precise, joyful image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST radiate joy, celebration, milestone achievement, or festive gratitude\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, bright joyful lighting. Celebratory and uplifting.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject in a joyful celebration or milestone achievement moment\n2. Festive, warm setting with bright, celebratory lighting\n3. Photographic specs: {viewpoint}, lens, aperture, vibrant warm color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, sad, hopeless, dark, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a backyard celebration with streamers, warm string lights, and joyful smiles',
            'a graduation cap toss in bright sunlight with golden confetti',
            'a family gathered around a table with a celebration cake and warm light',
            'a sunset beach with someone jumping joyfully with arms raised high',
            'a living room decorated for a milestone birthday with warm candlelight',
            'a church courtyard celebration with flowers, warm light, and joyful people',
            'a park picnic celebration with colorful blankets and laughing friends',
        ],
    },
    inspired: {
        sys: 'You are a professional cinematic art director for a Christian live-inspired website. Write ONE precise, vibrant, adventure-filled image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST convey living fully, inspired purpose, everyday adventure, or vibrant daily life\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, vivid natural lighting. Vibrant and alive.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject fully alive in an inspired, purposeful, or adventurous moment\n2. Vivid, beautiful setting with dynamic lighting that celebrates life\n3. Photographic specs: {viewpoint}, lens, aperture, vivid vibrant color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, dull, sad, hopeless, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a coastal path at sunrise with a person walking freely with open arms',
            'a vibrant city street market with warm afternoon light and colorful stalls',
            'a rooftop garden at golden hour with a person tending bright flowers',
            'a kayak on a crystal clear mountain lake at dawn with misty reflections',
            'a bicycle ride through a blooming spring countryside at golden hour',
            'a hilltop yoga session at sunrise with a wide panoramic view',
            'a creative studio with warm natural light, plants, and an engaged artist',
        ],
    },
    positive: {
        sys: 'You are a professional cinematic art director for a Christian positive-living website. Write ONE precise, uplifting image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST radiate positivity, wellness, gratitude, or joyful contentment in everyday life\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, warm soft natural lighting. Warm and content.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject in a positive, grateful, or contentedly joyful moment of everyday life\n2. Warm, inviting setting with soft lighting that radiates positivity\n3. Photographic specs: {viewpoint}, lens, aperture, warm golden color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, negative, sad, gloomy, hopeless, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a morning routine with a person journaling at a sunlit window with warm tea',
            'a community garden with bright vegetables and a person smiling contentedly',
            'a yoga mat on a balcony overlooking a city at sunrise, peaceful stretching',
            'a kitchen scene with healthy food preparation and warm afternoon light',
            'a park walk in autumn leaves with warm golden afternoon light',
            'a cozy coffee shop with a person reading and smiling at golden hour',
            'a home office with plants, natural light, and a person working joyfully',
        ],
    },
    purpose: {
        sys: 'You are a professional cinematic art director for a Christian purpose-driven website. Write ONE precise, calling-focused image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST convey clarity of calling, mission, intentional purpose, or destiny-driven focus\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, confident natural lighting. Purposeful and directed.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject focused on their calling or purpose with clarity and conviction\n2. Setting that amplifies the sense of mission and intentional direction\n3. Photographic specs: {viewpoint}, lens, aperture, clean purposeful color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, aimless, confused, hopeless, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a person at a standing desk with a clear vision board and morning light',
            'a mentor and student engaged in focused conversation at a wooden table',
            'a medical professional in warm scrubs helping a patient with genuine care',
            'a teacher in a bright classroom engaged passionately with students',
            'a community leader speaking to a small group in an outdoor setting at dusk',
            'a person planting a tree with intention and care in a community garden',
            'a professional presenting confidently to a small engaged team in natural light',
        ],
    },
    uplifting: {
        sys: 'You are a professional cinematic art director for a Christian uplifting content website. Write ONE precise, mood-lifting image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST uplift, encourage, and radiate warmth, beauty, or gentle joy\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, warm inviting natural lighting. Warm and uplifting.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject in a gentle, uplifting, or warmly encouraging moment\n2. Beautiful, inviting setting with warm light\n3. Photographic specs: {viewpoint}, lens, aperture, soft warm color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, sad, dark, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a sunlit porch with hanging flower baskets and a person reading peacefully',
            'a bright window seat with warm light and a cup of tea and open book',
            'a country road lined with blooming trees at golden hour',
            'a waterfall in a lush green forest with soft mist and morning light',
            'a rooftop terrace with city views at dusk and warm string lights',
            'a flower market at sunrise with vibrant colors and warm early light',
            'a community table with diverse friends sharing a warm meal together',
        ],
    },
    victory: {
        sys: 'You are a professional cinematic art director for a Christian victory stories website. Write ONE precise, triumphant image prompt for the Juggernaut Ragnarok photorealistic model.\n\nRULES:\n- Image MUST convey triumph, hard-won victory, comeback, or the joy of overcoming\n- Format: 16:9 cinematic landscape, photorealistic, editorial photography\n- Subject: {gender} ({age}), {ethnicity} ethnicity\n- Camera framing: {viewpoint}\n- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, appropriate attire. NEVER nudity, bare skin, revealing clothing, or sexual content.\n- No text, watermarks, logos\n{recentBlock}\nTONE: Photorealistic, cinematic, 8K DSLR quality, golden triumphant lighting. Victorious and joyful.',
        usr: 'Article: "{title}"\n{excerpt}\n\nWrite ONE image prompt (3-4 sentences):\n1. Subject in a triumphant, victorious, or comeback moment full of earned joy\n2. Setting with dramatic, golden, or hopeful lighting that magnifies the triumph\n3. Photographic specs: {viewpoint}, lens, aperture, rich golden warm color palette\n4. End with: "Negative: nsfw, nude, naked, bare skin, explicit, sexual content, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, defeated, hopeless, dark, low quality"\n\nOutput ONLY the prompt text.',
        fallbackSettings: [
            'a marathon finish line at golden hour with arms raised in triumph',
            'a boxing ring at sunrise with a fighter standing tall after a hard round',
            'a graduation stage with a person holding their diploma in golden light',
            'a stadium podium at sunset with a person accepting an award joyfully',
            'a mountain summit at dawn with a triumphant person overlooking the valley',
            'a recovery room with a patient taking their first steps with warm light',
            'a business launch moment with a team celebrating in a sunlit office',
        ],
    },
};

// ── Infrastructure (shared from regen_faith_builders_mj.js pattern) ──────────

const DB_CONFIG = {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME     || 'jubileeverse',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'jubilee2026',
};

const IC_API_URL = process.env.INSPIRECORTEX_API_URL || 'http://localhost:8080';
const IC_JWT     = process.env.INSPIRECORTEX_JWT || '';

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

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function icHeaders(extra = {}) {
    return { 'Authorization': `Bearer ${IC_JWT}`, ...extra };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function makePool() { return new Pool(DB_CONFIG); }

async function fetchArticles(pool, categoryId) {
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
    `, [categoryId]);
    return rows;
}

async function updateArticleImage(pool, articleId, imagePath) {
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
        const req  = http.request({
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

async function buildPrompt(article, slot, style, recentPrompts) {
    const eth       = DEMOGRAPHICS.ethnicity[slot % DEMOGRAPHICS.ethnicity.length];
    const gender    = DEMOGRAPHICS.gender[slot % DEMOGRAPHICS.gender.length];
    const age       = DEMOGRAPHICS.age[slot % DEMOGRAPHICS.age.length];
    const viewpoint = DEMOGRAPHICS.viewpoint[slot % DEMOGRAPHICS.viewpoint.length];
    const excerpt   = (article.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);

    const recentBlock = recentPrompts.length > 0
        ? `\nRECENT IMAGES (yours MUST differ in setting, subject, color tone):\n${recentPrompts.slice(-5).map((p, i) => `  [${i+1}] ${p.slice(0, 100)}`).join('\n')}\n`
        : '';

    const fill = s => s
        .replace('{gender}', gender)
        .replace('{age}', age)
        .replace('{ethnicity}', eth)
        .replace('{viewpoint}', viewpoint)
        .replace('{recentBlock}', recentBlock);

    const sys = fill(style.sys);
    const usr = fill(style.usr)
        .replace('{title}', (article.title || '').slice(0, 80))
        .replace('{excerpt}', excerpt);

    try {
        const r = await callMistral([{ role: 'system', content: sys }, { role: 'user', content: usr }]);
        return r.slice(0, 1800) || buildFallbackPrompt(article, gender, age, eth, viewpoint, style);
    } catch (e) {
        log(`  Mistral error for #${article.id}: ${e.message} — using fallback`);
        return buildFallbackPrompt(article, gender, age, eth, viewpoint, style);
    }
}

function buildFallbackPrompt(article, gender, age, eth, viewpoint, style) {
    const setting = style.fallbackSettings[article.id % style.fallbackSettings.length];
    return `A ${age} ${eth} ${gender} fully clothed in modest attire in ${setting}. ${viewpoint}, expression radiates genuine emotion and warm vitality as golden light bathes the scene. Shot on 85mm f/2.0, shallow depth of field, rich warm tones. Photorealistic, cinematic, 8K DSLR quality. Negative: nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, ugly, deformed, blurry, bad anatomy, extra fingers, watermarks, text, dark, hopeless, low quality`;
}

// ── InspireCortex MidJourney API ──────────────────────────────────────────────

function callMidjourneyGenerate(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ prompt, style_preset: 'cinematic', steps: 30, guidance_scale: 7.0, num_variations: 1 });
        const url  = new URL(`${IC_API_URL}/v1/midjourney/generate`);
        const isHttps = url.protocol === 'https:';
        const lib  = isHttps ? https : http;
        const req  = lib.request({
            hostname: url.hostname,
            port:     url.port || (isHttps ? 443 : 80),
            path:     url.pathname,
            method:   'POST',
            headers:  icHeaders({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
            timeout:  300000,
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`MJ generate HTTP ${res.statusCode}: ${d.slice(0, 300)}`));
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(new Error(`MJ parse error: ${d.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('MidJourney timed out (300s)')); });
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
            path:     url.pathname,
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
        req.on('timeout', () => { req.destroy(); reject(new Error('MJ download timed out')); });
        req.end();
    });
}

// ── Process one category ──────────────────────────────────────────────────────

async function processCategory(categoryId, imageSlug, promptStyle, displayName) {
    const pool         = makePool();
    const IMAGE_ROOT   = path.join(__dirname, '..', 'public', 'images', 'jubileeinspire.com', imageSlug);
    const DEPRECATED_ROOT = path.join(__dirname, '..', 'public', 'images', 'deprecated', 'jubileeinspire.com', imageSlug);
    const style        = STYLE_PROMPTS[promptStyle];

    log('='.repeat(70));
    log(`Category: ${displayName} (ID: ${categoryId}, slug: ${imageSlug})`);
    log(`IC API:   ${IC_API_URL}`);
    log('='.repeat(70));

    fs.mkdirSync(IMAGE_ROOT, { recursive: true });
    fs.mkdirSync(DEPRECATED_ROOT, { recursive: true });

    // 1. Fetch articles
    log(`\n[1] Fetching ${displayName} articles...`);
    const articles = await fetchArticles(pool, categoryId);
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

    // 3. Generate prompts
    log(`\n[3] Generating prompts via Mistral-7B for ${articles.length} articles...`);
    const jobs = [];
    const recentPrompts = [];
    for (let i = 0; i < articles.length; i++) {
        const a = articles[i];
        process.stdout.write(`  [${i+1}/${articles.length}] #${a.id} "${(a.title || '').slice(0, 50)}" ... `);
        const prompt = await buildPrompt(a, i, style, recentPrompts);
        jobs.push({ id: a.id, prompt });
        recentPrompts.push(prompt);
        if (recentPrompts.length > 8) recentPrompts.shift();
        console.log('OK');
        if (i < articles.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    // 4. Generate images
    log(`\n[4] Generating ${jobs.length} images via Jubilee MidJourney model...`);
    log(`    (~20s per article, estimate: ${Math.round(jobs.length * 20 / 60)} minutes)\n`);

    let saved = 0, failed = 0;
    const failures = [];
    for (let i = 0; i < jobs.length; i++) {
        const { id, prompt } = jobs[i];
        const destPath = path.join(IMAGE_ROOT, `${id}.jpg`);
        const dbPath   = `/images/jubileeinspire.com/${imageSlug}/${id}.jpg`;
        try {
            log(`  [${i+1}/${jobs.length}] Generating #${id}...`);
            const mjResult  = await callMidjourneyGenerate(prompt);
            const variation = mjResult.variations?.[0];
            if (!variation?.minio_key) throw new Error(`No variation: ${JSON.stringify(mjResult).slice(0, 200)}`);
            log(`    GPU done (${variation.gpu_time_ms}ms) — downloading...`);
            await downloadMidjourneyImage(variation.minio_key, destPath);
            const stat = fs.statSync(destPath);
            if (stat.size < 10000) throw new Error(`File too small: ${stat.size} bytes`);
            await updateArticleImage(pool, id, dbPath);
            log(`  ✓ #${id}: saved (${Math.round(stat.size / 1024)} KB)`);
            saved++;
        } catch (e) {
            log(`  ✗ #${id}: ${e.message}`);
            failures.push({ id, error: e.message });
            failed++;
        }
    }

    log('\n' + '='.repeat(70));
    log(`${displayName} — DONE: Saved ${saved}/${jobs.length}, Failed ${failed}`);
    if (failures.length) failures.forEach(f => log(`  FAILED #${f.id}: ${f.error}`));
    log('='.repeat(70) + '\n');

    await pool.end();
    return { saved, failed, total: jobs.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    if (!IC_JWT) {
        console.error('ERROR: INSPIRECORTEX_JWT not set.');
        process.exit(1);
    }

    log('JubileeVerse — Regenerating all jubileeinspire.com categories with Jubilee MidJourney');
    log(`Processing ${ACTIVE_CATEGORIES.length} categor${ACTIVE_CATEGORIES.length === 1 ? 'y' : 'ies'}: ${ACTIVE_CATEGORIES.map(c => c[1]).join(', ')}`);

    const summary = [];
    for (const [catId, slug, style, name] of ACTIVE_CATEGORIES) {
        const result = await processCategory(catId, slug, style, name);
        summary.push({ name, ...result });
    }

    log('\n' + '='.repeat(70));
    log('ALL CATEGORIES COMPLETE');
    summary.forEach(s => log(`  ${s.name}: ${s.saved}/${s.total} saved, ${s.failed} failed`));
    log('='.repeat(70));
}

main().catch(e => { console.error(`FATAL: ${e.message}`); process.exit(1); });

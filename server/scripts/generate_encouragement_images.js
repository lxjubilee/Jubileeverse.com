/**
 * Encouragement Category Image Regeneration Pipeline
 *
 * Uses:
 *   - Mistral-7B-Instruct at localhost:9001 (vLLM, OpenAI-compatible) for prompt analysis
 *   - Juggernaut Ragnarok (juggernautXL_ragnarokBy.safetensors) via images-worker Docker container
 *   - RTX 5090 GPU in InspireCortex workspace
 *
 * Flow:
 *   1. Fetch all Encouragement articles from jubileeverse DB
 *   2. Generate cinematic, uplifting prompts via Mistral-7B
 *   3. Archive existing images to deprecated folder
 *   4. Run batch generation inside the images-worker container
 *   5. Copy generated images to correct location
 *   6. Web-optimize (resize + JPEG compress)
 *   7. Update DB records
 *   8. Validate and report
 *
 * Run: node scripts/generate_encouragement_images.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Pool }    = require('pg');
const { execSync, spawnSync } = require('child_process');
const fs          = require('fs');
const path        = require('path');
const https       = require('https');
const http        = require('http');

// ── Config ───────────────────────────────────────────────────────────────────

const ENCOURAGEMENT_CATEGORY_ID = 64590;   // L2 — Encouragement under jubileeinspire.com (64148)
const IMAGE_ROOT       = path.join(__dirname, '..', 'public', 'images', 'jubileeinspire.com', 'encouragement');
const DEPRECATED_ROOT  = path.join(__dirname, '..', 'public', 'images', 'deprecated', 'jubileeinspire.com', 'encouragement');
const MISTRAL_API_URL  = 'http://localhost:9001/v1/chat/completions';
const MISTRAL_MODEL    = 'mistral-7b-instruct';
const WORKER_CONTAINER = 'inspirecortex-images-worker-1';
const BATCH_INPUT      = '/tmp/jubilee_batch.json';
const BATCH_OUTPUT_DIR = '/tmp/jubilee_output';
const RESULTS_FILE     = '/tmp/jubilee_results.json';
const BATCH_SIZE       = 20;        // articles per docker exec batch (to limit memory pressure)
const THROTTLE_MS      = 5000;      // ms between batches
const MAX_IMG_WIDTH    = 1600;      // max px for web delivery

// Demographic rotation pools — used to ensure global diversity
const DEMOGRAPHICS = {
    ethnicity: ['Black', 'White', 'Asian', 'Hispanic', 'Middle Eastern', 'South Asian', 'East African', 'Indigenous Australian', 'European', 'Latin American'],
    age:       ['young adult (mid-20s)', 'adult (mid-30s)', 'middle-aged (late 40s)', 'elderly (70s)', 'teenager (16-17)'],
    gender:    ['woman', 'man', 'elderly woman', 'elderly man', 'teenage girl', 'teenage boy'],
    viewpoint: [
        'extreme close-up portrait, face and eyes only, deeply intimate, razor-thin depth of field',
        'close-up portrait, head and shoulders, facial expression the focal point',
        'medium shot, waist-up, hands and upper body gesture clearly visible',
        'three-quarter shot, knees to head, full posture and body language visible',
        'full-body shot, complete figure from head to toe, ample environment visible around them',
        'wide environmental portrait, subject occupies lower third, expansive setting dominates the frame',
    ],
};

const pgPool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME     || 'jubileeverse',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'jubilee2026',
});

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${msg}`);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchEncouragementArticles() {
    const result = await pgPool.query(`
        WITH RECURSIVE cat_tree AS (
            SELECT id FROM categories WHERE id = $1
            UNION ALL
            SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_id = ct.id
        )
        SELECT a.id, a.title, a.summary, a.content, a.hero_image_path
        FROM articles a
        WHERE a.category_id IN (SELECT id FROM cat_tree)
          AND a.content IS NOT NULL AND a.content != ''
        ORDER BY a.id ASC
    `, [ENCOURAGEMENT_CATEGORY_ID]);

    return result.rows;
}

async function updateArticleImage(articleId, imagePath) {
    await pgPool.query(`
        UPDATE articles SET
            hero_image_path    = $1,
            hero_image_status  = 'generated',
            hero_image_provider = 'local_gpu',
            hero_image_model   = 'juggernautXL_ragnarokBy',
            hero_image_generated_at = CURRENT_TIMESTAMP,
            updated_at         = CURRENT_TIMESTAMP
        WHERE id = $2
    `, [imagePath, articleId]);
}

// ── Mistral prompt generation ─────────────────────────────────────────────────

function callMistral(messages) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: MISTRAL_MODEL,
            messages,
            max_tokens: 600,
            temperature: 0.7,
        });

        const url  = new URL(MISTRAL_API_URL);
        const opts = {
            hostname: url.hostname,
            port:     url.port || 9001,
            path:     url.pathname,
            method:   'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.choices?.[0]?.message?.content || '';
                    resolve(text.trim());
                } catch (e) {
                    reject(new Error(`Mistral parse error: ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/**
 * Build a diverse, uplifting image prompt using Mistral-7B.
 * demographicSlot: index into the DEMOGRAPHICS pools for this article
 */
async function generatePrompt(article, demographicSlot, recentPrompts) {
    const plainText = (article.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const excerpt   = plainText.substring(0, 2000);

    // Select demographic for this slot
    const eth       = DEMOGRAPHICS.ethnicity[demographicSlot % DEMOGRAPHICS.ethnicity.length];
    const gender    = DEMOGRAPHICS.gender[demographicSlot % DEMOGRAPHICS.gender.length];
    const age       = DEMOGRAPHICS.age[demographicSlot % DEMOGRAPHICS.age.length];
    const viewpoint = DEMOGRAPHICS.viewpoint[demographicSlot % DEMOGRAPHICS.viewpoint.length];

    const recentBlock = recentPrompts.length > 0
        ? `\nRECENT IMAGES (yours must differ significantly in setting, subject, and color tone):\n${recentPrompts.slice(-5).map((p, i) => `  [${i+1}] ${p.substring(0, 120)}`).join('\n')}\n`
        : '';

    const systemPrompt = `You are a professional cinematic art director for a faith-based devotional website called jubileeinspire.com. Your task is to write ONE precise, emotionally uplifting image generation prompt for the Juggernaut Ragnarok photorealistic model.

RULES:
- The image MUST feel uplifting, warm, and encouraging — even if the article discusses hardship, the image must show breakthrough, comfort, peace, or joy
- Never depict sorrow, despair, crying alone, or hopeless situations as the primary mood
- Format: 16:9 cinematic landscape, photorealistic, editorial-quality photography aesthetic
- Use natural lighting (golden hour, soft daylight, or candlelight)
- Subject MUST be a ${gender} (${age}), ${eth} ethnicity
- Camera framing: ${viewpoint}
- Vary settings: sometimes outdoors (parks, mountains, beaches, farms), sometimes meaningful interiors (kitchens, churches, community halls, markets), sometimes symbolic objects alone
- No text, watermarks, or logos in the image
- Include hand anatomy guidance only if hands are visible: "five fingers per hand, anatomically correct"
- SAFETY (MANDATORY): ALL subjects MUST be fully clothed in modest, culturally appropriate attire. NEVER generate nudity, bare skin, revealing clothing, sexual content, or suggestive poses under any circumstances.
${recentBlock}
TONE: Photorealistic, cinematic, 8K, DSLR quality, natural lighting, emotionally compelling.`;

    const userPrompt = `Article title: "${article.title}"
Article excerpt: ${excerpt}

Write ONE image prompt (3-4 sentences) that:
1. Describes the central subject, their action, and emotional expression at a moment of breakthrough or joy
2. Specifies the exact setting (environment, time of day, lighting conditions)
3. Lists the photographic specs: ${viewpoint}, lens type, aperture, color palette
4. Ends with: "Negative: nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, underwear, cleavage, ugly, deformed, noisy, blurry, bad anatomy, extra fingers, missing fingers, fused digits, distorted hands, watermarks, text, dark mood, despair, crying, hopeless, studio lights, overexposed, low quality"

Output ONLY the prompt text — no preamble, no headers, no explanation.`;

    try {
        const response = await callMistral([
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
        ]);

        // Ensure it doesn't exceed model limits
        return response.substring(0, 1800);
    } catch (err) {
        log(`  Mistral error for article ${article.id}: ${err.message} — using fallback`);
        return buildFallbackPrompt(article, gender, age, eth, viewpoint);
    }
}

function buildFallbackPrompt(article, gender, age, eth, viewpoint) {
    const settings = [
        'a sun-drenched community garden with vibrant flowers and warm afternoon light',
        'a peaceful wooden porch overlooking rolling green hills at golden hour',
        'a bright modern kitchen with warm sunlight streaming through large windows',
        'a coastal cliff path with azure ocean below and clear blue skies',
        'a lush mountain meadow with wildflowers under soft morning light',
        'a welcoming church courtyard with warm stone walls and hanging lanterns',
        'a farmer\'s market with colorful produce and joyful community atmosphere',
        'a quiet library reading nook with warm lamplight and open Bible',
    ];
    const setting  = settings[article.id % settings.length];
    const vpStr    = viewpoint || 'medium shot, waist-up';

    return `A ${age} ${eth} ${gender} fully clothed in modest attire, experiencing a moment of peaceful joy and spiritual renewal in ${setting}. ${vpStr}, their expression radiates gratitude and quiet strength as warm golden-hour light bathes the scene at 5500K. Shot on 85mm f/2.0 lens, shallow depth of field separating the subject from a softly blurred background, rich warm color palette with amber and gold tones. Photorealistic, cinematic, 8K DSLR quality, natural lighting, emotionally compelling. Negative: nsfw, nude, naked, bare skin, topless, explicit, sexual content, revealing clothing, underwear, cleavage, ugly, deformed, noisy, blurry, bad anatomy, extra fingers, missing fingers, fused digits, distorted hands, watermarks, text, dark mood, despair, crying, hopeless, studio lights, overexposed, low quality`;
}

// ── Archive helpers ───────────────────────────────────────────────────────────

function archiveExistingImages(articles) {
    fs.mkdirSync(DEPRECATED_ROOT, { recursive: true });
    let archived = 0;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    for (const article of articles) {
        const localPath = path.join(IMAGE_ROOT, `${article.id}.jpg`);
        if (fs.existsSync(localPath)) {
            const archivePath = path.join(DEPRECATED_ROOT, `${article.id}_${ts}.jpg`);
            fs.copyFileSync(localPath, archivePath);
            archived++;
        }
    }

    log(`Archived ${archived} existing images to ${DEPRECATED_ROOT}`);
    return archived;
}

// ── Docker exec helpers ───────────────────────────────────────────────────────

function dockerExec(cmd, description) {
    const result = spawnSync('docker', ['exec', WORKER_CONTAINER, 'sh', '-c', cmd], {
        encoding: 'utf8',
        timeout:  60 * 60 * 1000,   // 1 hour max
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`docker exec failed (${description}): ${result.stderr?.slice(0, 500)}`);
    }
    return result.stdout;
}

function dockerCopyTo(hostPath, containerPath) {
    execSync(`docker cp "${hostPath}" ${WORKER_CONTAINER}:${containerPath}`, { timeout: 30000 });
}

function dockerCopyFrom(containerPath, hostPath) {
    fs.mkdirSync(path.dirname(hostPath), { recursive: true });
    execSync(`docker cp ${WORKER_CONTAINER}:${containerPath} "${hostPath}"`, { timeout: 30000 });
}

// ── Web optimization ─────────────────────────────────────────────────────────

/**
 * Use sharp (if available) or ffmpeg/convert to resize + compress JPEG.
 * Falls back to just copying the file if no optimizer is available.
 */
function optimizeImage(inputPath, outputPath) {
    try {
        // Try sharp
        const sharp = require('sharp');
        sharp(inputPath)
            .resize({ width: MAX_IMG_WIDTH, withoutEnlargement: true })
            .jpeg({ quality: 88, mozjpeg: true })
            .toFile(outputPath, (err) => {
                if (err) log(`  Warning: sharp optimization failed — using original`);
            });
        return true;
    } catch {
        // sharp not available — copy file directly
        fs.copyFileSync(inputPath, outputPath);
        return false;
    }
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateImage(imagePath) {
    if (!fs.existsSync(imagePath)) return { passed: false, reason: 'file not found' };
    const stat = fs.statSync(imagePath);
    if (stat.size < 50 * 1024)    return { passed: false, reason: `too small (${(stat.size / 1024).toFixed(0)} KB)` };
    if (stat.size > 10 * 1024 * 1024) return { passed: false, reason: `too large (${(stat.size / 1024 / 1024).toFixed(1)} MB)` };
    return { passed: true };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function main() {
    log('='.repeat(70));
    log('JubileeVerse — Encouragement Category Image Regeneration');
    log(`Model:     Juggernaut Ragnarok (juggernautXL_ragnarokBy.safetensors)`);
    log(`LLM:       Mistral-7B-Instruct @ localhost:9001`);
    log(`Container: ${WORKER_CONTAINER}`);
    log('='.repeat(70));

    // 1. Fetch articles
    log('\n[1/7] Fetching Encouragement articles...');
    const articles = await fetchEncouragementArticles();
    log(`Found ${articles.length} articles`);

    // 2. Copy Python script to container
    log('\n[2/7] Copying generation script to container...');
    const scriptSrc = path.join(__dirname, 'gen_image_worker.py');
    dockerCopyTo(scriptSrc, '/tmp/gen_image_worker.py');
    log('Script copied to /tmp/gen_image_worker.py');

    // 3. Archive existing images
    log('\n[3/7] Archiving existing Encouragement images...');
    archiveExistingImages(articles);

    // 4. Generate prompts via Mistral
    log('\n[4/7] Generating prompts via Mistral-7B...');
    const promptBatch = [];
    const recentPrompts = [];

    for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        process.stdout.write(`  [${i + 1}/${articles.length}] Article ${article.id}: "${article.title?.substring(0, 50)}" ... `);

        try {
            const prompt = await generatePrompt(article, i, recentPrompts);
            promptBatch.push({ id: article.id, prompt });
            recentPrompts.push(prompt);
            if (recentPrompts.length > 8) recentPrompts.shift();
            console.log('OK');
        } catch (err) {
            console.log(`ERROR: ${err.message}`);
            const fallback = buildFallbackPrompt(
                article,
                DEMOGRAPHICS.gender[i % DEMOGRAPHICS.gender.length],
                DEMOGRAPHICS.age[i % DEMOGRAPHICS.age.length],
                DEMOGRAPHICS.ethnicity[i % DEMOGRAPHICS.ethnicity.length],
                DEMOGRAPHICS.viewpoint[i % DEMOGRAPHICS.viewpoint.length],
            );
            promptBatch.push({ id: article.id, prompt: fallback });
        }

        // Small delay between Mistral calls
        if (i < articles.length - 1) await sleep(500);
    }

    // 5. Run generation in batches inside the container
    log(`\n[5/7] Running GPU image generation in batches of ${BATCH_SIZE}...`);
    fs.mkdirSync(IMAGE_ROOT, { recursive: true });

    let totalGenerated = 0;
    let totalFailed    = 0;
    const allResults   = [];

    // Split into batches
    for (let batchStart = 0; batchStart < promptBatch.length; batchStart += BATCH_SIZE) {
        const batch     = promptBatch.slice(batchStart, batchStart + BATCH_SIZE);
        const batchNum  = Math.floor(batchStart / BATCH_SIZE) + 1;
        const batchTotal = Math.ceil(promptBatch.length / BATCH_SIZE);

        log(`\n  Batch ${batchNum}/${batchTotal} (articles ${batchStart + 1}–${Math.min(batchStart + BATCH_SIZE, promptBatch.length)})...`);

        // Write batch input JSON to temp file
        const batchTmpPath = path.join(require('os').tmpdir(), 'jubilee_batch.json');
        fs.writeFileSync(batchTmpPath, JSON.stringify(batch, null, 2));

        // Copy batch input to container
        dockerCopyTo(batchTmpPath, BATCH_INPUT);

        // Clear previous output dir in container
        dockerExec(`rm -rf ${BATCH_OUTPUT_DIR} && mkdir -p ${BATCH_OUTPUT_DIR}`, 'clear output dir');

        // Run generation
        log(`  Starting GPU generation (${batch.length} images)...`);
        const genResult = spawnSync(
            'docker', ['exec', WORKER_CONTAINER, 'python3', '/tmp/gen_image_worker.py'],
            { encoding: 'utf8', timeout: 4 * 60 * 60 * 1000 }  // 4 hours max
        );

        if (genResult.stdout) process.stdout.write(genResult.stdout.split('\n').map(l => '    ' + l).join('\n'));
        if (genResult.stderr) process.stderr.write(genResult.stderr.split('\n').map(l => '    [ERR] ' + l).join('\n'));

        // Read results from container
        try {
            dockerCopyFrom(RESULTS_FILE, batchTmpPath.replace('jubilee_batch.json', 'jubilee_results.json'));
            const results = JSON.parse(fs.readFileSync(batchTmpPath.replace('jubilee_batch.json', 'jubilee_results.json'), 'utf8'));

            for (const result of results) {
                allResults.push(result);

                if (result.status === 'generated') {
                    // Copy image from container to host
                    const containerImgPath = `${BATCH_OUTPUT_DIR}/${result.id}.jpg`;
                    const tmpHostPath      = path.join(require('os').tmpdir(), `jubilee_${result.id}.jpg`);
                    const finalHostPath    = path.join(IMAGE_ROOT, `${result.id}.jpg`);

                    try {
                        dockerCopyFrom(containerImgPath, tmpHostPath);

                        // 6. Web-optimize
                        optimizeImage(tmpHostPath, finalHostPath);

                        // Validate
                        const validation = validateImage(finalHostPath);
                        if (!validation.passed) {
                            log(`  VALIDATION FAILED for ${result.id}: ${validation.reason}`);
                            totalFailed++;
                            continue;
                        }

                        // 7. Update DB
                        const relPath = `/images/jubileeinspire.com/encouragement/${result.id}.jpg`;
                        await updateArticleImage(result.id, relPath);

                        const sizeKb = Math.round(fs.statSync(finalHostPath).size / 1024);
                        log(`  ✓ Article ${result.id}: saved (${sizeKb} KB) — ${relPath}`);
                        totalGenerated++;

                        // Cleanup temp
                        fs.unlinkSync(tmpHostPath);
                    } catch (copyErr) {
                        log(`  ERROR copying image for article ${result.id}: ${copyErr.message}`);
                        totalFailed++;
                    }
                } else {
                    log(`  ✗ Article ${result.id}: ${result.error || 'generation failed'}`);
                    totalFailed++;
                }
            }
        } catch (err) {
            log(`  ERROR reading batch results: ${err.message}`);
        }

        // Throttle between batches
        if (batchStart + BATCH_SIZE < promptBatch.length) {
            log(`  Throttling ${THROTTLE_MS / 1000}s before next batch...`);
            await sleep(THROTTLE_MS);
        }
    }

    // Final summary
    log('\n' + '='.repeat(70));
    log('REGENERATION COMPLETE');
    log(`Total articles:  ${articles.length}`);
    log(`Generated:       ${totalGenerated}`);
    log(`Failed:          ${totalFailed}`);
    log(`Archived to:     ${DEPRECATED_ROOT}`);
    log('='.repeat(70));

    // Write full report
    const reportPath = path.join(__dirname, '..', 'logs', `encouragement_regen_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
        run_at: new Date().toISOString(),
        total: articles.length,
        generated: totalGenerated,
        failed: totalFailed,
        results: allResults,
    }, null, 2));
    log(`Full report saved: ${reportPath}`);

    await pgPool.end();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
    console.error('FATAL:', err.message);
    pgPool.end().finally(() => process.exit(1));
});

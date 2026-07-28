/**
 * Image Pipeline — Dedicated Background Hero Image Generator
 *
 * Generates unique, story-driven hero images for jubileeinspire articles.
 * Runs independently of the article pipeline with its own heartbeat status.
 *
 * Modes:
 *   regenerateAll: true  — regenerate images for ALL articles with content
 *   regenerateAll: false — only generate for articles missing an image (pending/failed/null)
 *
 * Images saved to: public/images/jubileeinspire.com/<theme-slug>/<article_id>.jpg
 * Status exposed at: global.imagePipelineStatus
 */

const fs = require('fs');
const path = require('path');
const JubileeInspireGenerator = require('./jubilee-inspire-persona');
const LeonardoAPI = require('./leonardo-api');

const IMAGE_ROOT = path.join(__dirname, '..', 'public', 'images', 'jubileeinspire.com');
const IMAGE_DELAY_MS = 3000;

// jubileeinspire.com root category ID
const JUBILEE_INSPIRE_ROOT_ID = 64148;

class ImagePipeline {
    constructor(pgPool) {
        this.pgPool = pgPool;
        this.generator = new JubileeInspireGenerator();
        this.leonardo = new LeonardoAPI(process.env.LEONARDO_API_KEY_PRIMARY);

        this.recentPrompts = [];       // rolling window for visual diversity
        this.demographicHistory = [];  // rolling window for demographic diversity
        this.status = {
            running: false,
            processed: 0,
            total: 0,
            current: null,
            errors: 0,
            imagesGenerated: 0,
            startedAt: null,
            lastHeartbeat: null,
            stopRequested: false,
            log: [],
        };
        global.imagePipelineStatus = this.status;
    }

    log(msg) {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}`;
        console.log(line);
        this.status.log.push(line);
        if (this.status.log.length > 500) {
            this.status.log = this.status.log.slice(-500);
        }
        this.status.lastHeartbeat = ts;
    }

    /**
     * Start the image pipeline
     * @param {Object}   options
     * @param {boolean}  options.regenerateAll — if true, redo all articles; default: only pending/missing
     * @param {number}   options.themeId       — restrict to one category subtree (single ID)
     * @param {number[]} options.themeIds      — restrict to multiple category subtrees (array of IDs)
     * @param {number}   options.limit         — cap number of articles processed per pass
     */
    async start(options = {}) {
        if (this.status.running) {
            this.log('Image pipeline already running — ignoring start request');
            return;
        }

        this.status.running = true;
        this.status.stopRequested = false;
        this.status.startedAt = new Date().toISOString();
        this.status.processed = 0;
        this.status.errors = 0;
        this.status.imagesGenerated = 0;
        this.status.log = [];

        const regenerateAll = options.regenerateAll === true;
        // Normalise theme filter: themeIds takes precedence over themeId
        const themeIds = options.themeIds && options.themeIds.length
            ? options.themeIds.map(Number)
            : options.themeId ? [parseInt(options.themeId, 10)] : null;
        const limit = options.limit ? parseInt(options.limit, 10) : undefined;
        const themeLabel = themeIds ? `theme-ids=[${themeIds.join(',')}]` : 'all themes';
        this.log(`=== Image Pipeline Started (mode: ${regenerateAll ? 'regenerate ALL' : 'pending/missing only'} | ${themeLabel}${limit ? ` | limit=${limit}` : ''}) ===`);
        this.log(`Image root: ${IMAGE_ROOT}`);

        try {
            fs.mkdirSync(IMAGE_ROOT, { recursive: true });

            let articles = await this.getArticles(regenerateAll, themeIds);
            if (limit && articles.length > limit) {
                this.log(`Applying limit: processing first ${limit} of ${articles.length} articles`);
                articles = articles.slice(0, limit);
            }
            this.status.total = articles.length;
            this.log(`Found ${articles.length} articles to process`);

            for (const article of articles) {
                if (this.status.stopRequested) {
                    this.log('Stop requested — halting image pipeline');
                    break;
                }

                await this.processArticle(article);
                this.status.processed++;
                this.status.lastHeartbeat = new Date().toISOString();
                await this.sleep(IMAGE_DELAY_MS);
            }

            this.log(`=== Image Pipeline Complete ===`);
            this.log(`Total processed: ${this.status.processed}`);
            this.log(`Images generated: ${this.status.imagesGenerated}`);
            this.log(`Errors: ${this.status.errors}`);

        } catch (error) {
            this.log(`FATAL IMAGE PIPELINE ERROR: ${error.message}`);
            this.status.errors++;
        } finally {
            this.status.running = false;
            this.status.current = null;
        }
    }

    /**
     * Process a single article — generate, quality-check, and save its hero image.
     * Auto-regenerates up to 2 extra times if the quality check fails.
     */
    async processArticle(article) {
        const { id, title, summary, content, category_id } = article;
        this.status.current = { id, title };
        this.log(`\n--- Article ${id}: "${title}"`);

        try {
            const themeSlug = await this.getThemeSlug(category_id);
            if (!themeSlug) {
                this.log(`  SKIP: Could not resolve theme for category ${category_id}`);
                return;
            }

            const imageFolder = path.join(IMAGE_ROOT, themeSlug);
            fs.mkdirSync(imageFolder, { recursive: true });
            const imagePath = path.join(imageFolder, `${id}.jpg`);
            const relativeImagePath = `/images/jubileeinspire.com/${themeSlug}/${id}.jpg`;

            const MAX_ATTEMPTS = 3;
            let lastResult = null;
            let lastPrompt = null;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                // Build prompt (fresh each attempt — new unique scene if retrying)
                this.log(`  Building image prompt (attempt ${attempt})...`);
                lastPrompt = await this.generator.buildImagePromptFromArticle({
                    title,
                    summary: summary || '',
                    content: content || '',
                    categoryName: article.category_name || '',
                    parentTheme: article.parent_theme || '',
                    recentPrompts: this.recentPrompts,
                    demographicHistory: this.demographicHistory,
                });
                this.log(`  Prompt: ${lastPrompt.substring(0, 100)}...`);

                // Generate via Leonardo Phoenix photoReal
                lastResult = await this.leonardo.generateAndDownload(
                    lastPrompt, imagePath, { maxRetries: 2, width: 1472, height: 832 }
                );

                // Vision quality check
                this.log(`  Running quality check...`);
                const qc = await this.checkImageQuality(imagePath);
                if (qc.passed) {
                    this.log(`  Quality: PASSED`);
                    break;
                }

                this.log(`  Quality: FAILED — ${qc.issues.join(', ')}`);
                // Delete bad image before next attempt
                try { fs.unlinkSync(imagePath); } catch (_e) { /* ignore unlink errors */ }

                if (attempt === MAX_ATTEMPTS) {
                    throw new Error(`Quality check failed after ${MAX_ATTEMPTS} attempts: ${qc.issues.join(', ')}`);
                }
                this.log(`  Retrying...`);
            }

            // Persist to DB
            await this.pgPool.query(`
                UPDATE articles SET
                    hero_image_path = $1,
                    hero_image_prompt = $2,
                    hero_image_model = $3,
                    hero_image_provider = 'leonardo',
                    hero_image_status = 'generated',
                    hero_image_generated_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
            `, [relativeImagePath, lastPrompt, lastResult.model, id]);

            // Track visual and demographic diversity (keep last 8 each)
            this.recentPrompts.push(lastPrompt);
            if (this.recentPrompts.length > 8) this.recentPrompts.shift();

            // Extract demographic from prompt for tracking (simple keyword scan)
            const demoMatch = lastPrompt.match(/\b(Black|White|Asian|Hispanic|Middle Eastern|South Asian|Latino|African)\b.*?\b(man|woman|boy|girl|child|elder|person)\b/i)
                || lastPrompt.match(/\b(man|woman|boy|girl|elderly man|elderly woman|young man|young woman|child)\b/i);
            if (demoMatch) {
                this.demographicHistory.push(demoMatch[0]);
                if (this.demographicHistory.length > 8) this.demographicHistory.shift();
            }

            this.status.imagesGenerated++;
            this.log(`  Saved: ${relativeImagePath}`);

        } catch (error) {
            this.log(`  ERROR for article ${id}: ${error.message}`);
            this.status.errors++;
            try {
                await this.pgPool.query(
                    `UPDATE articles SET hero_image_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [id]
                );
            } catch (dbErr) {
                this.log(`  DB update failed: ${dbErr.message}`);
            }
        }
    }

    /**
     * Use Claude vision to verify image quality.
     * Checks: finger anatomy, text presence, controversial content, uplifting tone.
     * Returns { passed: bool, issues: string[] }
     */
    detectMediaType(imagePath) {
        const header = Buffer.alloc(12);
        const fd = fs.openSync(imagePath, 'r');
        fs.readSync(fd, header, 0, 12, 0);
        fs.closeSync(fd);
        if (header.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
        if (header.slice(0, 4).toString() === 'RIFF' && header.slice(8, 12).toString() === 'WEBP') return 'image/webp';
        return 'image/jpeg';
    }

    async checkImageQuality(imagePath) {
        try {
            const imageData = fs.readFileSync(imagePath);
            const base64 = imageData.toString('base64');
            const mediaType = this.detectMediaType(imagePath);

            // Vision QC requires Anthropic (Kimi is text-only).
            // If no Anthropic keys have credits, skip gracefully — image passes through.
            const anthropicKey = this.generator._apiKeys[this.generator._keyIndex];
            if (!anthropicKey) return { passed: true, issues: ['vision_check_skipped'] };

            const response = await this.generator.anthropic.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 150,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: { type: 'base64', media_type: mediaType, data: base64 }
                        },
                        {
                            type: 'text',
                            text: `Inspect this hero image for a faith-based Christian publication. Check ALL of the following:

1. FINGERS: If any human hands are visible, do all fingers look anatomically correct? (5 per hand, proper proportions, no extra/missing/fused fingers) — flag "malformed_fingers" if not
2. TEXT: Is there any visible text, writing, signs, logos, watermarks, or lettering anywhere in the image? — flag "contains_text" if yes
3. CONTENT: Does the image contain anything controversial, violent, sexual, disturbing, or inappropriate for a Christian family audience? — flag "inappropriate_content" if yes
4. TONE: Does the image feel hopeless, despairing, or nihilistic with no spiritual weight? NOTE: Serious, dramatic, or moody imagery is acceptable for faith content — biblical scenes, desert settings, kneeling figures, stormy skies, caves, and narrow paths can all convey spiritual depth and are NOT negative. Only flag "negative_tone" if the image communicates pure defeat, despair, or hopelessness with no redemptive dignity whatsoever.

Respond with JSON only — no explanation:
{"passed": true, "issues": []}
Only include issues that actually apply.`
                        }
                    ]
                }]
            });

            const text = response.content[0].text.trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return { passed: true, issues: [] }; // If can't parse, allow through
            return JSON.parse(jsonMatch[0]);
        } catch (err) {
            this.log(`  Quality check error (allowing through): ${err.message}`);
            return { passed: true, issues: [] }; // Don't block on check errors
        }
    }

    /**
     * Get jubileeinspire.com articles to process.
     *
     * @param {boolean}  regenerateAll — if true, include articles that already have images
     * @param {number[]|null} themeIds — if set, restrict to these category subtrees;
     *                                   null = scope to entire JUBILEE_INSPIRE_ROOT_ID tree
     *
     * Fetches category_name (immediate) and parent_theme (level-2 ancestor) for prompt context.
     * Single recursive CTE carries theme_id down every path from each root — no correlated subqueries.
     * When themeIds has multiple entries, the CTE anchor uses WHERE id IN (...) to start from all roots.
     */
    async getArticles(regenerateAll, themeIds) {
        // Build the WHERE clause for the CTE anchor row(s)
        const rootFilter = themeIds && themeIds.length
            ? `id IN (${themeIds.map(Number).join(', ')})`
            : `id = ${JUBILEE_INSPIRE_ROOT_ID}`;

        const baseQuery = `
            WITH RECURSIVE inspire_tree AS (
                -- Anchor: start from one or more root category IDs.
                -- Carry the level-2 ancestor ID down every path to leaf nodes.
                SELECT id, name, parent_id, level,
                       CASE WHEN level = 2 THEN id ELSE NULL END AS theme_id
                FROM categories
                WHERE ${rootFilter}
                UNION ALL
                SELECT c.id, c.name, c.parent_id, c.level,
                       CASE WHEN c.level = 2 THEN c.id ELSE it.theme_id END
                FROM categories c
                JOIN inspire_tree it ON c.parent_id = it.id
            )
            SELECT a.id, a.title, a.summary, a.content, a.category_id,
                   cat.name  AS category_name,
                   COALESCE(thm.name, cat.name) AS parent_theme
            FROM articles a
            JOIN inspire_tree it  ON it.id = a.category_id
            LEFT JOIN categories cat ON cat.id = a.category_id
            LEFT JOIN categories thm ON thm.id = it.theme_id
            WHERE a.content IS NOT NULL AND a.content != ''
        `;

        let query;
        if (regenerateAll) {
            query = baseQuery + ` ORDER BY a.id ASC`;
        } else {
            query = baseQuery + `
              AND (a.hero_image_status IS DISTINCT FROM 'generated' OR a.hero_image_path IS NULL)
              ORDER BY a.id ASC
            `;
        }
        const result = await this.pgPool.query(query);
        return result.rows;
    }

    /**
     * Walk up the category tree to find the level-2 parent theme slug
     */
    async getThemeSlug(categoryId) {
        const result = await this.pgPool.query(`
            WITH RECURSIVE ancestors AS (
                SELECT id, name, parent_id, level
                FROM categories WHERE id = $1
                UNION ALL
                SELECT c.id, c.name, c.parent_id, c.level
                FROM categories c
                JOIN ancestors a ON c.id = a.parent_id
            )
            SELECT name FROM ancestors
            WHERE level = 2
            LIMIT 1
        `, [categoryId]);

        if (result.rows.length === 0) return null;
        return this.slugify(result.rows[0].name);
    }

    slugify(name) {
        return name.toLowerCase()
            .replace(/[''']/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { ImagePipeline };

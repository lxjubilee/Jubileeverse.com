/**
 * Content Pipeline — Background Article & Image Generation
 *
 * Processes all jubileeinspire.com categories and generates:
 *   1. A 1,500+ word Jubilee Inspire article for each category
 *   2. A photorealistic cinematic hero image via Leonardo API
 *
 * Reports progress via global.contentPipelineStatus for the admin API.
 * Heartbeat updates every processed article.
 */

const fs = require('fs');
const path = require('path');
const JubileeInspireGenerator = require('./jubilee-inspire-persona');
const LeonardoAPI = require('./leonardo-api');

// jubileeinspire.com root category ID
const JUBILEE_INSPIRE_ROOT_ID = 64148;

// Image output root: public/images/jubileeinspire.com/<parent-theme>/<article_id>.jpg
const IMAGE_ROOT = path.join(__dirname, '..', 'public', 'images', 'jubileeinspire.com');

// Rate limiting: ms between article generations (to respect API limits)
const ARTICLE_DELAY_MS = 2000;  // 2s between articles
const IMAGE_DELAY_MS = 3000;    // 3s between image generations

class ContentPipeline {
    constructor(pgPool) {
        this.pgPool = pgPool;
        this.generator = new JubileeInspireGenerator();
        this.leonardo = new LeonardoAPI(
            process.env.LEONARDO_API_KEY_PRIMARY
        );
        this.status = {
            running: false,
            processed: 0,
            total: 0,
            current: null,
            errors: 0,
            skipped: 0,
            articlesGenerated: 0,
            imagesGenerated: 0,
            startedAt: null,
            lastHeartbeat: null,
            stopRequested: false,
            log: [],
        };
        global.contentPipelineStatus = this.status;
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
     * Main entry point — starts the background pipeline
     */
    async start(options = {}) {
        if (this.status.running) {
            this.log('Pipeline already running — ignoring start request');
            return;
        }

        this.status.running = true;
        this.status.stopRequested = false;
        this.status.startedAt = new Date().toISOString();
        this.status.processed = 0;
        this.status.errors = 0;
        this.status.skipped = 0;
        this.status.articlesGenerated = 0;
        this.status.imagesGenerated = 0;
        this.status.log = [];

        this.log('=== Content Pipeline Started ===');
        this.log(`Image root: ${IMAGE_ROOT}`);

        try {
            // Ensure image root exists
            fs.mkdirSync(IMAGE_ROOT, { recursive: true });

            // Get all jubileeinspire.com categories to process
            const categories = await this.getCategoriesForProcessing(options);
            this.status.total = categories.length;

            this.log(`Found ${categories.length} categories to process`);

            // Build a lookup for category paths
            const categoryMap = await this.buildCategoryMap();

            // Process each category
            let articleIndex = 0;
            for (const category of categories) {
                if (this.status.stopRequested) {
                    this.log('Stop requested — halting pipeline');
                    break;
                }

                await this.processCategory(category, categoryMap, articleIndex);
                articleIndex++;
                this.status.processed++;
                this.status.lastHeartbeat = new Date().toISOString();

                // Delay between articles to respect rate limits
                await this.sleep(ARTICLE_DELAY_MS);
            }

            this.log(`=== Pipeline Complete ===`);
            this.log(`Total processed: ${this.status.processed}`);
            this.log(`Articles generated: ${this.status.articlesGenerated}`);
            this.log(`Images generated: ${this.status.imagesGenerated}`);
            this.log(`Skipped (already exists): ${this.status.skipped}`);
            this.log(`Errors: ${this.status.errors}`);

        } catch (error) {
            this.log(`FATAL PIPELINE ERROR: ${error.message}`);
            this.status.errors++;
        } finally {
            this.status.running = false;
            this.status.current = null;
        }
    }

    /**
     * Process a single category — generate article + image
     */
    async processCategory(category, categoryMap, articleIndex) {
        const { id, name, level, parent_id } = category;

        this.status.current = { id, name, level };
        this.log(`\n--- Processing category: "${name}" (id:${id}, level:${level})`);

        try {
            // Check if article already exists for this category
            const existing = await this.pgPool.query(
                'SELECT id, hero_image_path FROM articles WHERE category_id = $1 LIMIT 1',
                [id]
            );

            if (existing.rows.length > 0 && !this.status.forceRegenerate) {
                this.log(`  SKIP: Article already exists (id:${existing.rows[0].id})`);
                this.status.skipped++;
                return;
            }

            // Build category path for this category
            const { categoryPath, folderPath, slugPath } = await this.buildCategoryPath(id, categoryMap);
            const parentTheme = this.getParentTheme(id, categoryMap);

            this.log(`  Category path: ${categoryPath}`);

            // 1. Generate article text
            this.log(`  Generating article...`);
            const { title, summary, content, word_count } = await this.generator.generateArticle({
                categoryPath,
                categoryName: name,
                parentTheme,
                articleIndex,
            });

            this.log(`  Article: "${title}" (${word_count} words)`);

            // 2. Insert article into database
            const articleResult = await this.pgPool.query(`
                INSERT INTO articles (
                    category_id, title, author, content, content_type, status, summary,
                    hero_image_status, created_at, updated_at
                ) VALUES ($1, $2, 'Jubilee Inspire', $3, 'article', 'published', $4, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT DO NOTHING
                RETURNING id
            `, [id, title, content, summary]);

            let articleId;
            if (articleResult.rows.length > 0) {
                articleId = articleResult.rows[0].id;
                this.status.articlesGenerated++;
                this.log(`  Article saved: id=${articleId}`);
            } else {
                // Already exists (race condition) — get existing id
                const existingCheck = await this.pgPool.query(
                    'SELECT id FROM articles WHERE category_id = $1 LIMIT 1', [id]
                );
                if (existingCheck.rows.length > 0) {
                    articleId = existingCheck.rows[0].id;
                    this.log(`  Article already exists: id=${articleId}`);
                } else {
                    this.log(`  WARNING: Could not insert or find article for category ${id}`);
                    return;
                }
            }

            // 3. Generate hero image (using article content for unique prompt)
            await this.sleep(IMAGE_DELAY_MS);
            await this.generateHeroImage(articleId, id, name, parentTheme, summary, title, folderPath, content);

        } catch (error) {
            this.log(`  ERROR processing category ${id} "${name}": ${error.message}`);
            this.status.errors++;
        }
    }

    /**
     * Generate and save hero image for an article
     */
    async generateHeroImage(articleId, categoryId, categoryName, parentTheme, summary, title, folderPath, content = '') {
        try {
            this.log(`  Generating hero image for article ${articleId}...`);

            // Build unique image prompt from article content
            const imagePrompt = await this.generator.buildImagePromptFromArticle({
                title,
                summary,
                content,
                categoryName,
                parentTheme,
            });

            // Output file path: public/images/jubileeinspire.com/<parent-theme>/<article_id>.jpg
            const themeSlug = this.slugify(parentTheme);
            const imageFolder = path.join(IMAGE_ROOT, themeSlug);
            const imagePath = path.join(imageFolder, `${articleId}.jpg`);
            const relativeImagePath = `/images/jubileeinspire.com/${themeSlug}/${articleId}.jpg`;

            // Check if image already exists on disk
            if (fs.existsSync(imagePath)) {
                this.log(`  Image already exists on disk: ${imagePath}`);
                // Update DB if path not set
                await this.pgPool.query(
                    'UPDATE articles SET hero_image_path = $1, hero_image_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND (hero_image_path IS NULL OR hero_image_status = $4)',
                    [relativeImagePath, 'generated', articleId, 'pending']
                );
                this.status.imagesGenerated++;
                return;
            }

            // Generate via Leonardo API
            const result = await this.leonardo.generateAndDownload(
                imagePrompt,
                imagePath,
                {
                    maxRetries: 3,
                    width: 1536,
                    height: 864,
                }
            );

            // Persist to database
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
            `, [relativeImagePath, imagePrompt, result.model, articleId]);

            this.status.imagesGenerated++;
            this.log(`  Hero image saved: ${relativeImagePath}`);

        } catch (error) {
            this.log(`  IMAGE ERROR for article ${articleId}: ${error.message}`);

            // Mark as failed in DB
            try {
                await this.pgPool.query(
                    `UPDATE articles SET hero_image_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [articleId]
                );
            } catch (dbErr) {
                this.log(`  DB update failed: ${dbErr.message}`);
            }
        }
    }

    /**
     * Get all jubileeinspire.com categories to process, ordered by level
     */
    async getCategoriesForProcessing(options = {}) {
        const { levelFilter, startFromCategoryId, limit } = options;

        let query = `
            WITH RECURSIVE cat_tree AS (
                SELECT id, name, slug, parent_id, level
                FROM categories
                WHERE id = $1
                UNION ALL
                SELECT c.id, c.name, c.slug, c.parent_id, c.level
                FROM categories c
                JOIN cat_tree ct ON c.parent_id = ct.id
            )
            SELECT id, name, slug, parent_id, level
            FROM cat_tree
            WHERE id != $1
        `;
        const params = [JUBILEE_INSPIRE_ROOT_ID];

        if (levelFilter) {
            query += ` AND level = $${params.length + 1}`;
            params.push(levelFilter);
        }

        if (startFromCategoryId) {
            query += ` AND id >= $${params.length + 1}`;
            params.push(startFromCategoryId);
        }

        query += ' ORDER BY level ASC, id ASC';

        if (limit) {
            query += ` LIMIT $${params.length + 1}`;
            params.push(limit);
        }

        const result = await this.pgPool.query(query, params);
        return result.rows;
    }

    /**
     * Build a full ID → category map for path construction
     */
    async buildCategoryMap() {
        const result = await this.pgPool.query(
            'SELECT id, name, slug, parent_id, level FROM categories WHERE level <= 5'
        );
        const map = new Map();
        for (const row of result.rows) {
            map.set(row.id, row);
        }
        return map;
    }

    /**
     * Build the full category path string and folder path for a category ID
     */
    async buildCategoryPath(categoryId, categoryMap) {
        const pathParts = [];
        const slugParts = [];
        let current = categoryMap.get(categoryId);

        while (current && current.id !== JUBILEE_INSPIRE_ROOT_ID) {
            // Skip the root "jubileeinspire.com" node itself
            if (current.parent_id !== null) {
                pathParts.unshift(current.name);
                slugParts.unshift(this.slugify(current.name));
            }
            current = current.parent_id ? categoryMap.get(current.parent_id) : null;
        }

        const categoryPath = pathParts.join(' > ');
        const folderPath = path.join(...slugParts);
        const slugPath = slugParts.join('/');

        return { categoryPath, folderPath, slugPath };
    }

    /**
     * Get the level-2 (top theme) parent name for a category
     */
    getParentTheme(categoryId, categoryMap) {
        let current = categoryMap.get(categoryId);
        let theme = current ? current.name : '';

        while (current && current.parent_id) {
            const parent = categoryMap.get(current.parent_id);
            if (!parent || parent.id === JUBILEE_INSPIRE_ROOT_ID) break;
            if (parent.level === 2) {
                theme = parent.name;
                break;
            }
            current = parent;
        }

        return theme;
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

module.exports = { ContentPipeline };

#!/usr/bin/env node

/**
 * Bulk Article Generation via Subcategory Files
 * Direct GenerationService calls — NO HTTP API, NO external credits
 *
 * Usage:
 *   node workers/bulk-subcategory-generation.js
 *
 * Or run multiple workers in parallel (10-20):
 *   for i in {1..15}; do WORKER_ID=$i node workers/bulk-subcategory-generation.js >> logs/worker-$i.log 2>&1 &done
 */

// Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Pool } = require('pg');
const GenerationService = require('../lib/generation-service');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKER_ID = process.env.WORKER_ID || `worker-${Math.random().toString(36).substring(7)}`;
const LOG_DIR = path.join(__dirname, '../logs');
const PROGRESS_FILE = path.join(__dirname, `../logs/subcategory-progress-${WORKER_ID}.json`);
const PROMPTS_DIR = path.join(__dirname, '../prompts');
const CONCURRENCY = 2;  // 2 parallel requests per worker
const MIN_DELAY_MS = 3000;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME || 'jubileeverse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false
});

// GenerationService (direct library, no API calls)
const _generationService = new GenerationService(pool);

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] [${WORKER_ID}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'bulk-subcategory-generation.log'), line + '\n');
  } catch (_) {}
}

/**
 * Parse a Top 100 Subcategories file and extract structured data
 */
function parseSubcategoriesFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const subcategories = [];

  // Match patterns like:
  // ## #1 — The Feast Table of Yahuah: You Have a Seat — 98/100 [Foundational]
  const itemRegex = /^## #(\d+) — (.+?) — (\d+)\/100 \[(.+?)\]/gm;
  let match;

  while ((match = itemRegex.exec(content)) !== null) {
    const [, num, title, score, tier] = match;
    subcategories.push({
      rank: parseInt(num),
      title: title.trim(),
      score: parseInt(score),
      tier,
      topic: title.trim() // Use title as the article topic
    });
  }

  return subcategories;
}

/**
 * Load all subcategory files from prompts folder
 */
function loadAllSubcategories() {
  const subcategoryFiles = [
    'Celebration-and-Mishpakhah-Top-100-Subcategories.md',
    'Torah-and-Hebraic-Insights-Top-100-Subcategories.md',
    'Shalom-and-Salvation-Top-100-Subcategories.md',
    'Covenant-and-Identity-Top-100-Subcategories.md',
    'Teshuvah-and-Restoration-Top-100-Subcategories.md'
  ];

  const allSubcategories = {};

  for (const file of subcategoryFiles) {
    const filePath = path.join(PROMPTS_DIR, file);
    if (fs.existsSync(filePath)) {
      const categoryName = file.replace('-Top-100-Subcategories.md', '');
      try {
        allSubcategories[categoryName] = parseSubcategoriesFile(filePath);
        log(`✓ Loaded ${allSubcategories[categoryName].length} subcategories from ${categoryName}`);
      } catch (e) {
        log(`✗ Failed to parse ${categoryName}: ${e.message}`);
      }
    } else {
      log(`⚠ File not found: ${filePath}`);
    }
  }

  return allSubcategories;
}

/**
 * Load progress from previous runs
 */
function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch (_) {
    return {
      categories: {},
      totalGenerated: 0,
      startTime: new Date().toISOString()
    };
  }
}

/**
 * Save progress to file
 */
function saveProgress(progress) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (e) {
    log(`⚠ Failed to save progress: ${e.message}`);
  }
}

/**
 * Generate one article via GenerationService (direct library call)
 */
async function generateArticle(categoryName, subcategoryTitle, taxonomyNodeId) {
  try {
    const prompt = `Write a unique, compelling 1500+ word article exploring the topic: "${subcategoryTitle}".

This article is for the "${categoryName}" section of a Christian faith website. Style: prophetic voice, scripture-rooted, eighth-grade reading level, viral potential with gripping hook, clear thesis, and powerful conclusion that stirs readers to action.

Begin with a gripping hook. Develop through three to five strong movements using Scripture, parables, and illustrations. Include practical application. Resolve powerfully by the end.`;

    // Call GenerationService directly (no HTTP, no external API calls)
    const result = await _generationService.generateContent({
      title: subcategoryTitle,
      custom_instructions: prompt,
      object_type: 'article',
      taxonomy_node_id: taxonomyNodeId,
      language: 'en-US',
      confirmed: true
    });

    const content = result.contentObject;
    return {
      title: content.title || subcategoryTitle,
      summary: content.summary || '',
      body: content.extension_data?.body_html || content.extension_data?.body || '',
      subcategoryTopic: subcategoryTitle
    };
  } catch (e) {
    throw new Error(`Generation failed: ${e.message}`);
  }
}

/**
 * Generate slug from title
 */
function generateSlug(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100)
    .replace(/-+$/, '');
}

/**
 * Save article to database
 */
async function saveArticle(categoryName, categoryId, article) {
  try {
    const id = crypto.randomUUID();
    let slug = generateSlug(article.title);

    // Ensure slug uniqueness
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM jv_content_objects WHERE slug=$1`,
      [slug]
    );
    if (existing.length > 0) {
      slug = slug + '-' + id.replace(/-/g, '').substring(0, 6);
    }

    const wordCount = article.body.split(/\s+/).length;
    const readingTime = Math.max(1, Math.floor(wordCount / 200));

    const ext = {
      body: article.body,
      word_count: wordCount,
      reading_time_minutes: readingTime,
      ai_generated: true,
      generation_source: 'bulk-subcategory-generation',
      subcategory_topic: article.subcategoryTopic,
      generated_at: new Date().toISOString()
    };

    // Insert article
    await pool.query(
      `INSERT INTO jv_content_objects
       (id, object_type, title, slug, summary, status, language, extension_data, created_at, updated_at)
       VALUES ($1, 'article', $2, $3, $4, 'published', 'en-US', $5, NOW(), NOW())`,
      [id, article.title, slug, article.summary || '', JSON.stringify(ext)]
    );

    // Add taxonomy mapping
    await pool.query(
      `INSERT INTO jv_content_taxonomy_map (object_table, uuid_object_id, taxonomy_node_id, is_primary)
       VALUES ('jv_content_objects', $1, $2, true)
       ON CONFLICT (object_table, uuid_object_id, taxonomy_node_id) DO NOTHING`,
      [id, categoryId]
    );

    return id;
  } catch (e) {
    throw new Error(`Save failed: ${e.message}`);
  }
}

/**
 * Get taxonomy node ID by name (JubileeVerse categories)
 */
async function getTaxonomyNodeId(categoryName) {
  // Direct mapping to JubileeVerse taxonomy node IDs
  const categoryMap = {
    'Celebration-and-Mishpakhah': 354,  // Marriage, Family & Relationships
    'Torah-and-Hebraic-Insights': 351,  // Scripture, Truth & Doctrine
    'Shalom-and-Salvation': 345,        // Life, Grace & Salvation
    'Covenant-and-Identity': 350,       // Identity, Calling & Purpose
    'Teshuvah-and-Restoration': 356     // Healing, Freedom & Wholeness
  };

  const nodeId = categoryMap[categoryName];
  if (!nodeId) {
    throw new Error(`Unknown category: ${categoryName}`);
  }

  // Verify the node exists
  const { rows } = await pool.query(
    `SELECT id FROM jv_taxonomy WHERE id = $1`,
    [nodeId]
  );

  if (rows.length === 0) {
    throw new Error(`Taxonomy node ${nodeId} not found for ${categoryName}`);
  }

  return nodeId;
}

/**
 * Process a batch of subcategories
 */
async function processBatch(categoryName, categoryId, batch, progress) {
  log(`Processing batch of ${batch.length} for ${categoryName}...`);

  let successful = 0;
  let failed = 0;

  for (const subcategory of batch) {
    const subcategoryKey = `${categoryName}:${subcategory.title}`;

    // Skip if already processed
    if (progress.categories[categoryName]?.processed?.includes(subcategoryKey)) {
      log(`  ⊘ Skipped (already done): ${subcategory.title}`);
      continue;
    }

    try {
      log(`  → Generating [${subcategory.rank}/${100}]: ${subcategory.title} (score: ${subcategory.score}, tier: ${subcategory.tier})`);
      const article = await generateArticle(categoryName, subcategory.title, categoryId);

      log(`    ✓ Generated: "${article.title}"`);

      // Save to database
      const articleId = await saveArticle(categoryName, categoryId, article);
      log(`    ✓ Saved: ${articleId}`);

      // Track progress
      if (!progress.categories[categoryName]) {
        progress.categories[categoryName] = { processed: [], failed: 0 };
      }
      progress.categories[categoryName].processed.push(subcategoryKey);
      progress.totalGenerated++;
      successful++;

      // Delay between requests
      await new Promise(r => setTimeout(r, MIN_DELAY_MS));
    } catch (e) {
      log(`    ✗ Error: ${e.message}`);
      if (!progress.categories[categoryName]) {
        progress.categories[categoryName] = { processed: [], failed: 0 };
      }
      progress.categories[categoryName].failed = (progress.categories[categoryName].failed || 0) + 1;
      failed++;
    }
  }

  saveProgress(progress);
  return { successful, failed };
}

/**
 * Main worker loop
 */
async function main() {
  log('========================================');
  log('BULK SUBCATEGORY GENERATION — START');
  log(`Worker: ${WORKER_ID}`);
  log('========================================\n');

  try {
    const allSubcategories = loadAllSubcategories();
    const progress = loadProgress();

    if (Object.keys(allSubcategories).length === 0) {
      log('✗ No subcategories loaded. Exiting.');
      process.exit(1);
    }

    log(`Loaded ${Object.keys(allSubcategories).length} categories with subcategories.`);
    log(`Already generated: ${progress.totalGenerated} articles (previous sessions + this worker)\n`);

    // Find next work
    let totalProcessed = 0;
    for (const [categoryName, subcategories] of Object.entries(allSubcategories)) {
      try {
        const categoryId = await getTaxonomyNodeId(categoryName);
        const alreadyProcessed = progress.categories[categoryName]?.processed?.length || 0;
        const toProcess = subcategories.filter(sub => {
          const key = `${categoryName}:${sub.title}`;
          return !progress.categories[categoryName]?.processed?.includes(key);
        });

        if (toProcess.length === 0) {
          log(`✓ ${categoryName}: all ${alreadyProcessed} done`);
          continue;
        }

        log(`\n→ ${categoryName} [id:${categoryId}]: ${alreadyProcessed} done, ${toProcess.length} remaining`);

        // Process in batches with concurrency control
        for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
          const batch = toProcess.slice(i, i + CONCURRENCY);
          const { successful, failed } = await processBatch(categoryName, categoryId, batch, progress);
          totalProcessed += successful;

          if (failed > 0) {
            log(`  ⚠ Batch had ${failed} failures, continuing...`);
          }

          progress.totalGenerated += successful;
          log(`  Progress: ${totalProcessed}/${toProcess.length} done (${Math.round(totalProcessed / toProcess.length * 100)}%)`);
        }
      } catch (e) {
        log(`✗ Category ${categoryName} error: ${e.message}`);
      }
    }

    log(`\n========================================`);
    log(`WORKER ${WORKER_ID} COMPLETE`);
    log(`Articles generated this session: ${totalProcessed}`);
    log(`Total generated (all time): ${progress.totalGenerated}`);
    log(`========================================\n`);

    await pool.end();
  } catch (e) {
    log(`✗ FATAL ERROR: ${e.message}`);
    log(e.stack);
    await pool.end();
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  log(`\n${WORKER_ID} received SIGINT, shutting down...`);
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log(`\n${WORKER_ID} received SIGTERM, shutting down...`);
  await pool.end();
  process.exit(0);
});

main().catch(async e => {
  log(`✗ Uncaught error: ${e.message}`);
  log(e.stack);
  await pool.end();
  process.exit(1);
});

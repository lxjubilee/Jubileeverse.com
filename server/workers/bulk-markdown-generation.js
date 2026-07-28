#!/usr/bin/env node

/**
 * Bulk Article Generation via Markdown Files + Database Insert
 *
 * Workflow:
 * 1. Generate articles using OpenAI GPT-4 → save as .md files
 * 2. Read .md files → parse content
 * 3. Insert parsed content into jv_content_objects PostgreSQL table
 * 4. NO server API calls, NO API burnthrough on Anthropic
 * 5. Images generated via InspireCortex (free tier only)
 *
 * Uses OpenAI because Anthropic credits exhausted
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Pool } = require('pg');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKER_ID = process.env.WORKER_ID || `worker-${Math.random().toString(36).substring(7)}`;
const LOG_DIR = path.join(__dirname, '../logs');
const ARTICLES_DIR = path.join(__dirname, '../generated-articles');
const PROMPTS_DIR = path.join(__dirname, '../prompts');
const CONCURRENCY = 1;  // One at a time to avoid rate limits
const MIN_DELAY_MS = 2000;  // 2 second delay between requests

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME || 'jubileeverse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: false
});

// OpenAI client (direct, not through server)
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY_PRIMARY ||
          process.env.OPENAI_API_KEY_BACKUP
});

// Ensure directories exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
if (!fs.existsSync(ARTICLES_DIR)) {
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] [${WORKER_ID}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'bulk-markdown-generation.log'), line + '\n');
  } catch (_) {}
}

/**
 * Parse subcategories from markdown file
 */
function parseSubcategoriesFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const subcategories = [];
  const itemRegex = /^## #(\d+) — (.+?) — (\d+)\/100 \[(.+?)\]/gm;
  let match;

  while ((match = itemRegex.exec(content)) !== null) {
    const [, num, title, score, tier] = match;
    subcategories.push({
      rank: parseInt(num),
      title: title.trim(),
      score: parseInt(score),
      tier,
      topic: title.trim()
    });
  }

  return subcategories;
}

/**
 * Load all subcategory files
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
 * Generate article content via OpenAI GPT-4 (NOT through server)
 */
async function generateArticleContent(categoryName, subcategoryTitle) {
  const systemPrompt = `You are Jubilee Inspire — an evangelist–prophet voice rooted in the original Hebrew and Greek Scriptures. Write at an eighth-grade reading level. Teach through Scripture-grounded love, never legalism. Each article must be 1500+ words with viral potential: gripping hook, clear thesis, three to five strong movements, powerful conclusion.

Structure with these XML delimiters exactly:
<TITLE>Article title</TITLE>
<SUMMARY>2-3 sentence SEO summary</SUMMARY>
<BODY>
Full article in Markdown. Use ## for section headings, > for Scripture quotes. No H1 title in body.
</BODY>`;

  const userPrompt = `Write a unique, compelling 1500+ word article for the "${categoryName}" section. Topic: "${subcategoryTitle}". Must have viral potential with gripping hook, Scripture anchoring, and powerful conclusion.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.9
    });

    const raw = response.choices[0].message.content.trim();
    const titleMatch = raw.match(/<TITLE>([\s\S]*?)<\/TITLE>/i);
    const summaryMatch = raw.match(/<SUMMARY>([\s\S]*?)<\/SUMMARY>/i);
    const bodyMatch = raw.match(/<BODY>([\s\S]*?)<\/BODY>/i);

    if (!titleMatch || !bodyMatch) {
      throw new Error(`Missing XML delimiters in response`);
    }

    return {
      title: titleMatch[1].trim(),
      summary: summaryMatch ? summaryMatch[1].trim() : '',
      body: bodyMatch[1].trim(),
      subcategoryTopic: subcategoryTitle
    };
  } catch (e) {
    throw new Error(`Generation failed: ${e.message}`);
  }
}

/**
 * Save article as markdown file
 */
function saveArticleAsMarkdown(categoryName, article) {
  const slug = article.title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, '-')
    .substring(0, 80);

  const filename = `${categoryName}__${slug}.md`;
  const filePath = path.join(ARTICLES_DIR, filename);

  const markdown = `# ${article.title}

## Summary
${article.summary}

## Subcategory Topic
${article.subcategoryTopic}

## Body
${article.body}
`;

  fs.writeFileSync(filePath, markdown, 'utf8');
  return { filename, filePath };
}

/**
 * Insert article from markdown into database
 */
async function insertArticleToDatabase(categoryName, categoryId, article) {
  try {
    const id = crypto.randomUUID();
    let slug = article.title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, '-')
      .substring(0, 100);

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
      generation_source: 'bulk-markdown-generation',
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
 * Get taxonomy node ID for category
 */
async function getTaxonomyNodeId(categoryName) {
  const categoryMap = {
    'Celebration-and-Mishpakhah': 354,
    'Torah-and-Hebraic-Insights': 351,
    'Shalom-and-Salvation': 345,
    'Covenant-and-Identity': 350,
    'Teshuvah-and-Restoration': 356
  };

  const nodeId = categoryMap[categoryName];
  if (!nodeId) {
    throw new Error(`Unknown category: ${categoryName}`);
  }

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
 * Main worker loop
 */
async function main() {
  log('========================================');
  log('BULK MARKDOWN GENERATION — START');
  log(`Worker: ${WORKER_ID}`);
  log('========================================\n');

  try {
    const allSubcategories = loadAllSubcategories();

    if (Object.keys(allSubcategories).length === 0) {
      log('✗ No subcategories loaded. Exiting.');
      process.exit(1);
    }

    log(`Loaded ${Object.keys(allSubcategories).length} categories with subcategories.\n`);

    let totalGenerated = 0;

    for (const [categoryName, subcategories] of Object.entries(allSubcategories)) {
      try {
        const categoryId = await getTaxonomyNodeId(categoryName);
        log(`→ ${categoryName} [id:${categoryId}]: ${subcategories.length} subcategories`);

        for (const subcategory of subcategories) {
          try {
            log(`  → Generating [${subcategory.rank}/${100}]: ${subcategory.title}`);

            // Generate article content
            const article = await generateArticleContent(categoryName, subcategory.title);
            log(`    ✓ Generated: "${article.title}"`);

            // Save as markdown
            const { filename } = saveArticleAsMarkdown(categoryName, article);
            log(`    ✓ Saved markdown: ${filename}`);

            // Insert to database
            const articleId = await insertArticleToDatabase(categoryName, categoryId, article);
            log(`    ✓ Inserted to database: ${articleId}`);

            totalGenerated++;

            // Delay before next request
            await new Promise(r => setTimeout(r, MIN_DELAY_MS));

          } catch (e) {
            log(`    ✗ Error: ${e.message}`);
          }
        }
      } catch (e) {
        log(`✗ Category ${categoryName} error: ${e.message}`);
      }
    }

    log(`\n========================================`);
    log(`WORKER ${WORKER_ID} COMPLETE`);
    log(`Articles generated this session: ${totalGenerated}`);
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

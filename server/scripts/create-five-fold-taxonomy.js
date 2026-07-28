#!/usr/bin/env node
/**
 * Create Five-Fold Ministry Taxonomy
 *
 * Creates 5 L2 taxonomy nodes under JubileeVerse root (332):
 * - Covenant & Identity (Apostle)
 * - Teshuvah & Restoration (Prophet)
 * - Shalom & Salvation (Evangelistic)
 * - Celebration & Mishpakhah (Pastoral)
 * - Torah & Hebraic Insights (Teacher)
 *
 * Then analyzes all existing articles and associates them with the appropriate category
 * based on AI classification of their ministry focus.
 */

const { Pool } = require('pg');
const { Anthropic } = require('@anthropic-ai/sdk');
const path = require('path');

const pgPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,  // Production uses 5432; dev uses 5433 via SSH tunnel
  database: process.env.DB_NAME || 'jubileeverse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'jubilee2026'
});

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY_PRIMARY
});

// Five-fold ministry taxonomy definitions
const FIVE_FOLD_TAXONOMIES = [
  { slug: 'covenant-identity', name: 'Covenant & Identity', ministry: 'Apostle', description: 'Foundational truths of identity in Christ, covenantal foundations' },
  { slug: 'teshuvah-restoration', name: 'Teshuvah & Restoration', ministry: 'Prophet', description: 'Repentance, restoration, prophetic insight, course correction' },
  { slug: 'shalom-salvation', name: 'Shalom & Salvation', ministry: 'Evangelistic', description: 'Gospel message, salvation, wholeness, invitation to faith' },
  { slug: 'celebration-mishpakhah', name: 'Celebration & Mishpakhah', ministry: 'Pastoral', description: 'Community, fellowship, celebration, care and compassion' },
  { slug: 'torah-hebraic', name: 'Torah & Hebraic Insights', ministry: 'Teacher', description: 'Biblical teaching, Hebrew/Greek insights, scriptural understanding' }
];

async function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

async function createTaxonomyNodes() {
  await log('Creating five-fold ministry taxonomy nodes...');

  const result = await pgPool.query(
    'SELECT id FROM jv_taxonomy WHERE id = 332 LIMIT 1'
  );

  if (!result.rows.length) {
    await log('ERROR: JubileeVerse root (332) not found');
    process.exit(1);
  }

  const createdNodes = {};
  for (const tax of FIVE_FOLD_TAXONOMIES) {
    try {
      const { rows } = await pgPool.query(
        `INSERT INTO jv_taxonomy (name, slug, parent_id, level, materialized_path)
         VALUES ($1, $2, 332, 2, '332/' || $3)
         ON CONFLICT (slug) DO UPDATE SET name = $1 RETURNING id`,
        [tax.name, tax.slug, tax.slug]
      );
      createdNodes[tax.slug] = rows[0].id;
      await log(`✓ Created: ${tax.name} (${tax.ministry}) → ID ${rows[0].id}`);
    } catch (e) {
      await log(`✗ Error creating ${tax.name}: ${e.message}`);
    }
  }

  return createdNodes;
}

async function classifyArticle(article) {
  const prompt = `Classify this article into ONE of these five-fold ministry focuses based on its content:

1. Covenant & Identity (Apostle) — Foundational truths, covenantal identity, apostolic authority
2. Teshuvah & Restoration (Prophet) — Repentance, restoration, prophetic correction, call to change
3. Shalom & Salvation (Evangelistic) — Gospel message, salvation, invitation to faith, wholeness
4. Celebration & Mishpakhah (Pastoral) — Community, fellowship, care, compassion, celebration
5. Torah & Hebraic Insights (Teacher) — Biblical teaching, Hebrew/Greek, scriptural understanding

Article Title: ${article.title}
Article Summary: ${article.summary || '(none)'}
Article Body (first 500 chars): ${(article.body || '').substring(0, 500)}

Respond with ONLY the number (1-5) and the slug (e.g., "3 shalom-salvation"). No other text.`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const match = text.match(/(\d) ([\w-]+)/);
    if (match) {
      const [, num, slug] = match;
      return slug;
    }
    return 'shalom-salvation'; // default to evangelistic
  } catch (e) {
    await log(`  ! Classification error for "${article.title}": ${e.message}, defaulting to shalom-salvation`);
    return 'shalom-salvation';
  }
}

async function classifyAndMoveArticles(taxonomyIds) {
  await log('Fetching all existing articles...');

  const { rows: articles } = await pgPool.query(`
    SELECT
      co.id,
      co.title,
      co.summary,
      co.extension_data->>'body' as body,
      co.extension_data->>'body_html' as body_html
    FROM jv_content_objects co
    WHERE co.object_type = 'article'
      AND co.status IN ('published', 'approved', 'draft')
    ORDER BY co.created_at DESC
  `);

  await log(`Found ${articles.length} articles to classify`);

  let classified = 0;
  const taxonomyStats = {};

  for (const article of articles) {
    if (classified % 50 === 0) {
      await log(`  [${classified}/${articles.length}] Processing...`);
    }

    // Get body text
    const bodyText = article.body_html || article.body || '';
    const fullArticle = {
      ...article,
      body: bodyText
    };

    // Classify
    const slug = await classifyArticle(fullArticle);
    const taxonomyId = taxonomyIds[slug];

    if (!taxonomyId) {
      await log(`  ! Unknown taxonomy slug: ${slug}, skipping article ${article.id}`);
      continue;
    }

    // Update jv_content_taxonomy_map
    try {
      await pgPool.query(
        `INSERT INTO jv_content_taxonomy_map
         (object_table, uuid_object_id, taxonomy_node_id, is_primary)
         VALUES ('jv_content_objects', $1, $2, true)
         ON CONFLICT (object_table, uuid_object_id, taxonomy_node_id) DO NOTHING`,
        [article.id, taxonomyId]
      );

      // Remove old mappings (keep only the new classification)
      await pgPool.query(
        `DELETE FROM jv_content_taxonomy_map
         WHERE uuid_object_id = $1
           AND taxonomy_node_id != $2`,
        [article.id, taxonomyId]
      );

      taxonomyStats[slug] = (taxonomyStats[slug] || 0) + 1;
      classified++;
    } catch (e) {
      await log(`  ! Error mapping article ${article.id}: ${e.message}`);
    }

    // Small delay to avoid rate limiting
    if (classified % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  await log(`\nClassification complete: ${classified}/${articles.length} articles classified`);
  await log('\nDistribution across five-fold ministry:');
  for (const tax of FIVE_FOLD_TAXONOMIES) {
    const count = taxonomyStats[tax.slug] || 0;
    const pct = articles.length ? ((count / articles.length) * 100).toFixed(1) : 0;
    await log(`  ${tax.name} (${tax.ministry}): ${count} articles (${pct}%)`);
  }

  return taxonomyStats;
}

async function main() {
  try {
    await log('='.repeat(60));
    await log('FIVE-FOLD MINISTRY TAXONOMY MIGRATION');
    await log('='.repeat(60));

    // Step 1: Create taxonomy nodes
    const taxonomyIds = await createTaxonomyNodes();

    // Step 2: Classify and move articles
    await log('\n' + '='.repeat(60));
    const stats = await classifyAndMoveArticles(taxonomyIds);

    await log('\n' + '='.repeat(60));
    await log('✓ Migration complete!');
    await log('='.repeat(60));

  } catch (e) {
    await log(`FATAL ERROR: ${e.message}`);
    console.error('Full error:', e);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
}

main();

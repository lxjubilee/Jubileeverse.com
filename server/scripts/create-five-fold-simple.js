#!/usr/bin/env node
/**
 * Create Five-Fold Ministry Taxonomy (Simple Version)
 *
 * Creates 5 L2 taxonomy nodes and associates articles using heuristic classification
 */

const { Pool } = require('pg');

const pgPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'jubileeverse',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'jubilee2026'
});

const FIVE_FOLD = [
  { slug: 'covenant-identity', name: 'Covenant & Identity', ministry: 'Apostle', keywords: ['covenant','identity','apostle','authority','foundation','truth','established','rooted'] },
  { slug: 'teshuvah-restoration', name: 'Teshuvah & Restoration', ministry: 'Prophet', keywords: ['restoration','repent','teshuvah','prophet','turn','correction','change','redirect','return'] },
  { slug: 'shalom-salvation', name: 'Shalom & Salvation', ministry: 'Evangelistic', keywords: ['salvation','gospel','saved','faith','believe','jesus','accept','redemption','shalom','wholeness'] },
  { slug: 'celebration-mishpakhah', name: 'Celebration & Mishpakhah', ministry: 'Pastoral', keywords: ['celebration','family','mishpakhah','community','care','compassion','love','fellowship','body','church','pastoral'] },
  { slug: 'torah-hebraic', name: 'Torah & Hebraic Insights', ministry: 'Teacher', keywords: ['torah','hebrew','greek','scripture','teaching','word','study','insight','understanding','biblical','doctrine'] }
];

async function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function createTaxonomies() {
  await log('Creating five-fold ministry taxonomies...');
  const ids = {};

  // Check schema and sample row
  try {
    const { rows: sample } = await pgPool.query(
      `SELECT name, slug, parent_id, is_active, status FROM jv_taxonomy LIMIT 1`
    );
    if (sample.length > 0) {
      await log(`  Sample row: ${JSON.stringify(sample[0])}`);
    }
  } catch (e) {
    // ignore
  }

  for (const tax of FIVE_FOLD) {
    try {
      // First try to check if it exists
      let { rows } = await pgPool.query(
        `SELECT id FROM jv_taxonomy WHERE slug = $1`,
        [tax.slug]
      );

      if (rows.length > 0) {
        ids[tax.slug] = rows[0].id;
        await log(`  ✓ ${tax.name} already exists (ID: ${rows[0].id})`);
      } else {
        // Create new with taxonomy_type = 'topics' (required by check constraint)
        ({ rows } = await pgPool.query(
          `INSERT INTO jv_taxonomy (name, slug, parent_id, materialized_path, taxonomy_type)
           VALUES ($1, $2, 332, $3, 'topics')
           RETURNING id`,
          [tax.name, tax.slug, `332/${tax.slug}`]
        ));
        ids[tax.slug] = rows[0].id;
        await log(`  ✓ Created ${tax.name} (ID: ${rows[0].id})`);
      }
    } catch (e) {
      await log(`  ✗ ${tax.name}: ${e.message}`);
    }
  }

  return ids;
}

function classifyByKeywords(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  let bestMatch = 'shalom-salvation'; // default
  let maxScore = 0;

  for (const tax of FIVE_FOLD) {
    let score = 0;
    for (const kw of tax.keywords) {
      if (text.includes(kw)) score += 10;
    }
    if (score > maxScore) {
      maxScore = score;
      bestMatch = tax.slug;
    }
  }

  return bestMatch;
}

async function classifyArticles(taxonomyIds) {
  await log('Fetching articles for classification...');

  const { rows: articles } = await pgPool.query(
    `SELECT id, title, summary FROM jv_content_objects
     WHERE object_type = 'article' AND status IN ('published', 'approved', 'draft')
     ORDER BY created_at DESC`
  );

  await log(`Found ${articles.length} articles to classify`);

  let processed = 0;
  const stats = {};

  for (const article of articles) {
    if (processed % 100 === 0) {
      await log(`  [${processed}/${articles.length}]`);
    }

    const slug = classifyByKeywords(article.title, article.summary || '');
    const taxId = taxonomyIds[slug];

    if (taxId) {
      try {
        // Delete old mappings
        await pgPool.query(
          `DELETE FROM jv_content_taxonomy_map WHERE uuid_object_id = $1`,
          [article.id]
        );

        // Create new mapping
        await pgPool.query(
          `INSERT INTO jv_content_taxonomy_map
           (object_table, uuid_object_id, taxonomy_node_id, is_primary)
           VALUES ('jv_content_objects', $1, $2, true)`,
          [article.id, taxId]
        );

        stats[slug] = (stats[slug] || 0) + 1;
        processed++;
      } catch (e) {
        await log(`    ! Error mapping ${article.id}: ${e.message}`);
      }
    }
  }

  await log(`\nClassification complete: ${processed}/${articles.length}`);
  await log('\nDistribution:');
  for (const tax of FIVE_FOLD) {
    const count = stats[tax.slug] || 0;
    const pct = articles.length ? ((count / articles.length) * 100).toFixed(1) : 0;
    await log(`  ${tax.name}: ${count} articles (${pct}%)`);
  }
}

async function main() {
  try {
    await log('='.repeat(60));
    await log('FIVE-FOLD MINISTRY TAXONOMY CREATION');
    await log('='.repeat(60));

    const ids = await createTaxonomies();
    await log('\n' + '='.repeat(60));
    await classifyArticles(ids);

    await log('\n✓ Complete!');
  } catch (e) {
    await log(`ERROR: ${e.message}`);
    console.error(e);
  } finally {
    await pgPool.end();
  }
}

main();

#!/usr/bin/env node
/**
 * Move the 1 remaining article from "Faith, Work & Stewardship" to appropriate five-fold category
 */

const { Pool } = require('pg');

const pgPool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'jubileeverse',
  user: 'postgres',
  password: process.env.DB_PASSWORD || 'jubilee2026'
});

const FIVE_FOLD = [
  { slug: 'covenant-identity', name: 'Covenant & Identity', id: 957, keywords: ['covenant','identity','apostle','authority','foundation','truth','established','rooted'] },
  { slug: 'teshuvah-restoration', name: 'Teshuvah & Restoration', id: 958, keywords: ['restoration','repent','teshuvah','prophet','turn','correction','change','redirect','return'] },
  { slug: 'shalom-salvation', name: 'Shalom & Salvation', id: 959, keywords: ['salvation','gospel','saved','faith','believe','jesus','accept','redemption','shalom','wholeness'] },
  { slug: 'celebration-mishpakhah', name: 'Celebration & Mishpakhah', id: 960, keywords: ['celebration','family','mishpakhah','community','care','compassion','love','fellowship','body','church','pastoral','work','stewardship','vocation','calling'] },
  { slug: 'torah-hebraic', name: 'Torah & Hebraic Insights', id: 961, keywords: ['torah','hebrew','greek','scripture','teaching','word','study','insight','understanding','biblical','doctrine'] }
];

async function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function classifyByKeywords(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  let bestMatch = FIVE_FOLD[3]; // default to Celebration & Mishpakhah (Pastoral, includes work/stewardship)
  let maxScore = 0;

  for (const cat of FIVE_FOLD) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (text.includes(kw)) score += 10;
    }
    if (score > maxScore) {
      maxScore = score;
      bestMatch = cat;
    }
  }

  return bestMatch;
}

async function main() {
  try {
    await log('='.repeat(60));
    await log('MOVE FAITH, WORK & STEWARDSHIP ARTICLE');
    await log('='.repeat(60));

    // Get the article from Faith, Work & Stewardship (ID: 352)
    const { rows: articles } = await pgPool.query(`
      SELECT co.id, co.title, co.summary
      FROM jv_content_objects co
      JOIN jv_content_taxonomy_map ctm ON ctm.uuid_object_id = co.id
      WHERE ctm.taxonomy_node_id = 352
    `);

    if (articles.length === 0) {
      await log('No articles found under Faith, Work & Stewardship');
      return;
    }

    await log(`\nFound ${articles.length} article(s) to move:\n`);

    for (const article of articles) {
      await log(`  Article: "${article.title}"`);

      // Classify
      const category = classifyByKeywords(article.title, article.summary || '');
      await log(`  → Classified as: ${category.name} (${category.slug})`);

      // Move
      await pgPool.query(
        `DELETE FROM jv_content_taxonomy_map
         WHERE uuid_object_id = $1`,
        [article.id]
      );

      await pgPool.query(
        `INSERT INTO jv_content_taxonomy_map
         (object_table, uuid_object_id, taxonomy_node_id, is_primary)
         VALUES ('jv_content_objects', $1, $2, true)`,
        [article.id, category.id]
      );

      await log(`  ✓ Moved to ${category.name}\n`);
    }

    await log('✓ All articles moved!');
  } catch (e) {
    await log(`ERROR: ${e.message}`);
    console.error(e);
  } finally {
    await pgPool.end();
  }
}

main();

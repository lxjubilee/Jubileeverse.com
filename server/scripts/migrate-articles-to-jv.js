/**
 * migrate-articles-to-jv.js
 *
 * Migrates legacy `articles` (scoped to JubileeVerse category roots 64166/64148)
 * into `jv_content_objects` and assigns each to one of the 12 theology taxonomy
 * nodes in `jv_content_taxonomy_map` based on keyword classification of the title.
 */

const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5433, database: 'jubileeverse',
  user: 'postgres', password: 'jubilee2026'
});

// ── 12 taxonomy nodes under "Taxonomy" root (parent_id=332) ─────────────────
const TAXONOMY_NODES = {
  'life-grace-salvation':        345,   // Life, Grace & Salvation
  'scripture-truth-doctrine':    351,   // Scripture, Truth & Doctrine
  'prayer-worship-formation':    348,   // Prayer, Worship & Formation
  'church-unity-leadership':     353,   // Church, Unity & Leadership
  'identity-calling-purpose':    350,   // Identity, Calling & Purpose
  'marriage-family-relationships': 354, // Marriage, Family & Relationships
  'faith-work-stewardship':      352,   // Faith, Work & Stewardship
  'wisdom-discernment-holiness': 355,   // Wisdom, Discernment & Holiness
  'healing-freedom-wholeness':   356,   // Healing, Freedom & Wholeness
  'evangelism-revival-mission':  349,   // Evangelism, Revival & Mission
  'culture-ethics-society':      346,   // Culture, Ethics & Society
  'technology-ai':               347,   // Technology & Artificial Intelligence
};

// ── Keyword classifier ────────────────────────────────────────────────────────
// Each entry: [taxonomy_key, [...keywords]] — keywords are matched against
// lowercased title. First match wins; falls through to default.
const RULES = [
  ['technology-ai',               ['technology','digital','ai ','artificial intelligence','internet','social media','online','algorithm']],
  ['culture-ethics-society',      ['culture','society','politics','government','justice','ethics','worldview','nation','america','freedom','right','law','media','race','diversity','injustice']],
  ['evangelism-revival-mission',  ['evangelism','revival','mission','witness','preach','salvation','lost','outreach','gospel message','spread','born again','conversion','apostle','pentecost']],
  ['healing-freedom-wholeness',   ['healing','heal','freedom','wholeness','restore','recovery','bondage','addiction','break free','deliver','overcome','anxiety','depression','mental','pain','trauma','broken','grief','loss']],
  ['marriage-family-relationships',['marriage','family','relationship','children','parenting','spouse','wife','husband','parents','divorce','love one','couple','home','kids','mother','father','son','daughter','brother','sister']],
  ['church-unity-leadership',     ['church','ministry','leadership','pastor','community','unity','congregation','fellowship','body of christ','elder','deacon','disciple','mentor','serve','servant','team']],
  ['scripture-truth-doctrine',    ['scripture','bible','word of god','doctrine','theology','truth','verse','testament','gospel of','parable','teaching','sermon on','commandment','covenant','revelation','prophecy','prophetic']],
  ['prayer-worship-formation',    ['prayer','pray','worship','praise','formation','spiritual discipline','fast','fasting','devotion','meditation','sabbath','quiet time','seek god','holy spirit','intercession']],
  ['wisdom-discernment-holiness', ['wisdom','discernment','holiness','holy','sanctification','virtue','righteous','moral','character','integrity','temptation','sin','repent','obedience','counsel','understanding']],
  ['faith-work-stewardship',      ['work','stewardship','business','career','calling','vocation','money','finance','wealth','resource','provide','labor','marketplace','excellence','diligence','gift','talent']],
  ['identity-calling-purpose',    ['identity','calling','purpose','destiny','design','potential','passion','dream','vision','assignment','value','worth','unique','discover','created for','made for']],
  ['life-grace-salvation',        ['grace','salvation','redemption','forgive','mercy','love','hope','joy','peace','faith','eternal','heaven','blessed','abundance','new life','transform','renew','gift of']],
];

function classify(title) {
  const lower = title.toLowerCase();
  for (const [key, keywords] of RULES) {
    if (keywords.some(kw => lower.includes(kw))) {
      return TAXONOMY_NODES[key];
    }
  }
  // Default: Life, Grace & Salvation (most general Christian category)
  return TAXONOMY_NODES['life-grace-salvation'];
}

// ── Main migration ────────────────────────────────────────────────────────────

async function run() {
  console.log('Starting migration…');

  // Fetch all JV articles using recursive category scoping
  const { rows: articles } = await pool.query(`
    WITH RECURSIVE jv_cats AS (
      SELECT id FROM categories WHERE id = ANY(ARRAY[64166,64148])
      UNION ALL
      SELECT c.id FROM categories c JOIN jv_cats p ON c.parent_id = p.id
    )
    SELECT
      a.id, a.title, a.slug, a.summary, a.content, a.status,
      a.author, a.content_type, a.hero_image_path, a.hero_image_prompt,
      a.hero_image_status, a.hero_image_provider, a.hero_image_model,
      a.category_id, a.created_at, a.updated_at
    FROM articles a
    WHERE a.category_id IN (SELECT id FROM jv_cats)
      AND a.content_type IN ('article', 'markdown')
    ORDER BY a.id
  `);
  console.log(`Found ${articles.length} articles to migrate.`);

  // Check for existing migrations (idempotent — skip already-migrated articles)
  const { rows: existing } = await pool.query(`
    SELECT (extension_data->>'source_article_id')::int AS aid
    FROM jv_content_objects
    WHERE object_type = 'article'
      AND extension_data->>'source_article_id' IS NOT NULL
  `);
  const migratedIds = new Set(existing.map(r => r.aid));
  console.log(`Already migrated: ${migratedIds.size}`);

  const toMigrate = articles.filter(a => !migratedIds.has(a.id));
  console.log(`Will migrate: ${toMigrate.length}`);

  if (toMigrate.length === 0) {
    console.log('Nothing to do.');
    pool.end();
    return;
  }

  // Classify distribution stats
  const dist = {};
  toMigrate.forEach(a => {
    const nodeId = classify(a.title || '');
    dist[nodeId] = (dist[nodeId] || 0) + 1;
  });
  console.log('Classification distribution:', dist);

  // Batch insert
  let inserted = 0;
  let mapped = 0;
  const BATCH = 50;

  for (let i = 0; i < toMigrate.length; i += BATCH) {
    const batch = toMigrate.slice(i, i + BATCH);

    await pool.query('BEGIN');
    try {
      for (const art of batch) {
        const status = art.status === 'published' ? 'published' : 'draft';
        const publishedAt = status === 'published' ? art.created_at : null;

        const ext = {
          source_article_id: art.id,
          body: art.content,
          author: art.author,
          hero_image_path: art.hero_image_path,
          hero_image_prompt: art.hero_image_prompt,
          hero_image_status: art.hero_image_status,
          hero_image_provider: art.hero_image_provider,
          hero_image_model: art.hero_image_model,
          source_category_id: art.category_id,
        };

        const { rows: [obj] } = await pool.query(`
          INSERT INTO jv_content_objects
            (object_type, title, slug, summary, status, language, created_by, updated_by,
             published_at, extension_data, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,'en-US','migration','migration',$6,$7,$8,$9)
          RETURNING id
        `, [
          'article',
          art.title,
          art.slug || null,
          art.summary || null,
          status,
          publishedAt,
          JSON.stringify(ext),
          art.created_at,
          art.updated_at,
        ]);

        inserted++;

        // Classify and map to taxonomy
        // object_id = source article integer ID (unique); uuid_object_id = jv_content_objects UUID
        const nodeId = classify(art.title || '');
        await pool.query(`
          INSERT INTO jv_content_taxonomy_map
            (object_table, object_id, uuid_object_id, taxonomy_node_id, is_primary, assigned_at, assigned_by)
          VALUES ('jv_content_objects', $1, $2, $3, true, NOW(), 'migration')
          ON CONFLICT (object_table, object_id, taxonomy_node_id) DO UPDATE
            SET uuid_object_id = EXCLUDED.uuid_object_id
        `, [art.id, obj.id, nodeId]);

        mapped++;
      }
      await pool.query('COMMIT');
      process.stdout.write(`\r  Progress: ${Math.min(i + BATCH, toMigrate.length)}/${toMigrate.length}`);
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error('\nBatch error:', e.message);
      throw e;
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Mapped: ${mapped}`);

  // Verify
  const { rows: [{ count }] } = await pool.query(`
    SELECT COUNT(*) FROM jv_content_objects WHERE object_type='article'
  `);
  console.log(`Total articles in jv_content_objects: ${count}`);

  pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); process.exit(1); });

const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5433, database: 'jubileeverse', user: 'postgres', password: 'jubilee2026' });

async function main() {
  // Get total articles under both jubileeinspire.com (64148) AND jubileeverse.com (64166)
  const totalSql = `
    WITH RECURSIVE cat_tree AS (
      SELECT id FROM categories WHERE id IN (64148, 64166)
      UNION ALL
      SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_id = ct.id
    )
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN hero_image_path IS NOT NULL AND hero_image_path != '' THEN 1 END) as with_image,
      COUNT(CASE WHEN hero_image_path IS NULL OR hero_image_path = '' THEN 1 END) as without_image
    FROM articles
    WHERE category_id IN (SELECT id FROM cat_tree)
  `;

  const totalResult = await pool.query(totalSql);
  const t = totalResult.rows[0];
  console.log(`\nOVERALL TOTALS (both sites combined)`);
  console.log(`  Total articles:    ${t.total}`);
  console.log(`  With image:        ${t.with_image}`);
  console.log(`  Without image:     ${t.without_image}`);

  // jubileeinspire.com breakdown by L2 category
  const inspireSql = `
    WITH RECURSIVE all_cats AS (
      SELECT id, name, slug, parent_id FROM categories WHERE parent_id = 64148
      UNION ALL
      SELECT c.id, c.name, c.slug, c.parent_id
      FROM categories c JOIN all_cats ac ON c.parent_id = ac.id
    ),
    l2_cats AS (
      SELECT id, name, slug FROM categories WHERE parent_id = 64148
    ),
    article_l2 AS (
      SELECT
        a.id, a.title, a.hero_image_path, a.hero_image_status, a.status,
        a.category_id,
        (
          WITH RECURSIVE upward AS (
            SELECT id, parent_id FROM categories WHERE id = a.category_id
            UNION ALL
            SELECT c2.id, c2.parent_id FROM categories c2
            JOIN upward u ON c2.id = u.parent_id
            WHERE u.parent_id IS NOT NULL
          )
          SELECT id FROM upward WHERE id IN (SELECT id FROM l2_cats) LIMIT 1
        ) as l2_id
      FROM articles a
      WHERE a.category_id IN (SELECT id FROM all_cats)
    )
    SELECT
      l2.name as category,
      l2.slug,
      COUNT(*) as total,
      COUNT(CASE WHEN al.hero_image_path IS NOT NULL AND al.hero_image_path != '' THEN 1 END) as with_image,
      COUNT(CASE WHEN al.hero_image_path IS NULL OR al.hero_image_path = '' THEN 1 END) as without_image
    FROM article_l2 al
    JOIN l2_cats l2 ON l2.id = al.l2_id
    GROUP BY l2.name, l2.slug, l2.id
    ORDER BY l2.name
  `;

  const inspireResult = await pool.query(inspireSql);

  console.log(`\njubileeinspire.com — ARTICLES BY CATEGORY`);
  console.log('='.repeat(65));
  console.log(`${'Category'.padEnd(30)} ${'Total'.padStart(6)} ${'w/Image'.padStart(8)} ${'No Image'.padStart(9)}`);
  console.log('-'.repeat(65));

  let iTotal = 0, iWith = 0, iWithout = 0;
  for (const row of inspireResult.rows) {
    console.log(`${row.category.padEnd(30)} ${String(row.total).padStart(6)} ${String(row.with_image).padStart(8)} ${String(row.without_image).padStart(9)}`);
    iTotal += parseInt(row.total);
    iWith += parseInt(row.with_image);
    iWithout += parseInt(row.without_image);
  }
  console.log('-'.repeat(65));
  console.log(`${'SUBTOTAL'.padEnd(30)} ${String(iTotal).padStart(6)} ${String(iWith).padStart(8)} ${String(iWithout).padStart(9)}`);

  // jubileeverse.com breakdown by L2 category
  const verseSql = `
    WITH RECURSIVE all_cats AS (
      SELECT id, name, slug, parent_id FROM categories WHERE parent_id = 64166
      UNION ALL
      SELECT c.id, c.name, c.slug, c.parent_id
      FROM categories c JOIN all_cats ac ON c.parent_id = ac.id
    ),
    l2_cats AS (
      SELECT id, name, slug FROM categories WHERE parent_id = 64166
    ),
    article_l2 AS (
      SELECT
        a.id, a.hero_image_path,
        (
          WITH RECURSIVE upward AS (
            SELECT id, parent_id FROM categories WHERE id = a.category_id
            UNION ALL
            SELECT c2.id, c2.parent_id FROM categories c2
            JOIN upward u ON c2.id = u.parent_id
            WHERE u.parent_id IS NOT NULL
          )
          SELECT id FROM upward WHERE id IN (SELECT id FROM l2_cats) LIMIT 1
        ) as l2_id
      FROM articles a
      WHERE a.category_id IN (SELECT id FROM all_cats)
    )
    SELECT
      l2.name as category,
      l2.slug,
      COUNT(*) as total,
      COUNT(CASE WHEN al.hero_image_path IS NOT NULL AND al.hero_image_path != '' THEN 1 END) as with_image,
      COUNT(CASE WHEN al.hero_image_path IS NULL OR al.hero_image_path = '' THEN 1 END) as without_image
    FROM article_l2 al
    JOIN l2_cats l2 ON l2.id = al.l2_id
    GROUP BY l2.name, l2.slug, l2.id
    ORDER BY l2.name
  `;

  const verseResult = await pool.query(verseSql);

  console.log(`\njubileeverse.com — ARTICLES BY CATEGORY`);
  console.log('='.repeat(65));
  console.log(`${'Category'.padEnd(30)} ${'Total'.padStart(6)} ${'w/Image'.padStart(8)} ${'No Image'.padStart(9)}`);
  console.log('-'.repeat(65));

  let vTotal = 0, vWith = 0, vWithout = 0;
  for (const row of verseResult.rows) {
    console.log(`${row.category.padEnd(30)} ${String(row.total).padStart(6)} ${String(row.with_image).padStart(8)} ${String(row.without_image).padStart(9)}`);
    vTotal += parseInt(row.total);
    vWith += parseInt(row.with_image);
    vWithout += parseInt(row.without_image);
  }
  console.log('-'.repeat(65));
  console.log(`${'SUBTOTAL'.padEnd(30)} ${String(vTotal).padStart(6)} ${String(vWith).padStart(8)} ${String(vWithout).padStart(9)}`);

  await pool.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

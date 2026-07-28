const { Pool } = require('pg');

const pgPool = new Pool({
  host: 'localhost',
  port: 5433,
  database: 'jubileeverse',
  user: 'jubileeverse',
  password: ''
});

(async () => {
  try {
    // Find the category
    const categoryResult = await pgPool.query(
      "SELECT id, title, parent_id FROM jv_taxonomy WHERE title = 'Faith, Work & Stewardship' LIMIT 1"
    );
    
    if (categoryResult.rows.length === 0) {
      console.log('Category not found');
      process.exit(1);
    }
    
    const category = categoryResult.rows[0];
    console.log('Found category:', category);
    
    // Find articles in this category
    const articlesResult = await pgPool.query(
      "SELECT co.id, co.title FROM jv_content_objects co JOIN jv_content_taxonomy_map ctm ON co.id = ctm.uuid_object_id WHERE ctm.taxonomy_node_id = $1",
      [category.id]
    );
    
    console.log(`Found ${articlesResult.rows.length} articles in this category`);
    
    // If there are articles, move them to "Covenant & Identity"
    if (articlesResult.rows.length > 0) {
      // Find Covenant & Identity category
      const covenantResult = await pgPool.query(
        "SELECT id FROM jv_taxonomy WHERE title = 'Covenant & Identity' LIMIT 1"
      );
      
      if (covenantResult.rows.length === 0) {
        console.log('Covenant & Identity category not found');
        process.exit(1);
      }
      
      const covenantId = covenantResult.rows[0].id;
      
      // Move articles
      for (const article of articlesResult.rows) {
        await pgPool.query(
          "UPDATE jv_content_taxonomy_map SET taxonomy_node_id = $1 WHERE uuid_object_id = $2 AND taxonomy_node_id = $3",
          [covenantId, article.id, category.id]
        );
        console.log(`Moved article "${article.title}" to Covenant & Identity`);
      }
    }
    
    // Delete the category
    await pgPool.query(
      "DELETE FROM jv_taxonomy WHERE id = $1",
      [category.id]
    );
    
    console.log('Category deleted successfully');
    process.exit(0);
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
})();

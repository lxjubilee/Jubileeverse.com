/**
 * MVP Criterion #5 — Canonical Library
 *
 * All content objects are stored once in the canonical library regardless of how
 * many sites reference them.
 *
 * Implementation target: Phase 2
 * Relevant tables: jv_articles, jv_prayers, jv_music, jv_site_content_map
 */

describe('MVP Criterion 5: Canonical Library', () => {
  test.todo(
    'GET /api/library returns all 13 object types with counts'
  )

  test.todo(
    'An article published to 3 sites still has exactly 1 row in jv_articles'
  )

  test.todo(
    'GET /api/library/articles returns all articles regardless of site assignment'
  )

  test.todo(
    'GET /api/library/prayers returns all prayers'
  )

  test.todo(
    'GET /api/library/music returns all music objects'
  )

  test.todo(
    'Each object in the library response includes a site_count field'
  )
})

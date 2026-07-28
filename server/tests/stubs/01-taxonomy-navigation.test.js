/**
 * MVP Criterion #1 — Taxonomy Navigation
 *
 * A user can browse a three-level-deep topic hierarchy and see content objects
 * at every level, with counts displayed per node.
 *
 * Implementation target: Phase 2
 * Relevant tables: jv_taxonomy, jv_articles (category_id), jv_site_content_map
 */

describe('MVP Criterion 1: Taxonomy Navigation', () => {
  test.todo(
    'GET /api/taxonomy returns the root taxonomy nodes with child counts'
  )

  test.todo(
    'GET /api/taxonomy/:slug returns a node with its children (depth 1 expansion)'
  )

  test.todo(
    'GET /api/taxonomy/:slug?depth=3 returns a three-level-deep subtree'
  )

  test.todo(
    'Each taxonomy node in the response includes a content_count field'
  )

  test.todo(
    'Content objects at Level 3 nodes are reachable and filterable by type'
  )
})

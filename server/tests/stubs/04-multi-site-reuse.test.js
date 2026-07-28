/**
 * MVP Criterion #4 — Multi-Site Reuse
 *
 * A single canonical Article can be published to two different registered sites
 * with per-site title overrides.
 *
 * Implementation target: Phase 3
 * Relevant tables: jv_articles, jv_sites, jv_site_content_map
 */

describe('MVP Criterion 4: Multi-Site Reuse', () => {
  test.todo(
    'POST /api/sites/:siteId/publish creates a jv_site_content_map row for an article'
  )

  test.todo(
    'A single article can be mapped to two different site IDs'
  )

  test.todo(
    'Per-site title_override is stored in jv_site_content_map and returned in GET response'
  )

  test.todo(
    'GET /api/sites/:siteId/articles returns only articles mapped to that site'
  )

  test.todo(
    'The canonical article body_html is shared; only title_override differs per site'
  )

  test.todo(
    'Unpublishing from one site does not affect the other site mapping'
  )
})

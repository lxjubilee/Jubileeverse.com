/**
 * phase9-public-api.test.js — Phase 9 Public Content API & Publishing Pipeline stubs
 *
 * Acceptance criteria from the Phase 9 spec:
 *   AC-P1: Public Content API
 *   AC-P2: Search
 *   AC-P3: Publishing Pipeline
 *   AC-P4: API Key Management
 *   AC-P5: Webhooks
 */

describe('AC-P1: Public Content API', () => {
  test.todo('GET /api/v1/content requires X-API-Key header')
  test.todo('GET /api/v1/content returns only published content objects')
  test.todo('GET /api/v1/content?site_domain= filters by site publish_targets')
  test.todo('GET /api/v1/content?taxonomy_node_id= filters by taxonomy descendants')
  test.todo('GET /api/v1/content/:slug returns 304 when ETag matches')
  test.todo('GET /api/v1/content/:slug returns 404 for unpublished content')
  test.todo('GET /api/v1/taxonomy/:type returns category tree')
  test.todo('GET /api/v1/sites/:domain/nav returns root taxonomy nodes for site')
  test.todo('GET /api/v1/sites/:domain/feed returns recent published content for site')
})

describe('AC-P2: Search', () => {
  test.todo('GET /api/v1/search returns ranked results using tsvector')
  test.todo('GET /api/v1/search returns 400 for query shorter than 2 chars')
  test.todo('POST /api/v1/search/semantic returns cosine-ranked results')
  test.todo('POST /api/v1/search/semantic returns 503 when IC_API_BASE not configured')
})

describe('AC-P3: Publishing Pipeline', () => {
  test.todo('POST /api/content/:id/transition to published triggers runPublishingPipeline')
  test.todo('runPublishingPipeline generates embedding and stores in embedding column')
  test.todo('runPublishingPipeline regenerates sitemap XML for published site targets')
  test.todo('runPublishingPipeline dispatches content.published webhook event')
  test.todo('GET /api/v1/sitemap/:domain.xml returns cached XML with Content-Type application/xml')
  test.todo('GET /api/v1/feed/:domain.rss returns cached RSS with Content-Type application/rss+xml')
})

describe('AC-P4: API Key Management', () => {
  test.todo('POST /api/api-keys creates key and returns raw_key once')
  test.todo('POST /api/api-keys returns 403 for non-admin')
  test.todo('GET /api/v1/content returns 401 with invalid API key')
  test.todo('GET /api/v1/content returns 429 when rate limit exceeded')
  test.todo('DELETE /api/api-keys/:id revokes key')
})

describe('AC-P5: Webhooks', () => {
  test.todo('POST /api/webhooks creates webhook and returns secret once')
  test.todo('dispatchWebhooks sends X-Webhook-Signature HMAC header')
  test.todo('dispatchWebhooks records delivery in jv_webhook_deliveries')
  test.todo('PUT /api/webhooks/:id toggles active state')
  test.todo('GET /api/webhooks/:id/deliveries returns delivery history')
})

/**
 * phase8-sites.test.js — Phase 8 Multi-Site Registry & Cross-Site Publishing stubs
 *
 * Acceptance criteria from the Phase 8 spec:
 *   AC-S1: Site Registry
 *   AC-S2: Publish Targets on Content Objects
 *   AC-S3: Cross-Site Publishing Workflow
 *   AC-S4: Per-Site Overrides
 *   AC-S5: Publishing Report
 */

describe('AC-S1: Site Registry', () => {
  test.todo('POST /api/sites creates site content object with extension_data')
  test.todo('POST /api/sites returns 403 for non-admin/site_owner')
  test.todo('GET /api/sites returns list including seeded jubileeverse-com and jubileeinspire-com')
  test.todo('PUT /api/sites/:id updates publishing_rules and creates revision')
  test.todo('PUT /api/sites/:id creates audit log entry with event_type=site.updated')
})

describe('AC-S2: Publish Targets', () => {
  test.todo('PUT /api/content/:id with publish_targets array persists JSONB field')
  test.todo('GET /api/content/:id returns publish_targets array')
  test.todo('publish_targets default is empty array for existing content objects')
})

describe('AC-S3: Cross-Site Publishing Workflow', () => {
  test.todo('POST /api/content/:id/transition to published triggers _evaluatePublishTargets')
  test.todo('_evaluatePublishTargets sets status=published when auto_publish=true')
  test.todo('_evaluatePublishTargets sets status=pending when require_site_owner_approval=true')
  test.todo('_evaluatePublishTargets skips object_type not in content_type_whitelist')
  test.todo('_evaluatePublishTargets sets status=pending on blackout_date match')
  test.todo('POST /api/content/:id/site-publish re-evaluates all non-unpublished targets')
  test.todo('cross-site publish logs content.site_published audit event per site')
})

describe('AC-S4: Overrides', () => {
  test.todo('published_url includes override title slug when title override is set')
  test.todo('summary override stored in publish_targets[].overrides.summary')
})

describe('AC-S5: Publishing Report', () => {
  test.todo('GET /api/sites/publishing-report returns published_count per site')
  test.todo('GET /api/sites/publishing-report returns 403 for non-admin')
})

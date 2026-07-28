# JubileeVerse.com — Feature Registry & Locking

## Feature Inventory

### LOCKED Features (Regression-Proof)

These features are critical path and protected by immutable contracts. Modifications require:
1. Architecture review (why change is necessary)
2. Regression test (prove no side effects)
3. Immutable contract file in `contracts/` directory
4. Approval from Gabe (owner)

---

#### FEATURE-001: Portal Layout Engine
**Status**: 🔒 LOCKED  
**Locked Since**: 2026-04-01 (revenue driver, search-indexed)  
**Core File**: `server.js` line ~3200 (`generatePortalLayout()`)

**What it does**:
- Auto-generates portal homepage every midnight PST
- Layout: 5 hero + 3 sidebar + 50 grid articles
- Deterministic daily shuffle (same articles for all users per day)
- Images HARD-EXCLUDED (any article without cached_image_path omitted)

**Regression tests**:
- `tests/regression/portal-layout.test.js` — Layout schema valid
- `tests/regression/portal-image-exclusion.test.js` — No articles without images
- `tests/regression/portal-midnight-reset.test.js` — Shuffle deterministic by date seed

**Locked because**:
- Featured in search results (URL structure: `/` = homepage)
- Changes break existing articles' URLs
- Daily shuffle algorithm must be deterministic (user expectations)
- Image exclusion is hard business rule (no broken images in production)

---

#### FEATURE-002: Taxonomy Materialized Paths
**Status**: 🔒 LOCKED  
**Locked Since**: 2026-04-01 (site isolation)  
**Core File**: `server.js` line ~600 (jv_taxonomy schema), database migrations

**What it does**:
- Hierarchical taxonomy with materialized paths (e.g., `/jubileeverse/covenant-and-identity/`)
- Enables efficient querying of descendants (no recursive CTEs)
- Enforces site isolation via root category IDs: [64166, 64148]

**Regression tests**:
- `tests/regression/taxonomy-isolation.test.js` — JubileeVerse IDs scoped correctly
- `tests/regression/taxonomy-path-integrity.test.js` — Paths valid and consistent
- `tests/regression/taxonomy-cross-site-leak.test.js` — No data leakage to other sites

**Locked because**:
- Multi-tenant data isolation (legal/compliance)
- Every query MUST scope to root IDs (violation = lawsuit)
- Changes to path structure break SEO URLs

---

#### FEATURE-003: Content Object UUID PKs
**Status**: 🔒 LOCKED  
**Locked Since**: 2026-04-01 (cross-site federation)  
**Core File**: Database schema (jv_content_objects)

**What it does**:
- All articles, devotionals, prayers use UUID primary keys
- Enables cross-site federation (same object shared between JubileeVerse + JubileeInspire)
- Immutable identifiers survive site migrations

**Regression tests**:
- `tests/regression/uuid-uniqueness.test.js` — All IDs unique across DB
- `tests/regression/federation-cross-site.test.js` — Article sharable between sites

**Locked because**:
- UUIDs immutable (can't change PKs without data migration)
- Federation feature depends on it (business requirement)

---

#### FEATURE-004: 12-Persona AI Router
**Status**: 🔒 LOCKED  
**Locked Since**: 2026-04-01 (brand voice consistency)  
**Core File**: `lib/persona-router.js`

**What it does**:
- Routes content requests to 12 specialized personas (Claude, GPT-4, Grok, etc.)
- Each persona has unique voice characteristics (uplifting, theological, accessible)
- Fallback chain: Primary → Secondary → Tertiary model

**Personas**:
1. Faith Storyteller (warmth, accessibility)
2. Theological Scholar (depth, accuracy)
3. Daily Devotional (intimacy, Scripture)
4. Prayer Writer (earnestness, faith-filled)
5. Worship Songwriter (heartfelt, singable)
6. News Commentator (authority, current-events lens)
7. Social Media Expert (punchy, shareable)
8. Children's Educator (simple, engaging)
9. Caregiver's Voice (compassionate, practical)
10. Leadership Coach (actionable, inspiring)
11. Scripture Guide (scholarly, contextual)
12. Hope Ambassador (encouraging, forward-looking)

**Regression tests**:
- `tests/regression/persona-router-routing.test.js` — Correct persona selected
- `tests/regression/persona-fallback-chain.test.js` — Fallback works on API failure

**Locked because**:
- Brand voice consistency (customer expectation)
- Articles tagged with persona (can't change without rewrite)
- Fallback chain must be tested (mission-critical)

---

#### FEATURE-005: Image Generation Pipeline
**Status**: 🔒 LOCKED  
**Locked Since**: 2026-04-01 (GPU expensive, quality gates)  
**Core File**: `server.js` line ~7817 (`POST /api/v1/images/generate`)

**What it does**:
- Submit content to InspireCortex (RTX 5090) or Leonardo AI
- Async processing (20-60s per image)
- Webhook callback when image ready
- Review queue: Checkout (2h lock), Approve/Reject, Archive

**Critical rule**: NO TEXT on images (pure visual)
- Prompt: "Pure visual artistic representation. Cinematic, photorealistic style."
- Never mention text/watermarks even negatively (AI focuses on excluded elements)

**Regression tests**:
- `tests/regression/image-generation-no-text.test.js` — Generated images text-free
- `tests/regression/image-workflow-lifecycle.test.js` — Full pipeline works
- `tests/regression/image-gpu-availability.test.js` — Graceful degradation if GPU offline

**Locked because**:
- GPU resources expensive ($50-100/day)
- Quality gates required (no broken/partial images)
- User expectations on image style/mood

---

#### FEATURE-006: SEO-Friendly URL Routing
**Status**: 🔒 LOCKED  
**Locked Since**: 2026-04-01 (search-indexed, can't change format)  
**Core File**: `server.js` line ~12823 (`app.get('/:category/:slug.html')`)

**What it does**:
- Routes like `/covenant-and-identity/when-joy-breaks-through.html` → article.html
- Server injects article data into sessionStorage
- client-side JavaScript renders article with marked.js
- SEO-friendly format (Google indexes these URLs)

**Regression tests**:
- `tests/regression/url-routing-seofriendly.test.js` — URLs match pattern
- `tests/regression/url-article-lookup.test.js` — Slug lookup works
- `tests/regression/url-public-api.test.js` — /api/public/article/:id accessible

**Locked because**:
- Indexed by Google (URL structure can't change)
- Backlinks depend on format
- Users bookmark these URLs

---

#### FEATURE-007: Multi-Site Content Isolation
**Status**: 🔒 LOCKED  
**Locked Since**: 2026-04-01 (legal/compliance)  
**Core File**: All queries with `WHERE ... IN (JUBILEEVERSE_ROOT_CATEGORY_IDS)`

**What it does**:
- JubileeVerse data (root IDs: 64166, 64148) never visible to other sites
- Enforced at SQL, app logic, and row-level security layers
- Audit trail logs all cross-site access attempts

**Regression tests**:
- `tests/regression/isolation-cross-site-query.test.js` — Queries scoped correctly
- `tests/regression/isolation-data-leak.test.js` — No leakage (comprehensive check)
- `tests/regression/isolation-audit-trail.test.js` — All access logged

**Locked because**:
- Data breach = lawsuit
- Legal compliance requirement
- Other site owners depend on isolation guarantee

---

### UNLOCKED Features (Evolvable)

These features can be modified, enhanced, or replaced without regression concerns.

#### FEATURE-008: Cockpit Admin Dashboard
**Status**: 🔓 UNLOCKED  
**Last Modified**: 2026-04-11  
**Core Files**: `cockpit/src/components/workspace/`

**What it does**:
- Three-panel workspace: Tree (left), Grid (center), Editor (right)
- Real-time sync via TanStack Query
- Inline editing with auto-save
- Supports: Content, Portal, Images, Authors, Servers, Audit workspaces

**Can be evolved**: Yes
- Add new workspaces
- Refactor UI components
- Change grid layouts
- Improve filtering/search

---

#### FEATURE-009: Qdrant Vector Database (NEW — Phase 2)
**Status**: 🔓 UNLOCKED (Not yet implemented)  
**Target**: Phase 2 (Week 2)

**What it will do**:
- Persistent agent context (shared knowledge across 13 agents)
- Collections: shared_knowledge, agent_contexts, trust_scores, communication_bus, snapshots
- Query latency: <100ms (HNSW indexes)
- Federation: Cross-site pattern sharing

**Can be evolved**: Yes (flexible schema)

---

#### FEATURE-010: CrewAI Multi-Agent Orchestration (NEW — Phase 3)
**Status**: 🔓 UNLOCKED (Not yet implemented)  
**Target**: Phase 3 (Week 3-4)

**What it will do**:
- 13 specialized agents: Orchestrator + 12 specialists
- Task delegation by skill + trust score
- Multi-step workflows: Bulk article gen, image gen, portal optimization
- Can be evolved: Yes (add new agents, workflows)

---

#### FEATURE-011: Cortex Release Management (NEW — Phase 4)
**Status**: 🔓 UNLOCKED (Not yet implemented)  
**Target**: Phase 4 (Week 4-5)

**What it will do**:
- State machine: DRAFT → UAT → APPROVED → PRODUCTION
- Canary testing: Risk score (error rate, latency, uptime)
- Auto-rollback on failure
- Immutable contracts: Fix verification

**Can be evolved**: Yes (risk algorithms, state transitions)

---

## Locked Feature Contracts

Directory: `.workspace-intel/contracts/`

### Contract Example Format
```json
{
  "id": "contract-{timestamp}",
  "bugId": "BUG-001",
  "title": "Portal layout cache invalidation",
  "description": "Fix for portal_daily_layout not refreshing on taxonomy changes",
  "fixedIn": "v8.0.0043",
  "affectedFiles": ["server.js", "lib/taxonomy.js"],
  "regressionTest": "tests/regression/portal-layout-invalidation.test.js",
  "contractHash": "sha256://...",
  "lockedFeatures": ["FEATURE-001: Portal layout engine"],
  "createdAt": "2026-04-15T10:30:00Z",
  "approvedBy": "gabe@jubileeverse.com"
}
```

---

## Feature Locking Workflow

### How to Modify a Locked Feature

1. **Justify** — Why is this change necessary? Document it
2. **Test** — Write regression test covering the change
3. **Contract** — Create immutable contract file (SHA-256 hash)
4. **Review** — Gabe reviews (architect approval required)
5. **Deploy** — Merge to main only after approval

### Pre-Commit Hook Validation

File: `scripts/hooks/pre-commit`

Prevents commits that:
- Modify locked feature code without regression test
- Edit `FEATURES.md` locked entries
- Change version.json (only publish.js can modify)
- Break contract hashes

---

**Document Version**: 1.0  
**Last Updated**: 2026-04-11  
**Total Features**: 11 (7 Locked, 4 Unlocked/Future)  
**Status**: ACTIVE

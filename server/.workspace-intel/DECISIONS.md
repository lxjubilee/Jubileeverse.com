# JubileeVerse.com — Architecture Decision Records (ADRs)

## ADR-001: Why PostgreSQL pgvector (not Elasticsearch)

**Status**: ✅ DECIDED (2026-04-01)  
**Stakeholders**: Gabe (architect), Claude Code (AI)

### Decision
Use PostgreSQL pgvector for semantic search instead of adding Elasticsearch as separate infrastructure.

### Context
Need semantic/similarity search across 1000+ articles. Options:
1. **PostgreSQL pgvector** — Vector indexes in existing DB
2. **Elasticsearch** — Separate cluster, dedicated search engine
3. **Pinecone** — Cloud-hosted vectors

### Rationale

**Why pgvector**:
- ✅ Zero additional infrastructure (DB already exists)
- ✅ HNSW indexes for fast similarity search (<100ms)
- ✅ Hybrid queries (semantic + full-text in single SQL statement)
- ✅ Transactional consistency (vectors in sync with content)
- ✅ Shared multi-tenant DB (cost optimization)

**Trade-offs**:
- ❌ pgvector slower than Elasticsearch for very large datasets (1000+ articles acceptable)
- ❌ Limited fuzzy matching (Elasticsearch better for typo tolerance)
- ✅ Acceptable for our scale (1000-5000 articles)

### Implementation
- Vector embeddings: OpenAI text-embedding-3-small (768-dim)
- Index type: HNSW (approximate nearest neighbor)
- Query pattern: `SELECT * FROM jv_content_objects WHERE ... AND embedding <-> query_vector < 0.5`
- Scheduling: Regenerate embeddings nightly (10 min batch job)

### Outcome
Reduced infrastructure complexity. All search queries route through PostgreSQL. Eliminates sync/consistency concerns with separate search engine.

---

## ADR-002: Why PersonaRouter (not CrewAI) for Content Generation

**Status**: ✅ DECIDED (2026-04-01)  
**Related**: Phase 3 will add CrewAI for orchestration (complementary, not replacement)

### Decision
Use custom 12-persona router for content generation (primary pipeline) instead of CrewAI from day 1.

### Context
Need consistent voice across 1000+ articles. Options:
1. **Custom PersonaRouter** — 12 hardcoded personas, fallback chains
2. **CrewAI** — General-purpose multi-agent orchestration
3. **LangChain Agents** — Framework for agentic workflows

### Rationale

**Why PersonaRouter now**:
- ✅ Domain-specific voices (faith-focused, uplifting tone)
- ✅ Multi-provider orchestration (Claude→GPT-4→Grok fallback)
- ✅ Proven fallback chains (mission-critical)
- ✅ Fast iteration (easier to add/remove personas)
- ✅ Lower latency (no agentic overhead)

**Why NOT CrewAI immediately**:
- ❌ Overkill for content generation (CrewAI designed for task collaboration)
- ❌ Adds complexity before we prove value
- ❌ Requires Qdrant knowledge store (Phase 2)

**When we'll add CrewAI** (Phase 3):
- Orchestrator agent coordinates 13 specialists
- PersonaRouter personas become one skill for ContentAgent
- Enables complex multi-step workflows (image gen → content gen → audit)

### Implementation
- `lib/persona-router.js` — Routes topic → persona
- `lib/generation-service.js` — 6-step pipeline (generate → audit → repair → persist)
- Fallback chain: Persona's primary model → secondary → tertiary
- Logging: All requests to `/api/v1/content/generate` logged (debugging)

### Outcome
Shipped content generation MVP quickly. PersonaRouter proven reliable. CrewAI layer added in Phase 3 for advanced orchestration without replacing existing pipeline.

---

## ADR-003: Why Qdrant (vector store for agents — Phase 2)

**Status**: ✅ DECIDED (2026-04-01)  
**Target Implementation**: Phase 2

### Decision
Use Qdrant vector database for multi-agent knowledge sharing instead of in-memory cache.

### Context
Phase 3 will add CrewAI with 13 agents. Need persistent cross-agent context:
- Shared knowledge (facts, patterns)
- Agent-specific memory (conversation history, trust scores)
- Communication bus (inter-agent messages)

Options:
1. **Qdrant** — Persistent vector DB, federation support
2. **In-memory (Redis)** — Fast but ephemeral (agents forget on restart)
3. **Pinecone** — Cloud-hosted (vendor lock-in)

### Rationale

**Why Qdrant**:
- ✅ Persistent agent context (survives restarts)
- ✅ Federation support (learn patterns across sites)
- ✅ Self-hosted (no vendor lock-in)
- ✅ Trust scoring (track agent autonomy levels)
- ✅ Snapshot rollback (immutable fixes)

**Integration with PersonaRouter**:
- PersonaRouter personas → agents in Phase 3
- Shared knowledge: Tips from prior generations (e.g., "this persona works well for devotionals")
- Trust scores: Which persona/model combo performs best for each topic

### Implementation
- Local Docker: `docker run -p 6333:6333 qdrant/qdrant:latest`
- Collections: shared_knowledge, agent_contexts, trust_scores, communication_bus, snapshots
- Query latency: <100ms (HNSW indexes)
- Snapshots: Versioned backups for rollback

### Outcome
Phase 2 establishes knowledge layer. Phase 3 agents leverage shared context. No agent operates in isolation; all learn from collective experience.

---

## ADR-004: Why Shared PostgreSQL (multi-tenant architecture)

**Status**: ✅ DECIDED (2026-03-01)  
**Implications**: Every query MUST scope to JUBILEEVERSE_ROOT_CATEGORY_IDS

### Decision
Use single shared PostgreSQL database for 20+ websites instead of per-site databases.

### Context
18 other websites (song lyrics, party content, children's stories) use same infrastructure. Options:
1. **Shared DB** — One PostgreSQL, scoped queries via root category IDs
2. **Per-site DBs** — 20+ PostgreSQL instances
3. **Database per schema** — Single DB, different schemas per site

### Rationale

**Why shared DB**:
- ✅ Cost optimization (1 DB << 20 DBs)
- ✅ Centralized backups & admin (1 backup job)
- ✅ Unified audit trail (can audit all sites)
- ✅ Proven in production (running 3+ years)

**Why NOT separate DBs**:
- ❌ Higher operational burden
- ❌ Complex backup/restore (20 separate jobs)
- ❌ Audit trail fragmented across 20 systems

**Isolation mechanism**:
```sql
-- Every query MUST include this filter
WHERE category_id = ANY(JUBILEEVERSE_ROOT_CATEGORY_IDS)  -- [64166, 64148]
  AND EXISTS (
    SELECT 1 FROM jv_content_taxonomy_map ctm
    WHERE ctm.uuid_object_id = jv_content_objects.id
      AND ctm.taxonomy_node_id IN (
        SELECT id FROM jv_taxonomy
        WHERE materialized_path LIKE '/64166/%' OR materialized_path LIKE '/64148/%'
      )
  )
```

### Critical Rule
**Queries missing these filters = DATA LEAKAGE to other websites = LAWSUIT**

### Enforcement
- Code review: Every PR checked for WHERE clauses
- Tests: `tests/regression/isolation-cross-site-leak.test.js`
- Pre-commit hook: Flags suspicious queries (e.g., missing WHERE on current_events)

### Outcome
Reduced operational complexity. Shared audit trail enables compliance. Isolation enforced at SQL layer (defense in depth).

---

## ADR-005: Feature Locking (immutable contracts for regression prevention)

**Status**: ✅ DECIDED (2026-04-01)

### Decision
Lock critical features (portal, taxonomy, image gen) with immutable contracts + regression tests. Modifications require architect approval.

### Context
Recurring issue: Fixes to one feature break three other features. Need mechanism to prevent regression in locked features:
- Portal layout engine (revenue driver)
- Taxonomy paths (site isolation)
- Image generation (expensive GPU)
- Persona router (brand voice)
- SEO URLs (search-indexed)

### Rationale

**Why contracts**:
- ✅ Immutable proof that fix was tested
- ✅ SHA-256 hash prevents silent reverts
- ✅ Architectural review before modification
- ✅ Regression tests prove no side effects

**Enforcement**:
1. Pre-commit hook blocks commits that modify locked features without tests
2. FEATURES.md lists locked entries (read-only in git)
3. `contracts/` directory stores immutable fix documentation
4. Every deploy runs all regression tests

### Example
Bug: Portal doesn't refresh on taxonomy changes
Fix: Add invalidation cache key
Contract:
```json
{
  "id": "contract-20260415",
  "bugId": "BUG-001",
  "title": "Portal layout cache invalidation",
  "affectedFiles": ["server.js:3200-3220"],
  "regressionTest": "tests/regression/portal-layout-invalidation.test.js",
  "contractHash": "sha256://abc123",
  "lockedFeatures": ["FEATURE-001"]
}
```
Pre-commit: Refuses `git commit` if `FEATURES.md` modified without this contract.

### Outcome
No more "fixed one thing, broke three things" cycles. Every locked feature change documented, tested, and auditable.

---

## ADR-006: Portal Layout Deterministic (date-seeded shuffle)

**Status**: ✅ DECIDED (2026-04-01)

### Decision
Portal layout is deterministic per date (same articles for all users all day). Reshuffle only at midnight PST.

### Context
Portal is revenue driver (featured content placements). Options:
1. **Deterministic daily** — Same articles all users see all day
2. **Per-user randomized** — Each user sees different layout
3. **Static** — Manual curation only

### Rationale

**Why deterministic**:
- ✅ Fair placement (all users see same promoted articles)
- ✅ Measurable impressions (analytics consistent)
- ✅ Predictable (users expect same layout when they return)
- ✅ Efficient (generate once per day, not per-request)

**Algorithm**:
```javascript
function seededShuffle(array, dateStr) {
  const seed = parseInt(dateStr.replace(/-/g, '')); // e.g., 20260411 → 20260411
  // Fisher-Yates with seed-derived randomness
  let rng = seed;
  for (let i = array.length - 1; i > 0; i--) {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    const j = Math.abs(rng) % (i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
```

**Refresh time**: Midnight PST (America/Los_Angeles timezone)

### Implementation
- Generate: `POST /api/v1/admin/portal/regenerate` (manual OR scheduled hourly check)
- Schedule: Detect midnight PST, regenerate if no recent layout
- Cache: Store in `portal_daily_layout` table (persisted across restarts)

### Outcome
Portal is predictable and analytically sound. Same layout for all users = fair visibility for featured content. Deterministic shuffle prevents accusation of favoritism.

---

## ADR-007: Image Generation Safety (NO text in prompts)

**Status**: ✅ DECIDED (2026-04-11)  
**Updated**: Fixed from "CRITICAL: NO text..." to pure positive language

### Decision
Image generation prompts describe positive visual qualities ONLY. Never mention text/watermarks/logos even negatively.

### Context
Generated images were including unwanted text/captions with spelling errors. Root cause: Mentioning "no text" in prompts makes AI focus on text and ironically include it anyway.

### Rationale

**Why pure positive language**:
- ✅ AI doesn't focus on excluded elements
- ✅ No spelling errors in unwanted text
- ✅ Simpler, cleaner prompts
- ✅ Works better with all models (Claude, DALL-E, Leonardo)

**Correct prompt**:
```
"Pure visual artistic representation. Cinematic, photorealistic style. 
Golden hour lighting. Warm color palette. Uplifting mood."
```

**WRONG prompt** (causes text to appear):
```
"No text, watermarks, or logos on image.
Don't include captions or overlaid content."
```

### Why wrong prompts fail
- Negative constraints make AI focus on excluded concept
- "Don't do X" paradoxically makes model try "X but we told you not to"
- Spelling errors compound when AI generates text it shouldn't

### Implementation
- Prompt template in `server.js` line ~7847
- No mention of text/watermarks/logos anywhere
- Comment added: "CRITICAL: Never mention text even negatively"
- Saved to memory: `IMAGE_GENERATION_SAFETY.md`

### Outcome
Images now text-free consistently. No more spelling error disasters. Lesson learned: **Negative constraints in prompts are counterproductive**.

---

**Document Version**: 1.0  
**Last Updated**: 2026-04-11  
**Total ADRs**: 7  
**Status**: ACTIVE

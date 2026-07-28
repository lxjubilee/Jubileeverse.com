# JubileeVerse.com — System Architecture

## Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| **Runtime** | Node.js | 24.11.1 | Express.js 4.x HTTP server |
| **Database** | PostgreSQL | 15.x | Shared multi-tenant database at localhost:5433 |
| **Search/Vectors** | pgvector | 0.5.x | Semantic search via HNSW indexes |
| **Frontend** | React | 18.x | Cockpit admin dashboard (TypeScript + Vite) |
| **UI Library** | Radix UI | Latest | Headless components + Tailwind CSS |
| **AI Orchestration** | Personal | 1.0 | Custom 12-persona router with fallback chains |
| **Image Generation** | Leonardo AI / InspireCortex | Latest | RTX 5090 GPU for hero images |
| **Authentication** | OIDC (JWT) | RFC 7519 | Session-based + Bearer token fallback |
| **Vector DB (Future)** | Qdrant | 1.x | For multi-agent knowledge sharing (Phase 2) |

## Database Schema

### Core Tables

**jv_content_objects** (UUID PKs, multi-tenant isolation)
- `id` UUID PRIMARY KEY
- `object_type` VARCHAR(50) — 'article', 'author', 'prompt_recipe', etc.
- `title`, `slug`, `summary` — Content metadata
- `extension_data` JSONB — Flexible schema for content variants
- `status` VARCHAR(20) — 'draft', 'published', 'pending_review', 'internal_audit', 'additional_work'
- `featured_image_id` UUID FK → image_generation_jobs
- Site isolation via `jv_content_taxonomy_map` → `jv_taxonomy` → site roots

**jv_taxonomy** (Materialized path, multi-type)
- `id` SERIAL PRIMARY KEY
- `taxonomy_type` VARCHAR(50) — 'site_section', 'persona', etc.
- `slug`, `name`, `title` — Display metadata
- `materialized_path` TEXT — Full path for hierarchical queries
- `display_order` INTEGER — JubileeVerse category display sequence (NEW)
- `depth` INTEGER — Tree depth for pagination
- `parent_id` INTEGER FK → self

**jv_content_taxonomy_map** (Many-to-many content ↔ taxonomy)
- `uuid_object_id` UUID FK → jv_content_objects
- `taxonomy_node_id` INTEGER FK → jv_taxonomy
- Enforces site isolation via root category IDs

**portal_pages** (Portal layout engine)
- `id` SERIAL PRIMARY KEY
- `site_id` INTEGER — Identifies which site (JubileeVerse, JubileeInspire, etc.)
- `portal_date` DATE — Locks layout to specific date (midnight PST reset)
- `hero_ids`, `sidebar_ids`, `grid_ids` INTEGER[] — Article orderings
- `auto_on_demand` BOOLEAN — Regenerate if accessed without recent layout

**image_generation_jobs** (Async image pipeline)
- `id` UUID PRIMARY KEY
- `content_object_id` UUID FK → jv_content_objects
- `gpu_job_status` VARCHAR(20) — 'submitted', 'generating', 'completed', 'failed'
- `image_status` VARCHAR(20) — 'generating', 'in_review', 'approved', 'rejected'
- `prompt_context` TEXT — Extracted article title/summary/theme (NO text mentions)
- `style_constraints` JSONB — { style, palette, mood, medium }

**jv_audit_log** (Compliance & debugging)
- `id` SERIAL PRIMARY KEY
- `event_type` VARCHAR(100) — 'portal.regenerated', 'image.generation_requested', etc.
- `actor_id` VARCHAR(255) — User email or system
- `target_type`, `target_id` — What was affected
- `details` JSONB — Event-specific metadata
- `created_at` TIMESTAMPTZ DEFAULT NOW()

### Shared Database Rules (Multi-Tenant)

Database is shared across 20+ websites. JubileeVerse isolation achieved via:

```javascript
const JUBILEEVERSE_ROOT_CATEGORY_IDS = [64166, 64148]; // JubileeVerse + JubileeInspire
const JUBILEEVERSE_TOPICS = [
  'christian-watch-us', 'church-us', 'church-global', 'faith',
  'finance', 'technology', 'health', 'social', 'entertainment'
];
```

**MANDATORY RULE**: Every query against `jv_content_objects`, `jv_taxonomy`, `current_events` MUST scope to these IDs. Queries missing filters leak data to other websites.

## Deployment Architecture

### Environments

| Name | Host | Port | Notes |
|------|------|------|-------|
| **Dev** | localhost | 3107 | Postgres SSH tunnel to localhost:5433 |
| **UAT** | jubilee-uat (207.244.228.8) | 3107 | Content audit enabled; manual deploy |
| **Prod** | jubilee-prod (94.72.120.231) | 3107 | PM2 managed; auto-sync from UAT |

### Deployment Workflow

1. **Verification** → `node scripts/verify-deployment.js` (18 checks, blocks bad code)
2. **Commit** → `git commit -m "description"` (atomic commits only)
3. **Push** → `git push origin main`
4. **SSH Deploy** → `git fetch && git reset --hard origin/main && pkill node && nohup node server.js`
5. **Verify** → Curl homepage, check console for errors

### Critical Services

**server.js** (~19,000 lines)
- HTTP server: port 3107, gzip compression
- Middleware: CORS, CSRF protection, JSON parsing, authentication
- Routes: 100+ endpoints across content, portal, auth, images, audit
- Background jobs: Hourly portal regen (midnight PST), 30s audit processor, 60s heartbeat
- Database: pgPool (PostgreSQL), inspirePool (legacy articles)

**Cockpit** (React admin dashboard)
- Build: `cd cockpit && npm run build` → `cockpit/dist/`
- Routes: /backoffice/content, /backoffice/portal, /backoffice/images, /backoffice/servers, /backoffice/audit
- Features: Three-panel workspaces, real-time sync, drag-drop, inline editing

**Portal System**
- Homepage: 5 hero + 3 sidebar + 50 grid articles (auto-shuffle by date)
- Category pages: 12 topic pages (one per L2 taxonomy node)
- Generation: `generatePortalLayout(dateStr)` at midnight PST, caches to DB
- Hit tracking: `portal_hits` table with timeseries data (24h sparklines)

## AI Layer — Persona Router

**12 Specialized AI Personas** (6-step generation pipeline)
- Each persona has: name, bio, voice characteristics, model assignment (Claude, GPT-4, Grok, etc.)
- Fallback chain: Primary model → Secondary model → Tertiary model
- Usage: Article generation, devotionals, prayers, social media snippets
- Invocation: `personaRouter.selectPersona(topic)` → `generationService.generate(prompt)`

**GenerationService** (6-step atomic pipeline)
1. Validate input (length, type, sensitive nodes)
2. Generate via persona (streaming SSE)
3. Audit for compliance (theology, tone, plagiarism)
4. Repair minor issues (typos, formatting)
5. Extract metadata (title, summary, tags)
6. Persist to jv_content_objects (UUID, status='published')

## Authentication & Authorization

**OIDC SSO** (OAuth 2.0 PKCE flow)
- Endpoint: Configured per environment (dev/staging/prod)
- Flow: Browser → IdP (identity provider) → JWT token
- Session: `jv-session` cookie (httpOnly, 24h TTL)
- CSRF: `jv-csrf` cookie + `X-CSRF-Token` header validation (exempts public endpoints)
- Fallback: Bearer token in Authorization header

**Entitlements Model**
- `idp_subject_id` VARCHAR(255) — Maps IdP user ID to CMS user
- `cms_roles` TEXT[] — ['admin', 'editor', 'reviewer', 'publisher']
- Permissions matrix: 50+ fine-grained permissions (content:edit, image:generate, audit:view, etc.)

## Content Workflow

### Article Lifecycle
1. **Automated Generation** (GenerationService via persona)
2. **Pending Review** (reviewer assigned, status='pending_review')
3. **Content Audit** (automated + manual, status='internal_audit')
4. **Publish** (status='published', visible on site)
5. **Archived** (status='archived', hidden)

### Image Generation Pipeline
1. **Submission** → POST /api/v1/images/generate (InspireCortex/Leonardo)
2. **GPU Processing** → RTX 5090 async job (20-60 sec per image)
3. **In Review** → Cockpit review queue (checked_out per reviewer, 2h lock expiry)
4. **Approval/Rejection** → Updates `image_generation_jobs` + `jv_content_objects.featured_image_id`
5. **Archive** → Moved to completed (retention policy TBD)

## Key Features (Locked)

| Feature | Status | Why Locked |
|---------|--------|-----------|
| Portal layout engine | 🔒 LOCKED | Core revenue driver; deterministic daily shuffle |
| Taxonomy materialized paths | 🔒 LOCKED | Site isolation depends on it |
| Content object UUID PKs | 🔒 LOCKED | Cross-site federation requires immutable IDs |
| Persona Router (12 voices) | 🔒 LOCKED | Voice consistency; customer brand requirement |
| Image generation pipeline | 🔒 LOCKED | Expensive GPU resources; quality gates |
| SEO-friendly URLs | 🔒 LOCKED | Indexed by search engines; can't change |
| Multi-site isolation | 🔒 LOCKED | Legal/compliance requirement (data leakage = lawsuit) |

## Integration Points (Future — Phase 2+)

**Qdrant Vector Store**
- Shared knowledge across 13 AI agents
- Collections: shared_knowledge, agent_contexts, trust_scores, communication_bus, snapshots
- Query latency target: <100ms

**CrewAI Orchestration**
- Orchestrator (meta-agent) + 12 specialists
- Task delegation by skill + trust score
- Multi-step workflows (e.g., bulk article generation)

**Cortex Release Management**
- State machine: DRAFT → UAT → APPROVED_FOR_PRODUCTION → PRODUCTION
- Canary testing: Risk score calculation (error rate, latency, uptime)
- Auto-rollback on failure

---

**Document Version**: 1.0  
**Last Updated**: 2026-04-11  
**Architect**: Claude Code (AI)  
**Status**: ACTIVE

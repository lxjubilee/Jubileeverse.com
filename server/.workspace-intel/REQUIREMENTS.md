# JubileeVerse.com — Business & Technical Requirements

## Business Requirements

### Vision
**Faith-focused Christian news and devotional platform** serving a global audience with 1000+ auto-generated articles across 13 content categories, with multi-language support and AI-powered personalization.

### Core Objectives
1. **Content Velocity** — Generate 20+ new articles/week via 12 AI personas (personalized voice)
2. **Portal Engagement** — Daily curated homepage with semantic layout (hero/sidebar/grid)
3. **Multi-Site Monetization** — Shared infrastructure serving JubileeVerse + JubileeInspire + 18 other sites
4. **Brand Consistency** — All generated content maintains Christian faith perspective, warm tone, no sensationalism
5. **Compliance** — Audit trail for every change; no content leakage between sites (legal requirement)

### Target Metrics
- **Daily Active Users**: 5,000+
- **Article Pages**: 1,000+ indexed by Google
- **Portal Refresh**: Deterministic daily shuffle (same articles all users see, shuffled only at midnight PST)
- **Image Generation**: 50+ hero images/week (GPU-accelerated)
- **Content Coverage**: All news filtered through Christian lens (church, finance, tech, health, entertainment)

### Success Criteria
- ✅ No SQL injection / data leakage between sites
- ✅ All portal content has images (hard exclusion rule)
- ✅ Generated articles pass theology audit (no heresy, misquote, or plagiarism)
- ✅ Images have NO text/watermarks/captions (pure visual)
- ✅ Deployments fully rollback-able (immutable contracts)

---

## Technical Requirements

### Functional Requirements

#### FR1: Content Management
- Generate articles via 12 distinct AI personas (Claude, GPT-4, Grok, Gemini)
- Support 5 content types: articles, devotionals, prayers, songs, social snippets
- Full CRUD API for content objects (create, read, update, delete with audit trail)
- Draft → Pending Review → Published workflow (status transitions enforced)
- Metadata: title, slug, summary, tags, featured image, author(s), publish date

#### FR2: Portal System
- Auto-generate 13 portal pages: 1 homepage + 12 category pages
- Homepage layout: 5 hero (top) + 3 sidebar (right) + 50 grid (bottom, auto-shuffled)
- Daily refresh at midnight PST (deterministic, same layout for all users per day)
- Image requirement: HARD EXCLUDE any article without cached_image_path
- Hit tracking: Measure top-performing articles (sparkline analytics, 24h view counts)

#### FR3: Image Generation Pipeline
- Submit content to InspireCortex (GPU RTX 5090) or Leonardo AI fallback
- Async processing: callback webhook when image ready
- Review queue: Checkout (per-reviewer, 2h lock expiry), Approve/Reject, Archive
- Metadata: width/height, file size, generation time, seed, model used
- Style consistency: Cinematic, photorealistic, warm color palette, uplifting mood

#### FR4: Multi-Site Isolation
- Shared PostgreSQL database, but JubileeVerse data never leaks to other sites
- Enforcement at 3 layers: SQL WHERE clause, application logic, row-level security
- Root category IDs: [64166, 64148] define JubileeVerse + JubileeInspire
- Every query MUST scope to root IDs (violation = data leak = lawsuit)

#### FR5: Authentication & Authorization
- OIDC SSO (OAuth 2.0 PKCE) for employee login
- Role-based access: admin, editor, reviewer, publisher
- Permission matrix: 50+ fine-grained permissions (content:edit, image:generate, audit:view)
- Audit trail: Every action logged with actor, timestamp, details, IP address

#### FR6: Compliance & Auditability
- All changes tracked in jv_audit_log (event_type, actor, target, details)
- Content audit: Automated check for theology, tone, plagiarism
- Self-test suite: Regression tests for locked features (portal layout, taxonomy paths)
- Rollback capability: Snapshots at every release, instant restoration

### Non-Functional Requirements

#### NFR1: Performance
- Homepage load: <2s (portal queries optimized with indexes)
- API response: <500ms median (p95 <1s)
- Portal generation: <5 min (background job)
- Image generation: 20-60s per image (GPU-dependent, async)
- Database: Shared pool, 20 simultaneous connections

#### NFR2: Availability
- 99.5% uptime SLA (31 min/month allowed downtime)
- Graceful degradation: If portal gen fails, show previous day's layout
- Circuit breaker: Stop submitting images if GPU overloaded (backoff strategy)
- Health checks: /health endpoint every 60s (heartbeat)

#### NFR3: Security
- All user input sanitized (no XSS, SQLi, command injection)
- CSRF protection: Token validation for state-changing requests
- HTTPS only (TLS 1.2+)
- API keys stored AES-256-GCM encrypted (OAuth execution identity)
- No secrets in git (use environment variables)

#### NFR4: Scalability
- Database: Indexes on frequently queried columns (slug, taxonomy_node_id, created_at)
- Caching: Portal layouts cached in DB (no per-request regeneration)
- Async jobs: Image generation, audit processing (background workers)
- Connection pooling: Max 20 simultaneous DB connections
- Future: Qdrant for semantic search across 1000+ articles

#### NFR5: Maintainability
- Code: Node.js + React, TypeScript for type safety
- Deployment: Git-based workflow with pre-flight verification
- Monitoring: Audit logs, error tracking, performance metrics
- Documentation: Architecture, decisions, feature registry, API contracts
- Testing: Unit + regression + integration (51 passing tests)

---

## Constraints

### Technical Constraints
- **Single PostgreSQL instance** — 20+ websites share db, must isolate via WHERE clauses
- **GPU availability** — Limited RTX 5090 capacity (schedule image gen carefully)
- **API rate limits** — Claude 100 req/min, OpenAI 3,500 req/day
- **Cron jobs** — Only hourly scheduler available (portal refresh at midnight PST via interval)
- **Memory** — Node.js process max 512MB (avoid large batch operations)

### Business Constraints
- **Timeline** — Must launch portal MVP by April 30, 2026
- **Budget** — GPU costs $50-100/day (optimize generation scheduling)
- **Team** — Solo maintainer (Gabe) + AI assistant (Claude Code)
- **Compliance** — Christian audience = no secular/offensive content (auto-audit required)
- **SEO** — Google indexes URLs like `/covenant-and-identity/article-title.html` (format locked)

### Organizational Constraints
- **Multi-tenant** — Can't break other sites' functionality (regression tests MANDATORY)
- **Shared infrastructure** — Coordinate with 18 other site owners on capacity
- **Legal hold** — Audit trail immutable (compliance with records retention law)
- **Approval workflow** — Reviewers must approve before publish (no auto-publish)

---

## Dependencies

### External Services
- **IdP** — OIDC provider for employee authentication
- **InspireCortex** — GPU image generation (RTX 5090)
- **Leonardo AI** — Fallback image generation (cloud-based)
- **Claude API** — Text generation via Anthropic
- **OpenAI API** — GPT-4 fallback for text + translation
- **Grok API** — Alternative persona voice
- **Gemini API** — Alternative persona voice
- **Slack** — Notifications on errors/deployments (optional)

### Internal Services
- **PostgreSQL 15** — Shared multi-tenant database
- **PM2** — Process management on production (keeps Node.js alive)
- **GitHub** — Source control + CI/CD hooks (future)
- **CloudFlare** — CDN for static assets + analytics

---

## Success Acceptance Criteria

### Launch Phase (MVP)
- [ ] Homepage portal auto-generates daily (midnight PST)
- [ ] 100+ articles published across 13 categories
- [ ] Image hero for every article (hard exclusion)
- [ ] No data leakage to other sites (audit trail proves isolation)
- [ ] All images text-free (pure visual representation)
- [ ] Deployments fully rollback-able

### Growth Phase (Post-Launch)
- [ ] 500+ indexed articles (SEO traffic 1000+ monthly users)
- [ ] Qdrant semantic search integrated (phase 2)
- [ ] CrewAI multi-agent orchestration (phase 3)
- [ ] Cortex release management with canary testing (phase 4)
- [ ] Zero production incidents (monitored 24/7)

---

**Document Version**: 1.0  
**Last Updated**: 2026-04-11  
**Owner**: Gabe Ungureanu  
**Status**: ACTIVE

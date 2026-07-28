# JubileeVerse.com — Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added
- Phase 1: `.workspace-intel/` documentation registry
- ARCHITECTURE.md, REQUIREMENTS.md, FEATURES.md, DECISIONS.md
- ENVIRONMENT.md, CORTEX-MAP.md
- Image generation safety rules (no text in prompts)
- Taxonomy display_order field (proper category ordering)
- Utility endpoint for category removal

### Fixed
- POST /api/articles/:id/translate now handles UUID-based articles
- GET /api/verse endpoint (404 → 200)
- POST /api/track/view CSRF exemption (403 → 200)
- POST /api/tts CSRF exemption (403 → 200)
- CSP allows Cloudflare beacon script
- Generate Images button text color (gray → white)
- Image generation prompt (removed text mentions)

### Changed
- Taxonomy query ordering: COALESCE(display_order, 0) ASC
- Prompt context: Focus on positive visual qualities only

---

## [8.0.0043] — 2026-04-11

### Added
- Display order system for taxonomy categories
- Public API endpoint for article translation cache
- Critical lesson saved to memory (IMAGE_GENERATION_SAFETY.md)

### Fixed
- Image generation prompt now uses pure positive language (no negative text mentions)
- UUID support in translate endpoint

### Security
- Exempted public endpoints (/api/track/view, /api/tts, /api/verse) from CSRF

---

## [8.0.0042] — 2026-04-10

### Added
- Taxonomy display_order migration (sets order for all JubileeVerse categories)
- Memory files: ARTICLE_NAVIGATION_SYSTEM.md, DEPLOYMENT_WORKFLOW_AND_LESSONS.md

### Fixed
- SEO-friendly URL routing working for all articles
- Article navigation via /api/public/article/:id endpoint
- Event listeners CSP-compliant

---

## [8.0.0041] — 2026-04-09

### Added
- 18-check deployment verification system
- Portal layout deterministic daily shuffle

### Fixed
- Navigation alignment (HOME link 2px vertical offset)
- PERSONALIZE button text color (white)
- Category display order

---

## [8.0.0040] — 2026-04-08

### Added
- Content Security Policy for article.html
- Marked.js markdown rendering
- Event listener wrapper for onclick handlers

### Fixed
- Article loading from sessionStorage
- Taxonomy slug lookup (async race condition)

---

## [8.0.0039] — 2026-04-07

### Added
- jv_content_objects table (UUID PKs)
- jv_content_taxonomy_map (many-to-many mapping)
- /api/public/article/:id endpoint (no auth)

### Fixed
- Article navigation to SEO-friendly URLs

---

## [8.0.0038] — 2026-04-06

### Added
- Portal page generation API
- Hit tracking for articles

---

## [8.0.0037] — 2026-04-05

### Added
- Cockpit React admin dashboard
- Three-panel workspace (Tree/Grid/Editor)
- Content management CRUD

---

## [8.0.0036] — 2026-04-04

### Added
- 12-persona AI router
- GenerationService (6-step pipeline)
- Content audit system

---

## [8.0.0035] — 2026-04-03

### Added
- OIDC SSO authentication
- JWT token validation
- Role-based access control

---

## [8.0.0034] — 2026-04-02

### Added
- Multi-tenant database isolation
- Site-specific content filtering

---

## [8.0.0033] — 2026-04-01

### Added
- JubileeVerse.com MVP launch
- Portal system with daily refresh
- Article generation via AI personas
- Image generation pipeline

---

## Release Notes

### Versioning Scheme
- **MAJOR**: Breaking changes (API redesign, schema migration)
- **MINOR**: New features (new endpoints, new personas)
- **PATCH**: Bug fixes (no breaking changes)

### Deployment Gate
All releases go through:
1. Local verification (`npm test`, `npm run lint`)
2. UAT deployment + canary testing (automated)
3. Production promotion (architect approval required)
4. Automatic rollback if canary fails (riskScore >= 0.7)

### Testing Requirements
- All tests passing: `npm test`
- Linting clean: `npm run lint`
- Verification checks: `node scripts/verify-deployment.js`

---

**Document Version**: 1.0  
**Last Updated**: 2026-04-11  
**Status**: ACTIVE

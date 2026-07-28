---
name: Article Navigation System - Complete Implementation
description: SEO-friendly URLs, public API, event listeners, and full workflow
type: project
---

# Article Navigation System - FULLY WORKING

## What Works ✓

### 1. SEO-Friendly URL Routing
**Pattern**: `/:category/:slug.html`
**Example**: `https://www.jubileeverse.com/covenant-and-identity/when-joy-breaks-through-our-deepest-sorrow.html`

**How it works**:
- User clicks article card on category page
- JavaScript event listener calls `openJVArticle(id)` (CSP-compliant)
- Function navigates to `/${item.taxonomySlug}/${item.slug}.html`
- Server-side route at `app.get('/:category/:slug.html')` (server.js ~line 12823)
- Server looks up article in `jv_content_objects` by slug
- Server injects article metadata into sessionStorage via script tag
- Serves article.html page

### 2. Public API Endpoint for Article Content
**Endpoint**: `GET /api/public/article/:id`
**Location**: server.js ~line 15818
**Auth**: None required (public)
**Returns**: Published articles only (id, title, slug, summary, extension_data, etc.)

**Critical**: Without this endpoint, articles fail to load because the original `/api/content/:id` requires authentication.

### 3. Event Listeners (CSP-Compliant)
**File**: public/index.html
**Function**: `attachCardEventListeners()` (line ~7598)

Converts inline `onclick` handlers to event listeners:
- `.content-card[data-article-id]` - article click
- `[data-hide-btn]` - hide button
- `.content-card-refresh` - regenerate image
- `.content-card-image img` - image error handling

**Why needed**: Content Security Policy blocks inline event attributes (`onclick`)

### 4. Taxonomy Slug Loading
**Critical Fix**: `await loadTaxonomyNavLinks()` (index.html line 6735)

**Problem fixed**: Without await, `_taxonomyNodes` was empty when trying to look up taxonomy slug
- Result: `taxonomySlug` was undefined
- Consequence: openJVArticle couldn't navigate to SEO-friendly URL
- Fallback: Would try `/article.html` but sessionStorage wasn't set properly

**Solution**: Added `await` so code waits for data before using it

### 5. Content Security Policy
**File**: public/index.html
**Location**: Meta tag in `<head>`

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-hashes' cdn.jsdelivr.net cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' fonts.googleapis.com; img-src * data: blob:; font-src fonts.googleapis.com fonts.gstatic.com; connect-src *; object-src 'none'; base-uri 'self';">
```

**Required for**:
- Inline event handlers (onclick, onerror)
- Marked.js markdown parser from CDN
- Fonts from googleapis/gstatic

## Critical Issues & Fixes

### Issue 1: Git Merge Conflict Marker
**File**: public/article.html line 2063
**Marker**: `>>>>>>> Stashed changes`
**Effect**: JavaScript syntax error, articles wouldn't load
**Fix**: Removed the conflict marker (commit d32fc28)

### Issue 2: Authentication Blocking Public Article View
**Endpoint**: /api/content/:id required authentication
**Effect**: Public users couldn't fetch article body
**Fix**: Created public endpoint /api/public/article/:id without auth (commit 3344085)

### Issue 3: Async Race Condition
**Function**: loadContent() in index.html
**Issue**: loadTaxonomyNavLinks() wasn't awaited
**Effect**: Taxonomy slug undefined when rendering article cards
**Fix**: Changed to `await loadTaxonomyNavLinks()` (commit 0f931e5)

### Issue 4: CSP Blocking Inline Handlers
**Problem**: All onclick attributes blocked by CSP
**Fix**: Converted to event listeners + added 'unsafe-inline' and 'unsafe-hashes' to CSP

## Data Flow

```
User clicks article card on category page
    ↓
Event listener: attachCardEventListeners()
    ↓
Call: openJVArticle(articleId)
    ↓
Lookup item in _jvArticleMap by ID
    ↓
Navigate to: /${item.taxonomySlug}/${item.slug}.html
    ↓
Server receives: GET /:category/:slug.html
    ↓
Query jv_content_objects WHERE slug = $1 AND status = 'published'
    ↓
Inject article metadata into sessionStorage via <script> tag
    ↓
Serve article.html
    ↓
article.html JavaScript runs:
    - Parses sessionStorage.selectedArticle (metadata)
    - Calls /api/public/article/:id (no auth needed)
    - Gets full body from extension_data.body
    - Renders with marked.js markdown parser
    ↓
Article displays to user
```

## Testing Checklist

Before declaring article navigation working:
- [ ] Click article on category page
- [ ] URL changes to `/:category/:slug.html` (verify in browser)
- [ ] Page shows "Loading article..." briefly
- [ ] Full article displays with body, image, metadata
- [ ] No console errors (syntax or CSP)
- [ ] Marked.js loads and renders markdown correctly
- [ ] No 401/403 errors in Network tab

## Key Files

| File | Purpose | Line(s) |
|------|---------|---------|
| server.js | SEO-friendly URL route + public API | 12823, 15818 |
| public/index.html | Event listeners + CSP + taxonomy loading | 7598+, meta tag, 6735 |
| public/article.html | Article display, markdown rendering | 1893, 2066+ |

## Why This Works

1. **Public endpoint for articles**: Essential for unauthenticated users
2. **Event listeners instead of inline onclick**: Complies with CSP
3. **Awaited taxonomy loading**: Ensures slug is available before navigation
4. **Server-side sessionStorage injection**: Article data available immediately when article.html loads
5. **SEO-friendly URLs**: Better for search, user-friendly format

## Deployment Process

1. Make changes
2. Run: `node scripts/verify-deployment.js` (must pass 18 checks)
3. Commit: `git commit -m "description"`
4. Push: `git push origin main`
5. Production auto-pulls and restarts (via CI/CD or manual ssh command)

## Things That DON'T Work

- Direct access to /api/content/:id without authentication (returns 401)
- Inline onclick handlers (CSP blocks them)
- Unresolved git merge conflict markers (syntax error)
- _taxonomyNodes lookup without awaiting loadTaxonomyNavLinks() (undefined slugs)
- Old /article.html redirect without data injection

## Remember

- Always use public endpoints for unauthenticated features
- CSP is important - update it when needed but carefully
- Event listeners are more flexible than inline handlers
- Always await async operations before using their results
- Git conflict markers MUST be removed before deployment

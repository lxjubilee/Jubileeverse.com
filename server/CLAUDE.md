# JubileeVerse — Claude Code Context

## ⚠️ SHARED DATABASE — READ THIS BEFORE TOUCHING ANY QUERY

The PostgreSQL database (accessed via SSH tunnel at localhost:5433) is a **shared Content
Operating System** used by dozens of websites (jubileeverse.com, gopartygiggles.com,
inspirecodex.com, and many others). Other websites store song lyrics, children's stories,
party content, and more in the same tables. This is intentional — it is a multi-tenant
content platform.

**JubileeVerse.com identity in the shared DB:**

| What | Value | Where defined |
|------|-------|---------------|
| Category roots | `[64166, 64148]` (jubileeverse.com + jubileeinspire.com, both under 18453 "Jubilee Websites") | `JUBILEEVERSE_ROOT_CATEGORY_IDS` constant in server.js |
| Primary root | `64166` ("jubileeverse.com") | `JUBILEEVERSE_ROOT_CATEGORY_ID` alias in server.js |
| current_events namespace | 9 topic slugs (see below) | `JUBILEEVERSE_TOPICS` constant in server.js |

**MANDATORY: Every query against these shared tables MUST include the site filter:**
- Queries on `categories` → must scope to descendants of `JUBILEEVERSE_ROOT_CATEGORY_IDS` ([64166, 64148])
- Queries on `current_events` → must include `AND topic = ANY(JUBILEEVERSE_TOPICS)`

Queries missing these filters will show other websites' content on jubileeverse.com.
This is the #1 recurring mistake. Do not repeat it.

**JubileeVerse site sections** (L2 children of 64166 — jubileeverse.com):
- Biblical Wisdom, Biblical Times, Church History, Community, Current Events,
  Daily Verse, Devotionals, Faith Journey, Family Life, Prayer, Scripture Studies,
  Sermons, Testimonies, Verse Memorization, Worship

**jubileeinspire.com sections** (L2 children of 64148 — also shown in jubileeverse dashboard):
- Encouragement, Faith Builders, Hope Restored, Inspirational Stories, Lets Celebrate,
  Live Inspired, Motivational Messages, Overcoming Obstacles, Positive Living,
  Purpose Driven, Uplifting Content, Victory Stories

**JubileeVerse is a Christian faith website** covering all news topics through a faith lens:
church, finance, technology, health, current events, entertainment — all from a faith perspective.
It is NOT a music site, party site, or children's entertainment site.

## Architecture
- **Stack**: Node.js/Express on port 3107, PostgreSQL on localhost:5433 (db: `jubileeverse`)
- **Shell**: Windows 11 with Git Bash (use Unix paths/syntax)
- **Static files**: `public/` directory served directly by Express

## Environments
| Name | SSH Alias | IP | Notes |
|------|-----------|-----|-------|
| Dev | *(local)* | localhost | Port 5433 for Postgres |
| UAT | `jubilee-uat` | 207.244.228.8 | Runs content audit (`ENABLE_CONTENT_AUDIT=true`) |
| Production | `jubilee-prod` | 94.72.120.231 | Managed by PM2; receives synced content from UAT |

## ⚠️ Cloudflare Access & InspireCortex API

**CRITICAL**: InspireCortex API (`https://api.inspirecortex.com`) is protected by Cloudflare Access.

**Required in `.env` for both jubileeverse.com and MasterTemplate.com:**
```
INSPIRECORTEX_CF_CLIENT_ID=a8218ddad6cc6342d0e5dea83fb7f4b4.access
INSPIRECORTEX_CF_CLIENT_SECRET=<regenerate in Cloudflare dashboard if missing>
```

**Service Token Details** (stored in Claude memory):
- Token Name: JubileeInspire
- Token ID: `dba91e39-7caf-4346-8e61-bfe26bc4d0dc`
- Client ID: `a8218ddad6cc6342d0e5dea83fb7f4b4.access`
- Protected by policy: "Cortex" (InspireCortex Platform app)
- Cloudflare Account: `b4a6c8642ee9ebf163a7d480c0cdda0c`

**If Client Secret is missing/lost:**
1. Go: https://dash.cloudflare.com → Access → Service Tokens → JubileeInspire
2. Regenerate the secret (shown only once)
3. Update both `.env` files with the new value
4. Restart servers

**Why this matters**: Image generation pipeline requires API authentication via Cloudflare Access headers.

### Article image generation — prefer the LAN GPU path (no Cloudflare)
The cloud `api.inspirecortex.com` path is Cloudflare-gated and often returns HTTP 302
(stale token). The GPU fleet is on the **same LAN**, so generate images directly
against **ComfyUI on the RTX 5090s: `http://10.0.0.52:8188` and `:8189`**
(HDC-INSPIRESERVER; RTX PRO 6000 on HPC-FLYWHEEL=10.0.0.43 is gateway-only at :8300).
Recommended MidJourney-grade model: **FLUX.1-dev fp8** (install into `D:\ComfyUI\models`
on 10.0.0.52). Full topology, model research, install steps, and the pipeline are in
**`docs/IMAGE-GENERATION-INFRA.md`**; the per-article contract is `.prompts/image-generator.md`;
the runner is `scripts/generate-article-images.js --provider comfy`.
Layers: **photoreal** = FLUX RealismLoRA (`--realism 0.7`, `flux-realism.safetensors`);
**hands** = RealismLoRA + five-finger directives + an **Impact-Pack HandDetailer** pass
(`--fix-hands`, default on) that re-renders each detected hand — installed into the 10.0.0.52
ComfyUI with deps pinned (`impact_constraints.txt` + `PIP_CONSTRAINT` in the launch scripts) so the
Wan video venv is unaffected; loading new nodes needs a one-at-a-time ComfyUI restart; **family-safe guardrail**
= isolated NudeNet classifier (`D:\inspire-imgsafe`, no torch), run one-shot via
`scripts/safety-scan.ps1 -Dir <images>` (exit 1 if any image is flagged). Model backup is
git-ignored under `models/`.

## Portal Spot Business Rules (Current Events Section)

These rules are non-negotiable and must be preserved in all future changes:

1. **Same layout for all users all day** — Portal positions are locked in `portal_daily_layout` table. Never reshuffle per-request.
2. **Midnight PST reset** — Layout regenerates at midnight `America/Los_Angeles`. Implemented via hourly scheduler in `app.listen`.
3. **Images required — hard exclusion** — Stories with no `cached_image_path` AND no `image_url` must NEVER appear in any portal slot. Enforced at three layers:
   - SQL `WHERE` in `generatePortalLayout()`
   - `.filter()` in `injectTopicCardsIntoLatest()`
   - Early return `''` in `renderTopicCard()`
4. **No empty-state messages ever** — Return empty arrays, never show "Stories are being collected" or any placeholder text to users.
5. **No date cutoff** — `generatePortalLayout()` queries all current_events with images regardless of age. Always fill portal spots.

## Key Server Functions (server.js)
- `getPstDateString()` — Returns `'YYYY-MM-DD'` in PST timezone
- `seededShuffle(array, dateStr)` — Fisher-Yates with date-derived seed for deterministic daily shuffle
- `generatePortalLayout(dateStr)` — Generates + persists layout to DB; hero(5), sidebar(3), grid(50 shuffled)
- `getDailyPortalLayout()` — Reads from DB or lazily generates; used by `/api/homepage-placement`

## DB Tables
- `current_events` — Ingested RSS articles with AI enrichment; columns: id, headline, excerpt, faith_reflection, full_article, source_name, source_url, pub_date, image_url, cached_image_path, relevance_score, topic, category_id
- `portal_daily_layout` — Daily portal lock; columns: layout_date DATE PK, hero_ids INTEGER[], sidebar_ids INTEGER[], grid_ids INTEGER[]
- `categories` — Editorial category tree (L1-L4)

## Topic Slugs → Category IDs (TOPIC_CATEGORY_MAP)
```
christian-watch-us → 775  (Faith L1)
church-us          → 784  (Church L1)
church-global      → 784  (Church L1)
faith              → 775  (Faith L1)
finance            → 5    (Finance and Accounting L1)
technology         → 11   (Technology L1)
health             → 50822 (Exercise & Health L1)
social             → 828  (Community Life L1)
entertainment      → 50821 (Entertainment & Storytelling L1)
```

## Client-Side (public/index.html)
- `injectTopicCardsIntoLatest(topicCards)` — Accepts flat array from server; inserts every 4th article in `#latestContent`
- `renderTopicCard(story)` — Returns `''` if no image; stores story in `_currentEventStoriesMap`
- `openCurrentEventArticle(id)` — Stores article data in `sessionStorage`, navigates to `/article.html`
- Section title: **"Current Events"** (element `#latestSectionTitle`)

## Article Page (public/article.html)
- Uses `marked.js` (CDN) for Markdown→HTML rendering
- Strips leading `# h1` from `full_article` before rendering (already shown in hero overlay)
- `isCurrentEvent` flag in sessionStorage article → shows "JubileeVerse" badge

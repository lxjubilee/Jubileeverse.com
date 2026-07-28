# JubileeVerse — Migration Gap Analysis (Original site vs new Next.js app)

> ## ✅ P0 implementation status (2026-06-24)
> The P0 (High-priority) backlog from §9 has been implemented. Verified against the
> **actual** backend contracts (extracted from `server.js`), which corrected several
> wrong assumptions:
> - **Article page** rebuilt as a two-column reader with the full right **sidebar**:
>   **Read Aloud** (TTS via `POST /api/tts`, play/pause/stop, female/male voice, speed,
>   seekable progress), **Translate Article** (cache `GET /api/articles/:id/translation/:lang`
>   + SSE `POST /api/articles/:id/translate`, restore-English), **Share Story**
>   (Facebook/X/LinkedIn/Copy), **Daily Bible Verse**, **Related Stories**; plus the
>   end-of-article **More Good News** grid, **reviewer inline tools** (delete/regenerate/
>   rewrite, role-gated), **role sync** (`/api/auth/me`) and **view tracking**.
> - **Reactions** rewritten to the real contract (`like`/`dislike`, `prefix:id` keys,
>   snake_case body) and **restored on home feed cards** — the old upvote/share version
>   was non-functional.
> - **Local news** fixed to the real `{stories:[{title,link,source,pubDate}]}` shape, with
>   location **persistence**.
> - **Personalize** now writes `{following,blocked}` and **filters the feed** (no schema
>   collision).
> - **Sign In** is now a branded login form posting to `POST /api/auth/login` (MFA +
>   force-reset aware), a **`/reset-password`** page was added, and the **`registered=true`**
>   banner shows after sign-up.
> - **Admin current-event editing** fixed end-to-end (carries `source_type`; loads via
>   `GET /api/admin/current-events/:id`; saves via `PATCH /api/current-events/:id` +
>   `PATCH /api/admin/articles-mgmt/current_event/:id/status`); broken `*.html` back-links fixed.
> - **Admin dashboard** now restores previously-expanded category branches + the selected
>   category's articles on load.
>
> **Backend-contract discoveries (see §10):** `POST /api/reactions` and `/api/local-news`
> use different shapes than the old code assumed (now fixed). **`POST /api/translate-batch`
> does NOT exist on this backend** — so the site-wide language-panel translation cannot work
> here regardless of frontend; the per-article SSE Translate widget (which *does* exist) was
> implemented instead. Remaining work is the **P1/P2** items below.

> ## ✅ P1 implementation status (2026-06-24)
> The P1 (Medium) backlog is largely implemented:
> - **Article**: legacy raw-HTML passthrough rendering (HTML-stored articles no longer
>   show escaped tags), "A Word of Encouragement" hope-callout.
> - **Home**: hero empty/error states with a retry button (no more infinite spinner on
>   API failure); compact in-feed **Weather / Markets / Sports** widget cards; local-news
>   **IP fallback** when geolocation is denied; opt-in **hide-story (✕) + "more" menu**
>   (follow / block topic / share) on feed cards (hidden ids persist; block updates the
>   feed filter).
> - **Prayer/Radio/Weather**: prayer speaking-line auto-scroll + scroll-reset + drag on
>   progress/volume; radio desktop listeners text + live-stream teardown/reconnect on
>   play + fixed footer player; weather real city **geocoding** (Open-Meteo) + cache TTL.
> - **Search**: direct-link fallback — builds the index from `/api/homepage-placement`
>   when the session index is absent.
> - **Settings**: preserves `?redirect=/settings`, token rotation on profile save,
>   sign-out via the auth context.
> - **Auth (`auth.tsx`)**: server-side logout on sign-out; **OIDC/cookie reconciliation**
>   (probes `/api/auth/me` when no local token so cookie-session users appear signed in);
>   fixed a pre-existing `refresh()` bug that stored the `{success,user}` envelope as the user.
> - **Admin**: session attachment list with View links (editor modal); dashboard
>   **deep category search** (matches + ancestor chain, force-expanded, highlighted);
>   **chat-panel resize** (drag handle, 300–600px, persisted to `jubileeChatWidth`).
>
> **Verified:** `tsc --noEmit` passes and `next build` is green — all 23 routes compile
> and prerender. P1 is complete.
>
> **Update (site-wide translation now works):** At the owner's request, a `POST
> /api/translate-batch` route was **added to the backend** (`server/server.js`) using the
> SAME mechanism as the original article translation — Anthropic **Claude Haiku** primary,
> **OpenAI** fallback — with a PostgreSQL `ui_translations` cache. The frontend
> (`src/lib/translate.ts`) now applies cached strings instantly, fetches only missing ones,
> and a debounced MutationObserver keeps async-loaded feed/hero content translated. So the
> language panel performs real site-wide translation. (This is the one intentional,
> owner-approved deviation from "keep the Express API unchanged.")

> ## ✅ P2 implementation status (2026-06-24)
> Worthwhile P2 polish implemented (build green, tsc clean):
> - Content-image **onError fallback** (hero, home sidebar, story cards, related list).
> - Hero rotation back to **7s** with a manual-dot timer reset + 2s cross-fade.
> - **Newsletter email-format validation** on the home card.
> - **Mobile sidebar body scroll-lock** on Music + Radio.
> - **Article back-nav referrer guard** (history only when same-host, else home).
> - Verified the finance `--finance-green/red` vars are correctly scoped (no bug).
>
> **Intentionally skipped (genuinely cosmetic / poor ROI), documented here:** the MSN-style
> **wide-card grid reflow** (`assignCardOrders`), the **daily deterministic shuffle**, and a
> wholesale **`next/image` migration** (the project deliberately uses `<img>` for proxied
> content images — the `no-img-element` warnings are expected). Article rank/prominence
> badges were left out because that data isn't carried on the public article payload.

**Date:** 2026-06-24
**Method:** Each original page (`W:\Websites\Jubileeverse.com Backup\jubileeverse.com\public\…`) was read in full and compared, feature-by-feature, against its new Next.js implementation under `w:\jubileeverse.com\src\…`. Status is one of **Implemented / Partial / Missing**, with a priority for restoring parity.

> The migration delivered a complete, building app (all 22 routes type-check and prerender). This report catalogs where the *new* implementation deliberately simplified, diverged from, or dropped behavior present in the original — i.e. the work remaining to reach full parity.

---

## 0. Executive summary

The new app is a faithful port for most pages (Music, Radio, Prayer, Sports, Finance, Weather, Hope-Restored, Chat, Welcome, Settings, Sign Up, Forgot-Password are ~90–100% complete). The **largest gaps are concentrated in three areas**, which line up with the issues you flagged:

1. **Article page** — the reader was rebuilt as a slim single-column page. The entire **right sidebar** (Read Aloud / TTS, Translate Article, Share Story, Related Stories) and the **end-of-article Related Articles** grid were dropped, along with reviewer inline tools and view tracking.
2. **Sign In** — the new `/signin` is a bare redirect (faithful to the original *stub*), but there is no styled login experience, no post-signup banner, and **no `/reset-password` page** for the password-reset email link.
3. **Home feed + shared chrome** — content-card reactions, hide-story/more menus, the weather/finance/sports widget cards, real personalization, and the dynamic-content translation pass were simplified or removed.

There are also a few **likely bugs / contract mismatches to verify against the unchanged backend** (reactions payload, local-news response shape, admin current-event editing) — see §10.

---

## 1. The three items you flagged

| Item | Status | What's needed |
|---|---|---|
| **Sign In page design differs** | By design (redirect) | The original `signin.html` was itself only a redirect to the backend `/auth/login`. In production `/auth/login` 302s to the external OIDC IdP (`jubileeinspire.com/idp`); with `LOCAL_AUTH_ENABLED=true` it returns a bare dev form. **No branded sign-in form ever existed to copy.** A full password+MFA login API *does* exist (`POST /api/auth/login`). Decision needed: keep the OIDC redirect, or build a new styled login page (mirroring the Sign Up split-layout) that posts to `/api/auth/login`. |
| **Article right sidebar** (Read Aloud, Translate, Share, Daily Verse, Related Stories) | Missing (Daily Verse partial) | Rebuild the two-column article layout with the sidebar widgets. Read Aloud → `/api/tts`; Translate → `/api/articles/:id/translate` (SSE) + `/api/articles/:id/translation/:lang`; Share → FB/X/LinkedIn/Copy; Related Stories list. Daily Verse exists but is inline, not in the sidebar. |
| **Related Articles at end of article** | Missing | Restore the end-of-article "More Good News" grid (`renderMoreArticles` / `loadRelatedArticles`). |

---

## 2. Article page — `public/article.html` → `src/app/(site)/article/[id]/`

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Read Aloud / TTS sidebar widget | **Missing** | **High** | Full engine in original (`article.html:3440-3904`): `POST /api/tts {text,voice,lang}`, play/pause/stop, female/male voice, 1x/1.5x/2x speed, seekable progress, paragraph + word-level highlighting, segment prefetch, click-word-to-start. No `/api/tts` call anywhere in new app. |
| Translate Article widget | **Missing** | **High** | ~150-language dropdown; cache via `GET /api/articles/:id/translation/:lang`; SSE stream `POST /api/articles/:id/translate`; Restore-English; auto-translate when `siteLang≠en`. |
| Share Story widget | **Partial** | **Med** | Original: Facebook / X / LinkedIn / Copy-link + toast. New: only a single `navigator.share`/clipboard button inside ReactionBar. |
| Daily Bible Verse | **Partial** | **Low** | Implemented (`useDailyVerse`) but rendered inline below the body, not as a sticky sidebar card; no hard-coded default verse fallback. |
| Related Stories (sidebar list) | **Missing** | **Med** | Up to 10 thumbnails, same-category-first ordering (`loadRelatedArticles` `article.html:1940`). |
| End-of-article "More Good News" grid | **Missing** | **Med** | `renderMoreArticles` `article.html:2406`. |
| Reviewer inline tools | **Missing** | **High** | Delete current-event (`DELETE /api/current-events/:id`), regenerate image (`POST …/regenerate-image`), rewrite (`POST /api/current-events/:id/rewrite-article`), inline title/body edit (`PATCH …`). All gated by reviewer role. |
| Role sync on load (`/api/auth/me`) | **Missing** | **High** (gates reviewer tools) | Original merges fresh role into localStorage on every article load. |
| View tracking | **Missing** | **High** | `trackView()` exists in `src/lib/article.ts` but the article page never calls it. Original fires `POST /api/track/view` once/session (`event_type:'view'`). |
| Author byline / multi-author | **Missing** | **Med** | `renderAuthorByline` with role grouping, avatars, bio excerpt, `/authors/:slug` links. |
| Markdown raw-HTML passthrough | **Partial** | **Med** | Original renders stored HTML articles as-is; new `ReactMarkdown` has no `rehype-raw`, so HTML-bodied (legacy DB) articles render as escaped text. Also `breaks:true` and leading-H1 strip differ slightly. |
| Source badge per-source colors | **Partial** | **Low** | New drops the cnn/foxnews/etc. color classes (`source` field not carried). |
| Prominence score, rank badge | **Missing** | **Low** | `score.normalized` circle + "Nth Most Prominent" star badge. |
| Two-column sticky-sidebar layout | **Missing** | **Med** | New is single 760px column; original is `1fr 300px` grid with sticky sidebar. |
| Back-nav referrer guard, hope-callout, "content being prepared" empty state | **Partial/Missing** | **Low** | Minor. |
| ReactionBar (up/down/share) | **New addition** | — | Not in original article page; see §10 for the API-contract concern. |

---

## 3. Home page + shared chrome — `public/index.html` → `src/app/(site)/page.tsx` + `components/layout/*`

| Feature | Status | Priority |
|---|---|---|
| Hero carousel (rotation, click, dots) | **Implemented** | — |
| Hero rank wording / source badge / prominence score | **Partial** | Med |
| Hero **empty & error** states | **Missing** (perpetual spinner on API failure) | Med |
| Hero/sidebar image `onerror` fallback chain | **Missing** | Low |
| Local news: geolocation + manual city | **Partial** (no IP-fallback / denied flow) | Med |
| Local news **persistence** (localStorage decision/city, no re-prompt) | **Missing** | **High** |
| Local news **API response shape** (`{success, stories[]}` w/ `link`,`pubDate`) | **Mismatch** — new reads `articles/items` + `url`/`published_at` | **High** (verify §10) |
| Current-events feed (topicCards) | **Implemented** | — |
| Inject topic card **every 4th** article | **Missing** (no surrounding static cards to interleave) | Med |
| Content-card **reactions** (counts/user/post) | **Missing on home** | **High** |
| **Hide story** + reveal-with-replacement | **Missing** | Med |
| Card **"more" menu** (follow/block/share) | **Missing** | Med |
| In-grid **weather / finance / sports** widget cards | **Missing** (only standalone routes) | Med |
| Daily verse / trending / music-radio-prayer cards | **Missing** | Low |
| Newsletter subscribe | **Implemented** (no email-regex validation) | Low |
| Daily deterministic shuffle, wide-card `assignCardOrders` | **Missing** | Low |
| Search index build + header search dropdown | **Partial** (live stories vs static; title-only match; no "no results"/Escape) | Low |
| Header media links, profile dropdown + Back Office gating, mobile menu, taxonomy nav | **Implemented** | — |
| Header-level hamburger button | **Missing** (nav-bar hamburger remains) | Low |
| **Language: dynamic-content selectors + MutationObserver** | **Missing** — only static UI strings translate; async cards/hero stay English | **High** |
| Language: static-selector coverage, language count (80 vs ~142), reload-on-change | **Partial** | Med |
| **Personalize affects the feed** | **Missing** — new popup saves `{topics}` but nothing filters the feed | **High** |
| Personalize localStorage **schema collision** (`{topics}` vs original `{following,blocked}` under same `jubileeVersePrefs` key) | **Bug** | **High** |

---

## 4. Auth — `signin/signup/forgot-password` + backend `/auth/login`

| Feature | Status | Priority |
|---|---|---|
| Sign In styled form | **Missing** (bare redirect; see §1) | **High (decision)** |
| `registered=true` post-signup banner | **Missing** (param dropped on redirect) | **High** |
| `/reset-password?token=` page | **Missing entirely** (endpoints `validate-reset-token` + `reset-password` exist) | **High** |
| Sign Up (fields, validation, modals, design) | **Implemented** | — |
| Sign Up minor: inline field-error spans, fixed footer, extension-popup blocker | **Partial/Missing** | Low |
| Forgot-password request + success + resend | **Implemented** | — |
| OIDC cookie session vs localStorage token reconciliation in `auth.tsx` | **Partial** | Med |
| `signOut()` calls backend logout endpoint | **Missing** (clears localStorage only) | Med |
| Post-login `redirect`/`next` handling | **Implemented** | — |
| MFA / `force_password_reset` UI | **Missing** (only relevant if a real login form is built) | Med |

---

## 5. Media — Music & Radio

**Music** (`music.html` → `music/`): ~95% faithful. Web-Audio synth engine, 8 albums/tracks, library/album/player UI, `?album=` deep-link all match.
- **Missing/Low:** body scroll-lock when mobile sidebar opens; seek is cosmetic (no audio reposition — faithful to original); Playlists filter / create-playlist / 3-dot are inert (parity with original).

**Radio** (`radio.html` → `radio/` + `stations.ts`): ~90% faithful. 20 stations + stream URLs + schedules, filters, favorites/follows (API + localStorage fallback), `?station=` deep-link all match.
- **Med:** desktop station rows drop the per-station **listeners** text (badge-only); audio resume reuses the same `<audio>` element (original tore down + recreated `Audio()` each play — matters for **live** streams replaying stale buffer); desktop footer player uses `position:sticky` vs original `fixed`.
- **Low:** mobile body scroll-lock; accordion max-height cap (1200px) vs `none`.

---

## 6. Prayer / Search / Settings

**Prayer** (`prayer.html` → `prayer/`): faithful guided-prayer **TTS player** (speechSynthesis), 21 prayers, categories, favorites (`jubilee_prayer_favorites`), voice/speed/seek all match.
- **High:** speaking line does **not auto-scroll** into view during playback (`scrollIntoView` dropped).
- **Med:** center content scroll not reset on prayer change; progress/volume support **click only** (no drag).
- **Low:** orphaned favorites slide-in panel (no trigger — also orphaned in original).

**Search** (`search.html` → `search/`): faithful; reads `sessionStorage["jubileeSearchIndex"]`, same filter/highlight/"More Good News".
- **Med:** dropped the homepage-scrape **fallback** (direct `/search?q=` with empty session index now errors) and the inline **article-content generator** (article bodies opened from search rely entirely on the `/article/[id]` route).
- **Adds:** category dropdown + on-page search box (enhancements).

**Settings** (`settings.html` → `settings/`): faithful; all 3 tabs; **API methods match exactly** (`PUT /api/auth/profile`, `PUT /api/auth/change-password`); password strength, toasts, Enter-submit.
- **Med:** auth-guard redirects to `/signin` **without** `?redirect=/settings`; profile-save now relies on `refresh()` — verify token rotation; sign-out bypasses `useAuth`.
- (No "preferences" tab to migrate — original had none.)

---

## 7. Topic / utility pages — Finance / Sports / Weather / Hope-Restored / Chat / Welcome

All **high-fidelity**, no High-priority regressions.
- **Finance:** verbatim datasets, geo chain, tabs, sparklines. Verify CSS vars `--finance-green/red` exist globally (else Open/Closed tint silently drops).
- **Sports:** verbatim datasets, `GET /api/sports` live-tab enrichment, standings. Faithful.
- **Weather:** geo chain + open-meteo identical. **Adds** localStorage location cache (→ can show **stale city**; original always re-detected) and a manual-city form that **doesn't geocode** (relabels only). — Med.
- **Hope-Restored:** `GET /api/portal/hope-restored`, cards, states all match. Verify taxonomy nav includes `encouragement`/`faith-builders` slugs the original hardcoded.
- **Chat:** API verified — posts `/api/chat` `{message,history}`, reads `{success,response,error}` (matches; there is **no** `/api/chat/message`). Markdown rendering upgraded. **Missing:** the admin "Dashboard" header button (Low). History is in-memory in both (no persistence).
- **Welcome:** faithful `/welcome.mp4` splash → `/chat`. (Confirm backend hosts `welcome.mp4`.)

---

## 8. Admin / back office

**Dashboard** (`admin/dashboard.html` → `admin/`): high-fidelity; category CRUD, articles, current-events queue, pulse tasks, admin chat, resize, localStorage keys all match.
- **High:** category tree does **not auto-load previously-expanded branches** on mount (`autoLoadExpandedNodes` not ported) — persisted-expanded nodes render empty; restored `selectedCategoryId` doesn't auto-load its articles.
- **Med:** category search filters root nodes only (no deep expand); editor doesn't list existing attachments; chat-panel resize handle missing.
- **Low:** breadcrumb path, content-type re-render, misc localStorage keys, **no responsive media queries**.

**Articles management** (`admin/articles.html` → `admin/articles/`): near-complete; stats, list, select/bulk status (PATCH — matches), category tree.
- **High:** **editing a `current_event` row is broken** — Edit link always goes to `/admin/article/{id}` regardless of `source_type`.

**Single-article editor** (`admin/article.html` + the `articles.html` modal → `admin/article/[id]/`):
- **High:** no `current_event` support (never calls `GET /api/admin/current-events/:id`, no CE save via the two PATCH calls, status select missing `approved/unapproved`); **broken "Back to Articles" links** → `/admin/articles.html` (404; should be `/admin/articles`).
- **Net-new (verify backend):** hero-image PATCH + attachments POST.

**Scanner** (`scanner.html` → `scanner/`): near 1:1 faithful (sources, scoring, clustering, image cascade, `/api/scanner/rss/:slug`, `/api/scanner/download-image`, shortcuts). Approve/Publish is an in-memory stub — **matches the original** (was always a stub).

**Reviewer activity** (`reviewer-activity.html` → `reviewer-activity/`): faithful 1:1 (`GET /api/admin/reviewer-activity`, stats, table, diff drill-down, filters).

**Cross-cutting (High):** the new `(admin)` group gates on **`canAccessCms`** (6 roles + entitlement bypass). The original **articles.html** and **reviewer-activity.html** were gated **reviewer-only**. This widens access to those two pages — confirm whether that's intended; if not, add a page-level role check.

---

## 9. Consolidated priority backlog

### P0 — High (functional gaps / likely bugs)
1. **Article sidebar + Related Articles** (your flagged items): Read Aloud (`/api/tts`), Translate (`/api/articles/:id/translate` SSE + translation cache), Share widget, Related Stories sidebar, end-of-article grid, two-column layout. *(§2)*
2. **Article reviewer tools + role sync + view tracking** (`/api/auth/me`, delete/regenerate/rewrite/inline-edit, `/api/track/view`). *(§2)*
3. **Sign In decision + `/reset-password` page + `registered=true` banner.** *(§1, §4)*
4. **Admin current-event editing** (pass `source_type`; CE load + dual-PATCH save + approved/unapproved status) and **fix broken `/admin/articles.html` back-links.** *(§8)*
5. **Home content-card reactions** + **verify/fix the reactions API contract** (§10).
6. **Home: local-news persistence + verify response-shape mismatch** (§10).
7. **Personalize must filter the feed** + **fix `jubileeVersePrefs` schema collision.** *(§3)*
8. **Translation: dynamic-content selectors + MutationObserver** so stories/hero translate. *(§3)*
9. **Admin dashboard: restore expanded category branches on load.** *(§8)*
10. **Admin auth scope:** decide reviewer-only vs `canAccessCms` for articles-mgmt + reviewer-activity. *(§8)*

### P1 — Medium
- Article: author byline, markdown raw-HTML passthrough, source-color badges, hope-callout.
- Home: hero empty/error states, hide-story + more menu, in-grid weather/finance/sports cards, inject-every-4th (when static cards return), local-news IP fallback.
- Prayer: speaking-line auto-scroll, center-scroll reset, drag on progress/volume.
- Search: index fallback for direct links, article-body content parity.
- Settings: preserve `redirect` param, token-rotation on save, server-side sign-out.
- Radio: desktop listeners text, live-stream resume teardown, sticky→fixed player.
- Weather: stale-cache behavior, manual-city geocoding.
- Auth: OIDC-cookie ↔ localStorage reconciliation, backend logout.
- Admin: deep category search, editor attachment list, chat-panel resize.
- Translation: language-list count + static-selector coverage; verify it reaches utility pages.

### P2 — Low
Cosmetic/edge items throughout (image onerror chains, mobile scroll-lock, header hamburger, daily shuffle/wide cards, source badges, page `<title>`s, dead-code cleanup, finance CSS-var verification, etc.).

---

## 10. Items to VERIFY against the unchanged backend (potential real bugs)

These are contract questions where the new code may not match what `server/server.js` actually returns/expects:

1. **Reactions API.** New `ReactionBar` posts `{ articleId, reaction:'upvote'|'downvote'|'share' }` and reads `counts.upvote/downvote/share_count`. The original home cards posted `{ article_id, article_type, reaction_type:'like'|'dislike' }` and read `counts[key].likes` (keys like `ce:{id}`). **If the backend expects the original shape, the new ReactionBar is non-functional.** Check `/api/reactions`, `/api/reactions/counts`, `/api/reactions/user` in server.js and align.
2. **Local news.** New home reads `data.articles || data.items` with `url`/`source_name`/`published_at`. Original read `data.stories` with `link`/`pubDate`. Check `/api/local-news` response shape; if it returns `{success, stories}`, the new home shows nothing.
3. **Admin single-article hero-image + attachments** endpoints (`PATCH /api/admin/articles/:id/hero-image`, `POST /api/admin/articles/:id/attachments`) — confirm they exist/behave as assumed.
4. **`welcome.mp4`** is served from the backend public dir (proxied) — confirm it's present there.
5. **Finance CSS variables** `--finance-green` / `--finance-red` — confirm defined globally or scope them.

---

*This document is the implementation backlog for reaching full parity. Pages not listed as gaps are at parity. File:line references for every item are in the per-area audit notes used to produce this report.*

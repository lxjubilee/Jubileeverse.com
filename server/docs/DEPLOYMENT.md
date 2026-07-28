# JubileeVerse.com — Deployment Architecture & Runbook

## Server Architecture

Three environments serve the site:

| Environment | SSH Alias | IP | Role | Port | URL |
|-------------|-----------|-----|------|------|-----|
| Dev | local | localhost | Local development | 3107 | localhost:3107 |
| UAT | `jubilee-uat` | 207.244.228.8 | Testing & content audit | 3107 | uat.jubileeverse.com |
| Production | `jubilee-prod` | 94.72.120.231 | Live site | 3107 | www.jubileeverse.com |

> **Important:** `www.jubileeverse.com` DNS points to **jubilee-prod** (94.72.120.231).
> `uat.jubileeverse.com` points to **jubilee-uat** (207.244.228.8) port 3107.

### Repo Paths on Servers
- **jubilee-uat**: `/var/www/jubileeverse.com/`
- **jubilee-prod**: `/var/www/JubileeVerse.com/` ← note the capital letters

### nginx Configs (jubilee-uat)
- `/etc/nginx/sites-available/uat.jubileeverse.com` → proxies to `127.0.0.1:3107`

---

## Content Audit Architecture

AI content repair (Claude API calls) runs **only on UAT**. Results are automatically pushed to Production.

| Env var | UAT | Production | Dev |
|---------|-----|------------|-----|
| `ENABLE_CONTENT_AUDIT` | `true` | *(not set)* | *(not set)* |
| `SYNC_TARGET_URL` | `http://94.72.120.231:3107` | *(not set)* | *(not set)* |
| `ADMIN_SYNC_SECRET` | `<secret>` | `<same secret>` | *(not set)* |

After `runFullContentRepair` completes on UAT, it automatically POSTs all `full_article` content
to Production via `POST /api/admin/sync-articles` (protected by `ADMIN_SYNC_SECRET`).

---

## Deploy to UAT (uat.jubileeverse.com)

```bash
# 1. Push to GitHub from dev
git push origin main

# 2. Pull on jubilee-uat
ssh jubilee-uat "cd /var/www/jubileeverse.com && git pull origin main"

# 3. Restart UAT server
ssh jubilee-uat "pkill -f 'node server.js'; sleep 1; cd /var/www/jubileeverse.com && nohup node server.js >> logs/server.log 2>&1 &"

# 4. Verify
ssh jubilee-uat "ss -tlnp | grep 3107"
```

---

## Deploy to Production (www.jubileeverse.com)

```bash
# 1. Push to GitHub from dev
git push origin main

# 2. Pull on jubilee-prod
ssh jubilee-prod "cd /var/www/JubileeVerse.com && git pull origin main"

# 3. Restart production server (managed by PM2)
ssh jubilee-prod "cd /var/www/JubileeVerse.com && pm2 restart jubileeverse"

# 4. Verify
ssh jubilee-prod "ss -tlnp | grep 3107"
```

---

## Common Issues & Fixes

### `git pull` fails with "local changes would be overwritten"
```bash
ssh jubilee-prod "cd /var/www/JubileeVerse.com && git stash && git pull origin main"
```

### Server won't start — `MODULE_NOT_FOUND`
```bash
ssh jubilee-prod "cd /var/www/JubileeVerse.com && npm install"
```

### `EADDRINUSE` — port already in use
The server already started successfully on a previous attempt. Check:
```bash
ssh jubilee-prod "ss -tlnp | grep 3107"
```

---

## Database Connections

`server.js` uses a single PostgreSQL pool (`pgPool`) pointing to the `jubileeverse` database
across all three environments. The `inspirePool` variable is an alias for `pgPool`.

| Env var | Dev | UAT | Production |
|---------|-----|-----|------------|
| `DB_HOST` | `localhost` | `localhost` | `localhost` |
| `DB_PORT` | `5433` | `5432` | `5432` |
| `DB_NAME` | `jubileeverse` | `jubileeverse` | `jubileeverse` |

---

## Key Features Implemented (Feb 18, 2026)

### Article Translation
- **Endpoint**: `POST /api/articles/:id/translate` — streams via SSE using Claude Haiku
- **Cache**: `GET /api/articles/:id/translation/:lang` — checks `article_translations` table in pgPool
- **Fallback content**: Articles without DB IDs send `fallback_title` + `fallback_content` from DOM
- **Client**: `streamTranslation()` in `public/article.html` renders chunks via `bodyEl.innerHTML = htmlPart` on every chunk
- **Cache check isolation**: GET cache check is in its own try/catch — failure falls through to streaming rather than aborting
- **TTS activation**: Play button enables after first `</p>` lands in streaming content

### Language Selector
- **143 languages** (all TTS-supported Microsoft Edge neural voices)
- English (United States) pinned first, rest sorted A-Z
- Selecting "English (United States)" restores original article + enables TTS (does NOT translate)
- Previous language cookie (`tl_prev_code`, `tl_prev_name`, 365-day expiry)
- "TRANSLATE TO: [Language] (Previously Used)" link below dropdown
- "↩ BACK TO: English (Original)" link when article is translated
- Smart dropdown positioning (opens up if insufficient space below)
- 12-row visible height

### TTS (Read Aloud)
- Pre-fetch next paragraph while current plays
- 3–5 second natural pause between paragraphs
- Play button disabled during translation, re-enabled after first paragraph ready

### Catch-All Route Fix
- `app.get('*', ...)` moved to after all API routes in `server.js`
- Previously shadowed `GET /api/articles/:id/translation/:lang` returning HTML instead of JSON

### Static Assets
- `public/images/personas/jubilee.png` — header logo icon (tracked in git)
- `public/images/jubilee-profile.png` — favicon for auth pages (tracked in git)
- `public/images/personas/` — all AI persona profile images (tracked in git)
- `public/images/prominence/` — dynamically generated news hero images (NOT in git, live on server only)

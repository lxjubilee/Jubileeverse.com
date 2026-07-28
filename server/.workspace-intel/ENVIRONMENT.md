# JubileeVerse.com — Environment Configuration

## Dev Environment (Local)

**Host**: localhost  
**Node Port**: 3107  
**Database**: localhost:5433 (SSH tunnel required)  
**Database Name**: jubileeverse  
**Database User**: jubileeverse  

### Setup
```bash
# SSH tunnel to shared DB
ssh dev-server -L 5433:postgres.internal:5432

# Environment variables (.env)
NODE_ENV=development
PORT=3107
DB_HOST=localhost
DB_PORT=5433
DB_NAME=jubileeverse
DB_USER=jubileeverse
DB_PASSWORD=****
ANTHROPIC_API_KEY=sk-ant-****
OPENAI_API_KEY=sk-****

# Start server
npm start
# or with watch mode: npm run dev
```

### Features
- ✅ Hot reload (nodemon on file changes)
- ✅ Verbose logging (console.log not suppressed)
- ✅ No content audit (ENABLE_CONTENT_AUDIT=false)
- ✅ CORS enabled (allows requests from :3000 for Cockpit dev)
- ✅ No rate limiting
- ✅ All images saved locally (no S3)

### Testing
```bash
npm test                    # Run all tests
npm run lint              # ESLint
npm run verify-deployment # 18-check pre-deploy
```

---

## UAT Environment (Staging)

**Host**: jubilee-uat (207.244.228.8)  
**Node Port**: 3107  
**SSH**: `ssh jubilee-uat`  
**Database**: Shared (localhost:5433 from UAT server)  

### Deployment
```bash
# On jubilee-uat server:
cd /var/www/JubileeVerse.com
git fetch origin
git reset --hard origin/main
pkill -f 'node.*server.js' || true
sleep 2
nohup node server.js > /tmp/jv-deploy.log 2>&1 &
```

### Features
- ✅ Content audit ENABLED (ENABLE_CONTENT_AUDIT=true)
- ✅ Runs `_runContentAudit()` every 30 seconds
- ✅ Flags articles for theology/plagiarism/tone issues
- ✅ Weekly manual deployments (testing gate before prod)
- ✅ All changes synced to production (one-way mirror)
- ✅ Email notifications on audit failures

### Verification
```bash
# Check server status
ssh jubilee-uat "curl -s http://localhost:3107/health | jq ."

# View logs
ssh jubilee-uat "tail -50 /tmp/jv-deploy.log"

# Check processes
ssh jubilee-uat "ps aux | grep node"
```

### Rollback
```bash
ssh jubilee-uat "cd /var/www/JubileeVerse.com && git reset --hard <prev-commit> && pkill node; sleep 2; nohup node server.js &"
```

---

## Production Environment

**Host**: jubilee-prod (94.72.120.231)  
**Node Port**: 3107  
**SSH**: `ssh jubilee-prod`  
**Database**: Shared (localhost:5433 from prod server)  
**Process Manager**: PM2  
**Public DNS**: www.jubileeverse.com, jubileeverse.com  

### Deployment
```bash
# Production uses same workflow as UAT
# (Separate branch NOT required - main branch used everywhere)

ssh jubilee-prod "cd /var/www/JubileeVerse.com && git fetch origin && git reset --hard origin/main && pkill -f 'node.*server.js' 2>/dev/null || true && sleep 2 && nohup node server.js > /tmp/jv-deploy.log 2>&1 &"
```

### Process Management (PM2)
```bash
# Check PM2 status
ssh jubilee-prod "pm2 status"

# View live logs
ssh jubilee-prod "pm2 logs JubileeVerse"

# Restart service
ssh jubilee-prod "pm2 restart JubileeVerse"

# Graceful reload (zero downtime)
ssh jubilee-prod "pm2 reload JubileeVerse"
```

### Features
- ✅ Content audit DISABLED (performance)
- ✅ PM2 auto-restart on crash
- ✅ 24/7 monitoring
- ❌ No direct git push (pull-based only)
- ✅ Immutable snapshots at every release
- ✅ Auto-canary testing on deploy

### Health Checks
```bash
# Homepage
curl -I https://www.jubileeverse.com/

# API health
curl https://www.jubileeverse.com/health | jq .

# Article page
curl -I https://www.jubileeverse.com/covenant-and-identity/sample-article.html

# Portal API
curl https://www.jubileeverse.com/api/v1/admin/portal/pages?site_id=1
```

### Logs & Monitoring
```bash
# Real-time logs
ssh jubilee-prod "tail -f /tmp/jv-deploy.log"

# Error logs (last hour)
ssh jubilee-prod "grep 'ERROR\|error' /tmp/jv-deploy.log | tail -20"

# Performance metrics
ssh jubilee-prod "ps aux | grep node"  # Check memory usage
```

### Rollback Procedure (if needed)
```bash
# List available snapshots
ssh jubilee-prod "ls -lh snapshots/"

# Rollback to specific version
curl -X POST https://www.jubileeverse.com/api/v1/admin/rollback \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"snapshot_id":"v8.0.0042"}'

# Manual fallback (via git)
ssh jubilee-prod "cd /var/www/JubileeVerse.com && git reset --hard <commit-hash> && pkill node; sleep 2; nohup node server.js &"
```

---

## Environment Variables

### Required Variables (All Environments)

```bash
# Server
NODE_ENV=development|staging|production
PORT=3107
APP_BASE_URL=http://localhost:3107|https://jubileeverse.com

# Database (PostgreSQL)
DB_HOST=localhost
DB_PORT=5433
DB_NAME=jubileeverse
DB_USER=jubileeverse
DB_PASSWORD=****

# API Keys (Anthropic)
ANTHROPIC_API_KEY=sk-ant-****
ANTHROPIC_API_KEY_PRIMARY=sk-ant-****
ANTHROPIC_API_KEY_BACKUP=sk-ant-****

# API Keys (OpenAI)
OPENAI_API_KEY_PRIMARY=sk-****
OPENAI_API_KEY_BACKUP=sk-****

# Image Generation (InspireCortex)
IC_API_URL=https://api.inspirecortex.com
IC_API_KEY=****
IC_JWT=eyJ0...  # JWT for IC authentication

# OIDC Authentication
OIDP_CLIENT_ID=****
OIDP_CLIENT_SECRET=****
OIDP_DISCOVERY_URL=https://idp.example.com/.well-known/openid-configuration
```

### Optional Variables

```bash
# Content Audit
ENABLE_CONTENT_AUDIT=true|false  # Dev: false, UAT: true, Prod: false

# Logging
LOG_LEVEL=debug|info|warn|error

# Performance
DB_POOL_SIZE=20  # Max concurrent connections
SESSION_TTL=86400  # Session expiry (seconds, default 24h)

# Features
ENABLE_IMAGE_GENERATION=true|false
ENABLE_PORTAL_REGEN=true|false
```

---

## Database Migrations (Automatic)

On server startup, the following migrations run (idempotent):

1. Create `jv_content_objects` table (if not exists)
2. Create `jv_taxonomy` table (if not exists)
3. Add `display_order` column to `jv_taxonomy` (if not exists)
4. Create `portal_pages` table (if not exists)
5. Create `image_generation_jobs` table (if not exists)
6. Create indexes on frequently queried columns
7. Set `jv_taxonomy.display_order` for JubileeVerse categories

No manual migrations required. Schema updates handled by ORM/SQL statements in `server.js`.

---

## Scheduled Jobs (By Environment)

### Dev & Staging
- **Hourly**: Check if portal needs regeneration (midnight PST)
- **Every 30s**: Content audit (if ENABLE_CONTENT_AUDIT=true)
- **Every 60s**: Health checks (PM2)

### Production
- **Hourly**: Check if portal needs regeneration
- **Every 60s**: PM2 health checks
- ❌ Content audit DISABLED (performance)
- ✅ Canary tests on deploy (auto-rollback if risk > 0.7)

---

## Monitoring & Alerts

### Health Endpoint
```bash
GET /health
Response:
{
  "status": "ok",
  "uptime": 3600,
  "timestamp": "2026-04-11T10:30:00Z",
  "database": "connected",
  "requests": {"total": 15000, "errors": 2},
  "latency_ms": 45
}
```

### Error Tracking
- All errors logged to `/tmp/jv-deploy.log`
- Errors include: timestamp, endpoint, error message, stack trace
- Audit trail: jv_audit_log table (searchable)

### Performance Metrics
- Response time: Track API latency per endpoint
- Database: Connection pool usage, query times
- Memory: Node.js process memory (alert if >256MB)
- Uptime: Track restart events (alert if >3 restarts/hour)

---

**Document Version**: 1.0  
**Last Updated**: 2026-04-11  
**Status**: ACTIVE

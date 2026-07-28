# JubileeVerse.com — Cortex Integration Map (Phase 4)

## Current State (Pre-Phase 4)

Cortex is accessible but not fully integrated with release management. Current deployment:

```bash
ssh jubilee-prod "cd /var/www/JubileeVerse.com && git reset --hard origin/main && pkill node; nohup node server.js &"
```

No formal release staging, canary testing, or rollback automation (manual steps only).

---

## Phase 4 Plan: Cortex Enterprise Release Management

### Cortex Server Setup

**Location**: `cortex/` directory  
**Port**: 3108 (separate from main server)  
**Authentication**: JWT + role-based access  

### API Endpoints (to be implemented)

#### Authentication
```
POST /cortex/auth/login
  Body: { username, password }
  Returns: { token, refreshToken, expiresIn }

POST /cortex/auth/refresh
  Body: { refreshToken }
  Returns: { token, expiresIn }

POST /cortex/auth/logout
  Headers: Authorization: Bearer <token>
```

#### Machine Registration
```
POST /cortex/machines/register
  Body: { hostname, ip, sslThumbprint, workstationVersion }
  Returns: { machineId, status }

GET /cortex/machines/:id
  Returns: { machineId, hostname, status, lastHeartbeat }

PUT /cortex/machines/:id/approve
  Role: admin
  Approve machine for deployments
```

#### Release Management
```
POST /cortex/releases
  Body: { version, changeLog, branch }
  Returns: { releaseId, status: 'DRAFT' }

GET /cortex/releases/:id
  Returns: { releaseId, version, status, createdAt, promotedAt }

PUT /cortex/releases/:id/promote
  Body: { targetEnv: 'UAT' | 'PRODUCTION' }
  Roles: 'developer' for UAT, 'architect' for PRODUCTION
  Returns: { releaseId, newStatus }

DELETE /cortex/releases/:id
  Soft delete (archive)
```

#### Canary Testing
```
POST /cortex/canary/test
  Body: { releaseId }
  Async: Runs regression tests + health checks
  Returns: { canaryId, status: 'running' }

GET /cortex/canary/:id/status
  Returns: { riskScore, errorRate, responseTime, uptime, passed: true|false }

GET /cortex/canary/:id/results
  Returns: { testResults, vulnerabilities, performanceDelta }
```

#### Snapshots & Rollback
```
POST /cortex/snapshots
  Body: { releaseId }
  Create immutable snapshot
  Returns: { snapshotId, size, checksum }

GET /cortex/snapshots?releaseId=...
  List available snapshots

POST /cortex/rollback
  Body: { snapshotId }
  Role: admin only
  Returns: { status: 'rolling_back', eta: '60s' }
```

---

## Release State Machine (to be implemented)

```
    ┌─────────┐
    │ DRAFT   │ (developer creates release)
    └────┬────┘
         │ POST /releases/:id/promote?target=UAT
         ▼
    ┌─────────────┐
    │ UAT         │ (canary testing runs automatically)
    └────┬────────┘
         │ Canary passes (riskScore < 0.3)
         ▼
    ┌──────────────────────────┐
    │ APPROVED_FOR_PRODUCTION  │ (architect approval required)
    └────┬─────────────────────┘
         │ POST /releases/:id/promote?target=PRODUCTION
         ▼
    ┌─────────────┐
    │ PRODUCTION  │ (canary monitoring continues)
    └────┬────────┘
         │ Canary fails (riskScore >= 0.7)
         ▼
    ┌─────────────┐
    │ ROLLED_BACK │ (automatic on canary failure)
    └─────────────┘
```

---

## Integration with JubileeVerse Deployment

### Current Workflow (Manual)
1. Develop locally
2. git commit + git push
3. SSH to jubilee-prod, git pull, restart Node
4. Curl health check

### Phase 4 Workflow (Cortex-Based)
1. Develop locally
2. git commit + git push
3. POST /cortex/releases (creates DRAFT)
4. PUT /cortex/releases/:id/promote?target=UAT (UAT canary starts)
5. Canary tests run (20 min automated)
6. PUT /cortex/releases/:id/promote?target=PRODUCTION (architect approval)
7. Production deployment (git pull, restart, health check automated)
8. Continuous canary monitoring (alert on errors)

### Risk Scoring Algorithm (to be implemented)

```
riskScore = 0

if errorRate > 5%:         riskScore += 0.4
if responseTime > 2000ms:  riskScore += 0.2
if uptime < 99.5%:        riskScore += 0.3
if testPassRate < 90%:    riskScore += 0.3

Auto-rollback if riskScore >= 0.7
```

---

## Integration Points with JubileeVerse

### Pre-Release Checklist (to be implemented)

1. **Code Quality**
   - `npm run lint` passes
   - `npm run test` passes (all 51 tests)
   - `node scripts/verify-deployment.js` passes (18 checks)

2. **Feature Locking**
   - Locked features not modified (or contract attached)
   - Regression tests for all locked feature changes

3. **Database**
   - All migrations idempotent (can run multiple times)
   - Schema changes backward-compatible
   - No data loss scripts

4. **Configuration**
   - All environment variables documented
   - No hardcoded secrets (use .env)
   - Build fingerprint matches production profile

---

## Snapshot Management (to be implemented)

### Snapshot Creation
```bash
# At every release
tar -czf snapshots/v{version}-{timestamp}.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=logs \
  .
```

### Snapshot Storage
- Location: `snapshots/` directory (git-ignored)
- Retention: Last 20 snapshots (cleanup oldest on new release)
- Checksum: SHA-256 for integrity verification

### Rollback Procedure
```bash
# Extract snapshot
tar -xzf snapshots/v8.0.0042.tar.gz -C /var/www/JubileeVerse.com

# Restart services
pkill -f 'node.*server.js'
sleep 2
cd /var/www/JubileeVerse.com && nohup node server.js &

# Verify health
curl http://localhost:3107/health
```

---

## Integration Checklist (Phase 4)

- [ ] Create `cortex/server.js` (Express app, port 3108)
- [ ] Implement auth middleware (JWT, role checks)
- [ ] Implement release endpoints (CRUD + state machine)
- [ ] Implement canary testing (health checks + regression)
- [ ] Implement snapshot management (create/list/restore)
- [ ] Create `cortex_releases` table (schema + migrations)
- [ ] Create `cortex_machines` table (schema + migrations)
- [ ] Update `release.sh` to call Cortex API
- [ ] Update `publish.sh` to call Cortex API
- [ ] Test state machine transitions
- [ ] Test auto-rollback on canary failure
- [ ] Document for operations team

---

**Document Version**: 1.0  
**Last Updated**: 2026-04-11  
**Status**: PLANNED (Phase 4)  
**Target**: Week 4-5 of MasterTemplate integration

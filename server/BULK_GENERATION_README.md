# Bulk Article Generation via Subcategories

This system generates 1000+ articles per category using the top 100 subcategories from specialized prompt files.

## Overview

The bulk generation system:
1. **Reads** Top 100 Subcategories files from `prompts/` folder
2. **Generates** unique 1500+ word articles for each subcategory using Claude API
3. **Stores** articles to PostgreSQL database with taxonomy mappings
4. **Parallelizes** via 10-20 concurrent workers
5. **Tracks** progress persistently across worker runs

## Categories Covered

Five primary category sets (each with 100 scored subcategories):
- **Celebration & Mishpakhah** — Family, feast, gathering, covenant celebration
- **Torah & Hebraic Insights** — Scripture, language, Hebrew context, interpretation
- **Shalom & Salvation** — Peace, wholeness, redemption, reconciliation
- **Covenant & Identity** — Relationship with God, belonging, purpose, inheritance
- **Teshuvah & Restoration** — Return, healing, transformation, repentance

## Quick Start

### Option 1: PowerShell (Windows 11)

```powershell
# Launch 15 workers in parallel
.\scripts\launch-bulk-generation.ps1 -NumWorkers 15

# Or use default (15 workers):
.\scripts\launch-bulk-generation.ps1

# Monitor progress:
Get-Content -Path logs/bulk-subcategory-generation.log -Wait
Get-Content -Path logs/worker-1.log -Wait
```

### Option 2: Bash (Git Bash / WSL)

```bash
# Launch 15 workers in parallel
bash scripts/launch-bulk-generation.sh 15

# Or use default (15 workers):
bash scripts/launch-bulk-generation.sh

# Monitor progress:
tail -f logs/bulk-subcategory-generation.log
tail -f logs/worker-1.log
```

### Option 3: Manual Node (Single Worker)

```bash
# Start one worker
node workers/bulk-subcategory-generation.js

# Or with specific worker ID:
WORKER_ID=manual-test node workers/bulk-subcategory-generation.js

# Or start 3 workers in series:
for i in {1..3}; do WORKER_ID=worker-$i node workers/bulk-subcategory-generation.js & done
```

## How It Works

### Worker Process

Each worker:
1. Loads all 5 subcategory files (500 total prompts)
2. Reads progress tracking files
3. Processes remaining (uncompleted) subcategories
4. For each subcategory:
   - Generates article via Claude Opus 4.6 API (1500+ words)
   - Saves to `jv_content_objects` table
   - Maps to taxonomy via `jv_content_taxonomy_map`
   - Logs progress to worker-specific file
5. Writes progress after each article
6. Exits gracefully on SIGINT/SIGTERM

### Concurrency & Distribution

**Multiple Workers**:
- Each worker independently processes unfinished subcategories
- Workers share a single progress file per subcategory set
- No coordination needed — lock-free via file-based progress tracking
- Safe for 10-20 concurrent workers

**Per-Worker Concurrency**:
- 2 parallel API calls per worker (to avoid rate limits)
- 3-second minimum delay between requests (configurable)

### Progress Tracking

Progress file: `logs/subcategory-progress-{WORKER_ID}.json`

```json
{
  "categories": {
    "Celebration-and-Mishpakhah": {
      "processed": [
        "Celebration-and-Mishpakhah:The Feast Table of Yahuah...",
        "Celebration-and-Mishpakhah:What is Mishpakhah..."
      ],
      "failed": 0
    }
  },
  "totalGenerated": 47,
  "startTime": "2026-04-11T11:15:00.000Z"
}
```

## Configuration

### Environment Variables

Set in `.env` or shell:

```bash
# Anthropic API (required)
ANTHROPIC_API_KEY_PRIMARY=sk-ant-api03-...
ANTHROPIC_API_KEY_BACKUP=sk-ant-api03-...

# Database (optional, defaults shown)
DB_HOST=localhost
DB_PORT=5433
DB_NAME=jubileeverse
DB_USER=postgres
DB_PASSWORD=jubilee2026
```

### Worker Configuration

In `workers/bulk-subcategory-generation.js`, edit:

```javascript
const CONCURRENCY = 2;      // Parallel API calls per worker
const MIN_DELAY_MS = 3000;  // Minimum ms between requests
```

## Output & Logging

### Log Files

- `logs/bulk-subcategory-generation.log` — Shared master log
- `logs/worker-1.log` — Worker 1 output
- `logs/worker-2.log` — Worker 2 output
- ... etc

### Log Format

```
[2026-04-11T11:15:47.123Z] [worker-1] ✓ Loaded 100 subcategories from Celebration-and-Mishpakhah
[2026-04-11T11:15:48.456Z] [worker-1] → Celebration-and-Mishpakhah [id:332]: 0 done, 100 remaining
[2026-04-11T11:15:52.789Z] [worker-1]   → Generating [1/100]: The Feast Table of Yahuah: You Have a Seat (score: 98, tier: Foundational)
[2026-04-11T11:16:15.234Z] [worker-1]     ✓ Generated: "The Feast Table of Yahuah: A Call to Belonging"
[2026-04-11T11:16:15.567Z] [worker-1]     ✓ Saved: 550e8400-e29b-41d4-a716-446655440000
```

## Monitoring

### Real-Time Progress

```bash
# Watch shared log (all workers)
tail -f logs/bulk-subcategory-generation.log

# Watch specific worker
tail -f logs/worker-3.log

# Count total articles generated so far
grep "✓ Saved:" logs/*.log | wc -l

# Count by category
grep "→" logs/*.log | cut -d':' -f4 | sort | uniq -c

# Count articles in database
psql -h localhost -p 5433 -U postgres -d jubileeverse \
  -c "SELECT COUNT(*) FROM jv_content_objects WHERE object_type='article';"
```

### Database Queries

```sql
-- Total articles per category
SELECT jt.name, COUNT(co.id) as count
FROM jv_taxonomy jt
LEFT JOIN jv_content_taxonomy_map ctm ON ctm.taxonomy_node_id = jt.id
LEFT JOIN jv_content_objects co ON co.id = ctm.uuid_object_id AND co.object_type = 'article'
WHERE jt.level = 2
GROUP BY jt.id, jt.name
ORDER BY count DESC;

-- Articles generated in last 24 hours
SELECT COUNT(*) FROM jv_content_objects
WHERE object_type = 'article'
  AND created_at > NOW() - INTERVAL '24 hours'
  AND extension_data->>'generation_source' = 'bulk-subcategory-generation';

-- Progress by subcategory
SELECT 
  extension_data->>'subcategory_topic' as topic,
  COUNT(*) as count
FROM jv_content_objects
WHERE object_type = 'article'
  AND extension_data->>'generation_source' = 'bulk-subcategory-generation'
GROUP BY extension_data->>'subcategory_topic'
ORDER BY count DESC;
```

## Troubleshooting

### Database Connection Error

```
✗ Database error: password authentication failed for user "postgres"
```

**Solution**: Ensure SSH tunnel to database is active:

```bash
# Check if tunnel is running
ssh -L 5433:localhost:5432 jubilee-uat

# Or for production
ssh -L 5433:localhost:5432 jubilee-prod
```

### API Rate Limit Errors

```
✗ Error: 429 Too Many Requests
```

**Solution**: Increase `MIN_DELAY_MS` in worker script:

```javascript
const MIN_DELAY_MS = 5000;  // Increase from 3000
```

Or reduce CONCURRENCY:

```javascript
const CONCURRENCY = 1;  // Reduce from 2
```

### Out of Memory

```
FATAL ERROR: CALL_AND_RETRY_LAST allocation failed
```

**Solution**: Reduce number of workers:

```powershell
# Instead of 20, use 5-8
.\scripts\launch-bulk-generation.ps1 -NumWorkers 5
```

### Check Article Content

```javascript
// In psql or Node.js
SELECT 
  title, 
  extension_data->>'word_count' as word_count,
  LENGTH(extension_data->>'body') as body_length
FROM jv_content_objects
WHERE object_type='article' AND extension_data->>'generation_source'='bulk-subcategory-generation'
LIMIT 5;
```

## Target Numbers

**Goal**: 1000 articles per category

- **Celebration & Mishpakhah**: 0 → 1000 (100 subcategories × 10 articles each)
- **Torah & Hebraic Insights**: 0 → 1000
- **Shalom & Salvation**: 0 → 1000
- **Covenant & Identity**: 0 → 1000
- **Teshuvah & Restoration**: 0 → 1000

**Total**: ~5,000 new articles

**Estimated Time** (with 15 workers at ~3 min/article):
- 500 subcategories ÷ 15 workers = ~34 subcategories per worker
- 34 × 3 min = ~102 minutes (1.7 hours) per worker
- **Expected completion: 2-3 hours** (with overlapping workers)

## Next Steps

1. Ensure database SSH tunnel is active
2. Verify `.env` has valid ANTHROPIC_API_KEY
3. Run sanity check: `node scripts/test-bulk-generation.js`
4. Launch workers: `.\scripts\launch-bulk-generation.ps1 -NumWorkers 15`
5. Monitor progress: `tail -f logs/bulk-subcategory-generation.log`
6. Verify in database after 30+ minutes

## Advanced: Resume / Continue Generation

Generation automatically resumes where it left off. To restart from scratch:

```bash
# Delete progress files
rm logs/subcategory-progress-*.json

# Start fresh
.\scripts\launch-bulk-generation.ps1 -NumWorkers 15
```

To skip a category:

```bash
# Edit progress file manually
# Remove entries from the "processed" array for that category
```

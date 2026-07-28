"""
remove-sqlite.py — Remove SQLite initialization block from server.js
"""

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

SQLITE_BLOCK_START = """// =============================================================================
// DATABASE SETUP
// ============================================================================="""

SQLITE_BLOCK_END = """// ── Phase 5: In-memory role→permission map (mirrors jv_role_permissions seed data) ──────────────"""

REPLACEMENT = """// ── Auth constants ─────────────────────────────────────────────────────────
const CMS_CLIENT_ID = 'jubileeverse-cms';
const CMS_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || 'jubileeverse-cms-secret-dev';
const _jwt = require('jsonwebtoken');

function logReviewerActivity({ email, action, summary, articleId, articleHeadline, beforeTitle, afterTitle, beforeContent, afterContent }) {
    pgPool.query(
        `INSERT INTO jv_reviewer_activity
            (reviewer_email, action, summary, article_id, article_headline, before_title, after_title, before_content, after_content)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [email, action, summary,
         articleId || null, articleHeadline || null,
         beforeTitle || null, afterTitle || null,
         beforeContent || null, afterContent || null]
    ).catch(e => console.error('[logReviewerActivity]', e.message));
}

// ── Phase 5: In-memory role→permission map (mirrors jv_role_permissions seed data) ──────────────"""

start_idx = content.find(SQLITE_BLOCK_START)
end_idx   = content.find(SQLITE_BLOCK_END)

if start_idx == -1:
    print("ERROR: Could not find SQLite block start marker")
    exit(1)
if end_idx == -1:
    print("ERROR: Could not find SQLite block end marker")
    exit(1)

print(f"Removing block from index {start_idx} to {end_idx} ({end_idx - start_idx} chars)")

content = content[:start_idx] + REPLACEMENT + content[end_idx + len(SQLITE_BLOCK_END):]

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")

# Verify no remaining db. references (except in comments and strings)
lines = content.split('\n')
remaining = [f"  {i}: {l.strip()[:100]}" for i, l in enumerate(lines, 1)
             if 'db.prepare' in l or 'db.exec(' in l or 'db.pragma(' in l
             and not l.strip().startswith('//')]
print(f"Remaining SQLite refs: {len(remaining)}")
for r in remaining:
    print(r)

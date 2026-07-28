"""
async-middleware-fix.py

Converts all non-awaited requirePrivileged / requireRole / requireSession calls in server.js
and makes the containing route handlers async.

Run: python scripts/async-middleware-fix.py
"""

import re

with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

before_len = len(content)

# ── Step 1: Add await before non-awaited auth middleware calls ──────────────
# Pattern: "= requireXxx(..." where "await" does NOT already precede it.
# We match "= require..." and replace with "= await require..." using a
# conditional: only if the match is NOT preceded by "await ".

def add_await_if_needed(pattern, replacement, text):
    """Replace pattern only when not preceded by 'await '"""
    result = []
    pos = 0
    for m in re.finditer(pattern, text):
        start = m.start()
        # Check if 'await ' precedes this match (within 20 chars)
        preceding = text[max(0, start-6):start]
        result.append(text[pos:start])
        if 'await ' in preceding:
            result.append(m.group(0))  # keep as-is
        else:
            result.append(replacement)
        pos = m.end()
    result.append(text[pos:])
    return ''.join(result)

content = add_await_if_needed(
    r'= requirePrivileged\(req, res\)',
    '= await requirePrivileged(req, res)',
    content
)
content = add_await_if_needed(
    r'= requireRole\(req, res,',
    '= await requireRole(req, res,',
    content
)
content = add_await_if_needed(
    r'= requireSession\(req, res\)',
    '= await requireSession(req, res)',
    content
)

# ── Step 2: Make route handlers async if not already ────────────────────────
# Replace ", (req, res) => {" with ", async (req, res) => {" in app.METHOD calls
# Only when it's a direct route handler (preceded by a route path string/regex)
content = re.sub(
    r',\s*\(req, res\) => \{',
    ', async (req, res) => {',
    content
)
# De-duplicate any double "async async"
content = content.replace('async async (req, res)', 'async (req, res)')

# ── Step 3: Fix the requireRole function itself to be async ─────────────────
content = content.replace(
    'function requireRole(req, res, ...roles) {',
    'async function requireRole(req, res, ...roles) {'
)
# Inside requireRole, requireSession was already handled by Step 1's pattern

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. File size: {before_len} -> {len(content)} chars")

# Verify no remaining non-awaited calls
lines = content.split('\n')
issues = []
for i, line in enumerate(lines, 1):
    stripped = line.strip()
    if stripped.startswith('//') or stripped.startswith('*'):
        continue
    # Check for non-awaited auth calls
    for pat in [r'= requirePrivileged\(req, res\)', r'= requireRole\(req, res,', r'= requireSession\(req, res\)']:
        for m in re.finditer(pat, stripped):
            start = m.start()
            preceding = stripped[max(0, start-6):start]
            if 'await ' not in preceding:
                issues.append(f"  Line {i}: {stripped[:90]}")

if issues:
    print(f"\nREMAINING NON-AWAITED CALLS ({len(issues)}):")
    for issue in issues[:20]:
        print(issue)
else:
    print("\nAll auth middleware calls are now awaited.")

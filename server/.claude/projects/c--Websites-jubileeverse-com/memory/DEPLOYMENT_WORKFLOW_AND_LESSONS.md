---
name: Deployment Workflow & Lessons Learned
description: How to properly deploy without breaking things, what went wrong, and what was fixed
type: feedback
---

# Deployment Workflow & Critical Lessons

## The Problem That Was Fixed

**Before**: Changes were chaotic
- Using scp to copy files instead of git
- No verification before deploying
- Making changes that broke other features
- Git repo out of sync with production
- Impossible to know what actually worked

**After**: Proper workflow established
- Git-based deployments with verification gates
- Automated checks before any deployment
- Clear commit messages and history
- Production always in sync with git
- Easy to rollback if something breaks

## Deployment Process (Working Now)

### Step 1: Verify Before Deploying
```bash
node scripts/verify-deployment.js
```
Must pass all 18 checks. Blocks deployment if any check fails.

**What it checks**:
- Critical files exist (server.js, index.html, article.html)
- package.json present
- SEO-friendly routing implemented
- Content objects support
- Article click handler defined
- Taxonomy portal loader
- Taxonomy loader properly awaited (no async races)
- HOME link element
- Taxonomy nav container
- Mobile links hidden on desktop
- White text color for nav
- PERSONALIZE button defined
- PERSONALIZE uses white text
- HOME link alignment fix
- server.js syntax valid
- index.html structure valid

**If ANY check fails**: Fix the issue, don't proceed

### Step 2: Commit with Clear Message
```bash
git commit -m "Description of what was fixed/added"
```

**Message should explain**:
- What was fixed (not just code changes)
- Why it matters
- If fixing a bug, what the bug was

### Step 3: Push to Origin
```bash
git push origin main
```

### Step 4: Deploy to Production
```bash
ssh jubilee-prod "cd /var/www/JubileeVerse.com && git fetch origin && git reset --hard origin/main && pkill -f 'node.*server.js' 2>/dev/null || true && sleep 2 && nohup node server.js > /tmp/jv-deploy.log 2>&1 &"
```

### Step 5: Verify Production
```bash
curl -I https://www.jubileeverse.com/
sleep 3
# Check for articles loading, no console errors, proper display
```

## What Went Wrong (And Fixes)

### Mistake 1: Not Testing Before Deploying
**Consequence**: Broke navigation multiple times
**Fix**: Created `scripts/verify-deployment.js` to block bad deployments
**Lesson**: Always verify before deploying. Verification takes 2 seconds, fixing breakage takes 30 minutes.

### Mistake 2: Using scp Instead of Git
**Consequence**: Production out of sync with repo, no rollback capability
**Fix**: Established proper git workflow
**Lesson**: Git is not optional - it's how you track, review, and rollback changes

### Mistake 3: Making Unrelated Changes in Same Commit
**Consequence**: When one change broke, hard to identify the culprit
**Fix**: Rule: One logical change per commit
**Lesson**: Atomic commits allow surgical rollbacks

### Mistake 4: Not Awaiting Async Operations
**Consequence**: Race condition where `_taxonomyNodes` was empty when needed
**Fix**: Added `await loadTaxonomyNavLinks()`
**Lesson**: Always `await` before using results of async operations

### Mistake 5: Forgetting to Handle Authentication
**Consequence**: Public users couldn't load article content
**Fix**: Created public API endpoint `/api/public/article/:id`
**Lesson**: Public features need public endpoints, not authenticated ones

### Mistake 6: Leaving Git Merge Conflict Markers
**Consequence**: JavaScript syntax error in article.html
**Fix**: Removed `>>>>>>> Stashed changes` marker
**Lesson**: Always resolve merge conflicts completely before deploying

### Mistake 7: CSP Too Restrictive
**Consequence**: Event handlers and scripts blocked
**Fix**: Updated CSP to allow inline scripts and event handlers
**Lesson**: CSP is important for security but needs to be configured correctly

## Rules for Safe Deployments

### ALWAYS:
- [ ] Run `node scripts/verify-deployment.js` before deploying
- [ ] Make atomic commits (one logical change per commit)
- [ ] Use clear, descriptive commit messages
- [ ] Test in browser after deployment
- [ ] Keep git and production in sync

### NEVER:
- [ ] Deploy with failing verification checks
- [ ] Deploy unrelated changes together
- [ ] Use scp to copy files (use git)
- [ ] Leave git merge conflict markers in code
- [ ] Commit changes without testing locally first

### IF SOMETHING BREAKS:
1. Check production logs: `ssh jubilee-prod "tail -50 /tmp/jv-deploy.log"`
2. Identify the commit that broke it: `git log --oneline`
3. Rollback: `ssh jubilee-prod "cd /var/www/JubileeVerse.com && git reset --hard <good-commit>"`
4. Restart: `ssh jubilee-prod "pkill -f 'node.*server.js'; sleep 2; cd /var/www/JubileeVerse.com && nohup node server.js > /tmp/jv-deploy.log 2>&1 &"`

## Commits That Fixed Things

| Commit | What | Why It Mattered |
|--------|------|-----------------|
| f0bcc83 | CSP header + event listeners | Articles blocked by CSP policy |
| 0f931e5 | Await taxonomy nav loading | Race condition, taxonomy slug undefined |
| 3344085 | Public article API endpoint | Auth blocking unauthenticated users |
| d32fc28 | Remove merge conflict marker | JavaScript syntax error |
| 8235be0 | SEO-friendly URL routing | Core feature for article navigation |
| 3ca3596 | Fix nav alignment regression | Previous fix broke mobile menu |
| e3e3574 | Move HOME link 2px | Fine-tuning navigation alignment |

## Key Insight

**The difference between "broken" and "working" is verification + git workflow.**

- Verification catches problems BEFORE they reach production
- Git workflow makes rollbacks trivial
- Atomic commits make debugging fast
- Clear messages make history readable

## For Future Sessions

This memory should include:
- What works (article navigation)
- Why it works (data flow, endpoints, CSP)
- What doesn't work (what to avoid)
- How to deploy safely (verification process)
- How to fix if broken (rollback procedure)

This prevents re-learning the same lessons and ensures consistent quality.

---

**Why:** Because we waste time fixing the same bugs twice if we don't remember what works.

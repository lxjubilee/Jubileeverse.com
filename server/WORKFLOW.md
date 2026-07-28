# JubileeVerse.com - Development & Deployment Workflow

## ✓ WHAT WAS BROKEN
- Article clicking was broken due to missing CSP permissions and async race condition
- Deployment process was chaotic (copying files via scp, git not synced)
- No verification before deploying changes
- Changes being made that broke other features

## ✓ WHAT WAS FIXED

### 1. Content Security Policy (CSP)
**Problem**: Browser was blocking inline `onclick` event handlers  
**Solution**: Added CSP meta tag to allow inline event attributes

### 2. Article Navigation (Async Race Condition)
**Problem**: `loadTaxonomyNavLinks()` wasn't awaited, so `_taxonomyNodes` was empty when trying to find taxonomy slug  
**Solution**: Added `await` so data loads before being used

### 3. Deployment Workflow
**Before**: Manual scp file copies, no git sync, no verification  
**After**: Proper git workflow with verification and testing

## ✓ HOW TO DEPLOY GOING FORWARD

### Step 1: Make changes locally
```bash
# Edit files
# Test in browser
```

### Step 2: Verify changes won't break anything
```bash
cd c:/Websites/jubileeverse.com
node scripts/verify-deployment.js
```
This checks:
- All critical files exist
- No syntax errors
- Key features are present and correct
- Navigation/styling is correct

### Step 3: Commit with clear message
```bash
git add <files>
git commit -m "Description of what was fixed/added"
```

### Step 4: Deploy to production
```bash
git push origin main
ssh jubilee-prod "cd /var/www/JubileeVerse.com && git fetch origin && git reset --hard origin/main"
ssh jubilee-prod "pkill -f 'node.*JubileeVerse.*server.js'; sleep 2; cd /var/www/JubileeVerse.com && nohup node server.js > /tmp/jv-deploy.log 2>&1 &"
sleep 3
curl -I https://www.jubileeverse.com/
```

### Step 5: Verify deployment worked
```bash
curl https://www.jubileeverse.com/ | grep -c "JubileeVerse"
```

## ⚠️ CRITICAL RULES

### Before asking to deploy:
- [ ] Run `node scripts/verify-deployment.js` - must pass all checks
- [ ] Changes are committed to git with clear message
- [ ] Only one logical change per commit
- [ ] Tested locally in browser
- [ ] No unrelated files included in commit

### When deployment fails:
1. Check production logs: `ssh jubilee-prod "tail -50 /tmp/jv-deploy.log"`
2. Rollback: `ssh jubilee-prod "cd /var/www/JubileeVerse.com && git reset --hard <previous-commit-hash>"`
3. Restart: `ssh jubilee-prod "pkill -f 'node.*server.js'; sleep 2; cd /var/www/JubileeVerse.com && nohup node server.js > /tmp/jv-deploy.log 2>&1 &"`

## 📋 CURRENT STATUS

**Last Deployment**: 2026-04-11 09:58 UTC  
**Current Commit**: 1683a28 - Remove GitHub workflows (OAuth scope issue)  
**Server**: Running ✓  
**Article Clicking**: Fixed ✓  
**CSP Errors**: Resolved ✓  

## 🔍 HOW ARTICLE CLICKING WORKS NOW

1. **User clicks article card**
   - Event listener attached to `.content-card[data-article-id]` detects click
   - Prevents navigation if clicking a button (hide, refresh)

2. **Article ID retrieved**
   - `data-article-id` attribute has UUID
   - Looked up in `_jvArticleMap` to get full article object

3. **Navigation to SEO-friendly URL**
   - If article has `slug` and `taxonomySlug`: navigate to `/:category/:slug.html`
   - Server-side route looks up article in `jv_content_objects`
   - Server injects article data into sessionStorage
   - `article.html` page displays it

4. **Fallback (if slug missing)**
   - Navigate to `/article.html`
   - Uses sessionStorage data for display

## 🚀 DEPLOYMENT SUCCESS CRITERIA

After deploying, verify:
1. Homepage loads without CSP errors: `curl https://www.jubileeverse.com/`
2. Taxonomy categories are visible
3. Clicking an article navigates to `/:category/:slug.html`
4. Article page displays content correctly
5. No console errors in browser DevTools

---

**Remember**: Every change must be verified before deploying. Verify early, deploy with confidence.

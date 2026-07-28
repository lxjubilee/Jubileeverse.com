# JubileeVerse.com Deployment Process

## Quick Deploy
```bash
bash scripts/deploy-production.sh
```

This script:
1. ✓ Verifies all critical files and features exist
2. ✓ Checks git is in good state
3. ✓ Pushes to origin/main
4. ✓ Pulls on production server
5. ✓ Restarts the Node.js server
6. ✓ Verifies the server is running and responds to HTTP

## Manual Verification (Local)
Before deploying, verify locally:
```bash
node scripts/verify-deployment.js
```

## Emergency Rollback (Production)
If deployment breaks production:
```bash
ssh jubilee-prod "cd /var/www/JubileeVerse.com && git reset --hard <commit-hash>"
```

## Common Issues

### Server won't start
```bash
ssh jubilee-prod "tail -50 /tmp/jubileeverse-deploy.log"
```

### Git is diverged from origin
The deploy script offers to force-push. Use with caution - verify your local changes first!

### Check server status on production
```bash
ssh jubilee-prod "ps aux | grep node"
ssh jubilee-prod "curl -I https://www.jubileeverse.com"
```

## Key Principles
- Always push to git before deploying to production
- Always run verification before deployment
- Commit messages should be clear and descriptive
- One logical change per commit
- Test locally before deploying

## Changes Checklist
Before asking for deployment, verify:
- [ ] Code is committed to git with clear message
- [ ] Local verification passes: `node scripts/verify-deployment.js`
- [ ] Tested in browser/locally
- [ ] No unrelated changes included
- [ ] Ready to deploy with: `bash scripts/deploy-production.sh`

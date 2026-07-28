#!/bin/bash
# Deployment Script for JubileeVerse.com
# Properly uses git and verifies before deploying to production

set -e  # Exit on any error

PROD_HOST="jubilee-prod"
PROD_PATH="/var/www/JubileeVerse.com"
BRANCH="main"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     JUBILEEVERSE.COM PRODUCTION DEPLOYMENT                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Verify local changes
echo "[1/6] Verifying local codebase..."
node scripts/verify-deployment.js || {
  echo "❌ Verification failed - deployment aborted"
  exit 1
}

# Step 2: Verify git is clean
echo ""
echo "[2/6] Checking git status..."
if git status --porcelain | grep -v "hook-messages.json" | grep -q .; then
  echo "⚠️  WARNING: Uncommitted changes detected (excluding hook-messages.json):"
  git status --porcelain | grep -v "hook-messages.json"
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment aborted"
    exit 1
  fi
fi

# Step 3: Get current commit
echo ""
echo "[3/6] Current commit:"
CURRENT_COMMIT=$(git rev-parse --short HEAD)
CURRENT_MSG=$(git log -1 --pretty=%B)
echo "  Commit: $CURRENT_COMMIT"
echo "  Message: $CURRENT_MSG"

# Step 4: Push to origin
echo ""
echo "[4/6] Pushing to origin/$BRANCH..."
if git push origin $BRANCH; then
  echo "✓ Pushed to origin"
else
  echo "⚠️  Push to origin failed (may be diverged), attempting force push..."
  read -p "Force push? This will overwrite remote. (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git push -f origin $BRANCH
    echo "✓ Force pushed to origin"
  else
    echo "❌ Deployment aborted"
    exit 1
  fi
fi

# Step 5: Deploy to production
echo ""
echo "[5/6] Deploying to production server..."
echo "  Host: $PROD_HOST"
echo "  Path: $PROD_PATH"
echo "  Commit: $CURRENT_COMMIT"

# Pull on production
ssh $PROD_HOST "cd $PROD_PATH && git fetch origin && git checkout $BRANCH && git reset --hard origin/$BRANCH" || {
  echo "❌ Failed to pull on production"
  exit 1
}

# Restart server on production
echo "  Restarting server..."
ssh $PROD_HOST "pkill -f 'node $PROD_PATH/server.js' 2>/dev/null || true"
sleep 2
ssh $PROD_HOST "cd $PROD_PATH && nohup node server.js > /tmp/jubileeverse-deploy.log 2>&1 &"
sleep 3

# Step 6: Verify production is running
echo ""
echo "[6/6] Verifying production deployment..."
if ssh $PROD_HOST "ps aux | grep -q '[n]ode.*server.js'"; then
  echo "✓ Server is running"
  echo "✓ Checking HTTP response..."
  RESPONSE=$(ssh $PROD_HOST "curl -s -I https://www.jubileeverse.com/ | head -1")
  if echo "$RESPONSE" | grep -q "200"; then
    echo "✓ HTTP 200 OK"
  else
    echo "⚠️  Unexpected HTTP response: $RESPONSE"
  fi
else
  echo "❌ Server failed to start"
  echo "Check logs with: ssh $PROD_HOST 'tail -50 /tmp/jubileeverse-deploy.log'"
  exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║ ✓ DEPLOYMENT SUCCESSFUL                                    ║"
echo "║ Commit: $CURRENT_COMMIT"
echo "║ URL: https://www.jubileeverse.com                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

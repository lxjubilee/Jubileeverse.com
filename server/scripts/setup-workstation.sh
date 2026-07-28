#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# JubileeInspire.com — Workstation Setup
# Paste this entire script into your VS Code terminal (Git Bash / WSL / bash).
#
# What this does:
#   1. Authenticates you with Cortex using your JubileeInspire.com credentials
#   2. Registers this machine — an Architect must then approve it in Cortex
#   3. Creates release.sh and publish.sh in your current directory
#   4. Saves connection config to ~/.jubilee.env
#
# Once your machine is approved:  bash release.sh JubileeInspire.com
# ═══════════════════════════════════════════════════════════════════════════════
set -e

CORTEX_API="https://jubileeinspire.com/api/cortex"
INSTALL_DIR="${JUBILEE_DIR:-$PWD}"

# JSON field extractor — uses Node.js (no python3 required)
# Usage: _jf "$JSON" "js_expr" "default"
_jf() { echo "$1" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(d);const v=($2);process.stdout.write(v===undefined||v===null?'':String(v));}catch(e){process.stdout.write('$3');}});" 2>/dev/null; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║   JubileeInspire.com — Workstation Setup              ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Authenticate with Cortex ─────────────────────────────────────────
echo "[ 1/4 ] Authenticating with Cortex..."

CORTEX_TOKEN="${CORTEX_TOKEN:-}"
if [ -z "$CORTEX_TOKEN" ] && [ -f "$HOME/.cortex_token" ]; then
    CORTEX_TOKEN=$(cat "$HOME/.cortex_token" 2>/dev/null || true)
fi

if [ -n "$CORTEX_TOKEN" ]; then
    ME=$(curl -s --max-time 10 -H "Authorization: Bearer $CORTEX_TOKEN" \
        "$CORTEX_API/auth/me" 2>/dev/null || true)
    USER_EMAIL=$(_jf "$ME" "(p.user||{}).email||''" "")
fi

if [ -z "${USER_EMAIL:-}" ]; then
    CORTEX_TOKEN=""
    echo "        Enter your JubileeInspire.com credentials."
    echo "        Authentication is handled by JubileeInspire.com SSO."
    echo ""
    read -r -p "        Email: " CORTEX_EMAIL
    read -r -s -p "        Password: " CORTEX_PASSWORD
    echo ""

    # Authenticate via jubilee SSO proxy (credentials never stored by Cortex)
    LOGIN_RESP=$(curl -s --max-time 15 -X POST "$CORTEX_API/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$CORTEX_EMAIL\",\"password\":\"$CORTEX_PASSWORD\"}" 2>/dev/null || true)
    REQUIRES_2FA=$(_jf "$LOGIN_RESP" "p.requires2FA?'yes':'no'" "no")

    if [ "$REQUIRES_2FA" = "yes" ]; then
        VERIFICATION_GUID=$(_jf "$LOGIN_RESP" "p.verificationGuid||''" "")
        echo "        🔐 Two-factor verification required."
        echo "          Check your email for a verification code."
        echo ""
        read -r -p "        Verification Code: " VERIFY_CODE
        VERIFY_RESP=$(curl -s --max-time 15 -X POST "$CORTEX_API/auth/verify-2fa" \
            -H "Content-Type: application/json" \
            -d "{\"verificationCode\":\"$VERIFY_CODE\",\"verificationGuid\":\"$VERIFICATION_GUID\"}" 2>/dev/null || true)
        CORTEX_TOKEN=$(_jf "$VERIFY_RESP" "p.token||''" "")
        if [ -z "$CORTEX_TOKEN" ]; then
            VERIFY_ERR=$(_jf "$VERIFY_RESP" "p.error||'Verification failed'" "Verification failed")
            echo ""; echo "❌  $VERIFY_ERR"; echo ""; exit 1
        fi
    else
        CORTEX_TOKEN=$(_jf "$LOGIN_RESP" "p.token||''" "")
        if [ -z "$CORTEX_TOKEN" ]; then
            LOGIN_ERR=$(_jf "$LOGIN_RESP" "p.error||'Authentication failed'" "Authentication failed")
            echo ""; echo "❌  $LOGIN_ERR"; echo ""; exit 1
        fi
    fi

    USER_EMAIL="$CORTEX_EMAIL"
    printf '%s' "$CORTEX_TOKEN" > "$HOME/.cortex_token"
    chmod 600 "$HOME/.cortex_token"
fi
echo "        ✓ Authenticated as $USER_EMAIL (via JubileeInspire.com SSO)"

# ── Step 2: Register this machine ────────────────────────────────────────────
echo "[ 2/4 ] Registering this machine with Cortex..."

MACHINE_HOSTNAME=$(hostname 2>/dev/null || echo "unknown")
OS_PLATFORM=$(uname -s 2>/dev/null || echo "unknown")

REG_RESP=$(curl -s --max-time 10 -X POST "$CORTEX_API/machines/register" \
    -H "Authorization: Bearer $CORTEX_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"hostname\":\"$MACHINE_HOSTNAME\",\"computerName\":\"$MACHINE_HOSTNAME\",\"osPlatform\":\"$OS_PLATFORM\"}" \
    2>/dev/null || true)
REG_STATUS=$(_jf "$REG_RESP" "p.machine?p.machine.status||'':''" "")

case "$REG_STATUS" in
    approved)
        echo "        ✓ Machine already approved: $MACHINE_HOSTNAME" ;;
    pending)
        echo "        ✓ Machine registered — pending Architect approval."
        echo "          Computer  : $MACHINE_HOSTNAME"
        echo "          Next step : Ask an Architect to visit Cortex → Machines and approve."
        echo "                      You must be approved before release/publish commands will run." ;;
    rejected)
        echo ""
        echo "❌  This machine has been rejected in Cortex."
        echo "   Computer: $MACHINE_HOSTNAME"
        echo "   Contact your Cortex administrator to request reinstatement."
        echo ""
        exit 1 ;;
    *)
        echo "        ⚠  Unexpected registration response. Registration may have failed."
        echo "          Response: $REG_RESP" ;;
esac

# ── Step 3: Create release.sh and publish.sh ─────────────────────────────────
echo "[ 3/4 ] Creating release.sh and publish.sh in $INSTALL_DIR..."

# ── release.sh ────────────────────────────────────────────────────────────────
cat > "$INSTALL_DIR/release.sh" << 'RELEASE_SCRIPT_EOF'
#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# JubileeInspire.com — Release to UAT
# Usage:  bash release.sh <website> [commit message]
# Example: bash release.sh JubileeInspire.com
#          bash release.sh JubileeInspire.com "added voice settings"
# Trigger: say "release JubileeInspire.com" to Claude Code
# ─────────────────────────────────────────────────────────────────────────────
set -e

EXPECTED_WEBSITE="JubileeInspire.com"
VPS="root@94.72.120.231"
VPS_DIR="/var/www/jubileeinspire.com"
LOCAL_DIR="$(dirname "$0")"
GITEA_REMOTE="gitea-staging"
BRANCH="master"
CORTEX_API="https://jubileeinspire.com/api/cortex"

# JSON field extractor — uses Node.js (no python3 required)
_jf() { echo "$1" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(d);const v=($2);process.stdout.write(v===undefined||v===null?'':String(v));}catch(e){process.stdout.write('$3');}});" 2>/dev/null; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   JubileeInspire.com — Release to UAT        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Step 0a: Validate website parameter ──────────────────────────────────────
WEBSITE_PARAM="${1:-}"
if [ -z "$WEBSITE_PARAM" ]; then
    echo "❌  Error: Website parameter is required."
    echo ""
    echo "   Usage:   bash release.sh <website> [commit message]"
    echo "   Example: bash release.sh $EXPECTED_WEBSITE"
    echo "   Example: bash release.sh $EXPECTED_WEBSITE \"added new feature\""
    echo ""
    exit 1
fi

if [ "$(echo "$WEBSITE_PARAM" | tr '[:upper:]' '[:lower:]')" != "$(echo "$EXPECTED_WEBSITE" | tr '[:upper:]' '[:lower:]')" ]; then
    echo "❌  Error: Website mismatch."
    echo ""
    echo "   Requested: $WEBSITE_PARAM"
    echo "   This script releases: $EXPECTED_WEBSITE"
    echo ""
    echo "   If you meant to release a different website, use that website's release.sh."
    echo ""
    exit 1
fi

COMMIT_MSG="${2:-Release $(date '+%Y-%m-%d %H:%M:%S')}"

# ── Step 0b: Cortex authentication & role check ──────────────────────────────
echo "[ 0/4 ] Verifying identity and privileges..."

# Load token: env var → saved file → prompt for credentials
CORTEX_TOKEN="${CORTEX_TOKEN:-}"
if [ -z "$CORTEX_TOKEN" ] && [ -f "$HOME/.cortex_token" ]; then
    CORTEX_TOKEN=$(cat "$HOME/.cortex_token" 2>/dev/null || true)
fi

if [ -z "$CORTEX_TOKEN" ]; then
    echo "        No saved session. Sign in via JubileeInspire.com SSO."
    echo ""
    read -r -p "        Email: " CORTEX_EMAIL
    read -r -s -p "        Password: " CORTEX_PASSWORD
    echo ""
    LOGIN_RESP=$(curl -s --max-time 15 -X POST "$CORTEX_API/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$CORTEX_EMAIL\",\"password\":\"$CORTEX_PASSWORD\"}" 2>/dev/null || true)
    REQUIRES_2FA=$(_jf "$LOGIN_RESP" "p.requires2FA?'yes':'no'" "no")
    if [ "$REQUIRES_2FA" = "yes" ]; then
        VERIFICATION_GUID=$(_jf "$LOGIN_RESP" "p.verificationGuid||''" "")
        echo "        🔐 Two-factor verification required. Check your email."
        echo ""
        read -r -p "        Verification Code: " VERIFY_CODE
        VERIFY_RESP=$(curl -s --max-time 15 -X POST "$CORTEX_API/auth/verify-2fa" \
            -H "Content-Type: application/json" \
            -d "{\"verificationCode\":\"$VERIFY_CODE\",\"verificationGuid\":\"$VERIFICATION_GUID\"}" 2>/dev/null || true)
        CORTEX_TOKEN=$(_jf "$VERIFY_RESP" "p.token||''" "")
        if [ -z "$CORTEX_TOKEN" ]; then
            VERIFY_ERR=$(_jf "$VERIFY_RESP" "p.error||'Verification failed'" "Verification failed")
            echo ""; echo "❌  $VERIFY_ERR"; echo ""; exit 1
        fi
    else
        CORTEX_TOKEN=$(_jf "$LOGIN_RESP" "p.token||''" "")
        if [ -z "$CORTEX_TOKEN" ]; then
            LOGIN_ERR=$(_jf "$LOGIN_RESP" "p.error||'Authentication failed'" "Authentication failed")
            echo ""; echo "❌  $LOGIN_ERR"; echo ""; exit 1
        fi
    fi
    printf '%s' "$CORTEX_TOKEN" > "$HOME/.cortex_token"
    chmod 600 "$HOME/.cortex_token"
    echo "        ✓ Signed in via JubileeInspire.com SSO."
fi

# Verify the token and read role
ME_RESP=$(curl -s --max-time 10 \
    -H "Authorization: Bearer $CORTEX_TOKEN" \
    "$CORTEX_API/auth/me" 2>/dev/null || true)
USER_ROLE=$(_jf "$ME_RESP" "(p.user||{}).role||''" "")
USER_EMAIL=$(_jf "$ME_RESP" "(p.user||{}).email||''" "")

if [ -z "$USER_ROLE" ]; then
    rm -f "$HOME/.cortex_token"
    echo ""
    echo "❌  Session expired or invalid. Please run the command again to re-authenticate."
    echo ""
    exit 1
fi

# Release requires Developer or Architect (admin) role
if [ "$USER_ROLE" != "developer" ] && [ "$USER_ROLE" != "admin" ]; then
    echo ""
    echo "❌  Insufficient privileges."
    echo ""
    echo "   Account : $USER_EMAIL"
    echo "   Role    : $USER_ROLE"
    echo "   Required: Developer or Architect (admin)"
    echo ""
    echo "   Contact your Cortex administrator to request access."
    echo ""
    exit 1
fi

ROLE_LABEL="Developer"
[ "$USER_ROLE" = "admin" ] && ROLE_LABEL="Architect"
echo "        ✓ Authenticated as $USER_EMAIL ($ROLE_LABEL)"

# ── Step 0c: Machine registration check ──────────────────────────────────────
MACHINE_HOSTNAME=$(hostname 2>/dev/null || echo "unknown")
OS_PLATFORM=$(uname -s 2>/dev/null || echo "unknown")
echo "        Verifying machine: $MACHINE_HOSTNAME"

MACHINE_HOSTNAME_ENC=$(node -e "process.stdout.write(encodeURIComponent('$MACHINE_HOSTNAME'))" 2>/dev/null || echo "$MACHINE_HOSTNAME")
MACHINE_RESP=$(curl -s --max-time 10 \
    -H "Authorization: Bearer $CORTEX_TOKEN" \
    "$CORTEX_API/machines/check?hostname=$MACHINE_HOSTNAME_ENC" \
    2>/dev/null || true)
MACHINE_REGISTERED=$(_jf "$MACHINE_RESP" "p.registered?'yes':'no'" "no")
MACHINE_STATUS=$(_jf "$MACHINE_RESP" "p.machine?p.machine.status||'':''" "")
MACHINE_CAN_RELEASE=$(_jf "$MACHINE_RESP" "p.machine&&p.machine.canRelease?'yes':'no'" "no")

if [ "$MACHINE_REGISTERED" = "no" ]; then
    echo "        ↳ Machine not registered — submitting for approval..."
    curl -s --max-time 10 -X POST "$CORTEX_API/machines/register" \
        -H "Authorization: Bearer $CORTEX_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"hostname\":\"$MACHINE_HOSTNAME\",\"computerName\":\"$MACHINE_HOSTNAME\",\"osPlatform\":\"$OS_PLATFORM\"}" \
        >/dev/null 2>&1 || true
    echo "        ⚠  This machine is now pending Architect approval in Cortex."
    echo "          Proceeding with this release to UAT — approval required for future runs."
elif [ "$MACHINE_STATUS" = "rejected" ]; then
    echo ""
    echo "❌  Machine access denied."
    echo ""
    echo "   Computer : $MACHINE_HOSTNAME"
    echo "   Status   : Rejected"
    echo ""
    echo "   This machine has been denied release access."
    echo "   Contact your Cortex administrator to request reinstatement."
    echo ""
    exit 1
elif [ "$MACHINE_STATUS" = "pending" ]; then
    echo "        ⚠  Machine pending Architect approval in Cortex."
    echo "          Proceeding with this UAT release — future releases require approval."
elif [ "$MACHINE_STATUS" = "approved" ] && [ "$MACHINE_CAN_RELEASE" = "no" ]; then
    echo ""
    echo "❌  Machine not authorized to release."
    echo ""
    echo "   Computer : $MACHINE_HOSTNAME"
    echo "   Status   : Approved (release not permitted)"
    echo ""
    echo "   Contact your Cortex administrator to enable release permission for this machine."
    echo ""
    exit 1
else
    echo "        ✓ Machine authorized: $MACHINE_HOSTNAME"
fi

# ── Step 1: Commit & push to Gitea ───────────────────────────────────────────
echo "[ 1/4 ] Committing and pushing to Gitea..."
cd "$LOCAL_DIR"
git add -A
if git diff --staged --quiet; then
    echo "        Nothing new to commit — pushing existing HEAD."
else
    git commit -m "$COMMIT_MSG"
fi
git push $GITEA_REMOTE $BRANCH
echo "        ✓ Gitea updated."

# ── Step 2: Sync files to VPS ─────────────────────────────────────────────────
echo "[ 2/4 ] Syncing files to VPS..."
cd "$LOCAL_DIR"
tar -czf - \
    --exclude='./.git' \
    --exclude='./node_modules' \
    --exclude='./*.log' \
    --exclude='./release.sh' \
    --exclude='./publish.sh' \
    --exclude='./CLAUDE.md' \
    --exclude='./services/inspire-gateway/launcher.log' \
    --exclude='./services/inspire-gateway/monitor.log' \
    . | ssh -q "$VPS" "tar -xzf - -C $VPS_DIR"
echo "        ✓ Files synced."

# ── Step 3: Run DB migrations (if any) ────────────────────────────────────────
echo "[ 3/4 ] Running migrations..."
ssh -q "$VPS" "
  cd $VPS_DIR/api
  if [ -f package.json ] && node -e \"const p=require('./package.json'); process.exit(p.scripts&&p.scripts.migrate?0:1)\" 2>/dev/null; then
    npm run migrate --silent && echo '        ✓ Migrations applied.' || echo '        ⚠ Migration script failed (non-fatal).'
  else
    echo '        — No migrate script found, skipping.'
  fi
"

# ── Step 4: Restart services ──────────────────────────────────────────────────
echo "[ 4/4 ] Restarting services..."
ssh -q "$VPS" "nohup bash -c 'sleep 1; kill -SIGTERM \$(pgrep -f \"node $VPS_DIR/server.js\" | head -1) 2>/dev/null; kill -SIGTERM \$(pgrep -f \"node $VPS_DIR/api/server.js\" | head -1) 2>/dev/null' >/dev/null 2>&1 &"
sleep 5
echo "        ✓ Services restarted."

echo ""
echo "✅ Released to UAT — https://jubileeinspire.com"
echo "   Released by : $USER_EMAIL ($ROLE_LABEL)"
echo "   Machine     : $MACHINE_HOSTNAME"
echo "   Website     : $EXPECTED_WEBSITE"
echo "   Open Cortex to track this release: https://jubileeinspire.com/cortex/"
echo ""
RELEASE_SCRIPT_EOF

# ── publish.sh ────────────────────────────────────────────────────────────────
cat > "$INSTALL_DIR/publish.sh" << 'PUBLISH_SCRIPT_EOF'
#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# JubileeInspire.com — Publish to Production
# Usage:  bash publish.sh <website> [commit message]
# Example: bash publish.sh JubileeInspire.com
#          bash publish.sh JubileeInspire.com "launch: spring update"
# Trigger: say "publish JubileeInspire.com" to Claude Code
#
# Difference from release.sh:
#   release.sh = sync + UAT state in Cortex
#   publish.sh = sync + Production state in Cortex + Cloudflare cache purge
# Requires Architect (admin) role — Developers cannot publish to Production.
# ─────────────────────────────────────────────────────────────────────────────
set -e

EXPECTED_WEBSITE="JubileeInspire.com"
VPS="root@94.72.120.231"
VPS_DIR="/var/www/jubileeinspire.com"
LOCAL_DIR="$(dirname "$0")"
GITEA_REMOTE="gitea-staging"
BRANCH="master"
CORTEX_API="https://jubileeinspire.com/api/cortex"

# Cloudflare credentials (set in environment or ~/.jubilee.env)
CF_ZONE_ID="${CF_ZONE_ID:-}"
CF_TOKEN="${CF_TOKEN:-}"

# JSON field extractor — uses Node.js (no python3 required)
_jf() { echo "$1" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(d);const v=($2);process.stdout.write(v===undefined||v===null?'':String(v));}catch(e){process.stdout.write('$3');}});" 2>/dev/null; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  JubileeInspire.com — Publish to Production  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Step 0a: Validate website parameter ──────────────────────────────────────
WEBSITE_PARAM="${1:-}"
if [ -z "$WEBSITE_PARAM" ]; then
    echo "❌  Error: Website parameter is required."
    echo ""
    echo "   Usage:   bash publish.sh <website> [commit message]"
    echo "   Example: bash publish.sh $EXPECTED_WEBSITE"
    echo "   Example: bash publish.sh $EXPECTED_WEBSITE \"spring launch\""
    echo ""
    echo "   ⚠  Publish deploys to Production. Always test on UAT first."
    echo ""
    exit 1
fi

if [ "$(echo "$WEBSITE_PARAM" | tr '[:upper:]' '[:lower:]')" != "$(echo "$EXPECTED_WEBSITE" | tr '[:upper:]' '[:lower:]')" ]; then
    echo "❌  Error: Website mismatch."
    echo ""
    echo "   Requested: $WEBSITE_PARAM"
    echo "   This script publishes: $EXPECTED_WEBSITE"
    echo ""
    echo "   If you meant to publish a different website, use that website's publish.sh."
    echo ""
    exit 1
fi

COMMIT_MSG="${2:-Publish $(date '+%Y-%m-%d %H:%M:%S')}"

# ── Step 0b: Cortex authentication & role check ──────────────────────────────
echo "[ 0/5 ] Verifying identity and privileges..."

# Load token: env var → saved file → prompt for credentials
CORTEX_TOKEN="${CORTEX_TOKEN:-}"
if [ -z "$CORTEX_TOKEN" ] && [ -f "$HOME/.cortex_token" ]; then
    CORTEX_TOKEN=$(cat "$HOME/.cortex_token" 2>/dev/null || true)
fi

if [ -z "$CORTEX_TOKEN" ]; then
    echo "        No saved session. Sign in via JubileeInspire.com SSO."
    echo ""
    read -r -p "        Email: " CORTEX_EMAIL
    read -r -s -p "        Password: " CORTEX_PASSWORD
    echo ""
    LOGIN_RESP=$(curl -s --max-time 15 -X POST "$CORTEX_API/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$CORTEX_EMAIL\",\"password\":\"$CORTEX_PASSWORD\"}" 2>/dev/null || true)
    REQUIRES_2FA=$(_jf "$LOGIN_RESP" "p.requires2FA?'yes':'no'" "no")
    if [ "$REQUIRES_2FA" = "yes" ]; then
        VERIFICATION_GUID=$(_jf "$LOGIN_RESP" "p.verificationGuid||''" "")
        echo "        🔐 Two-factor verification required. Check your email."
        echo ""
        read -r -p "        Verification Code: " VERIFY_CODE
        VERIFY_RESP=$(curl -s --max-time 15 -X POST "$CORTEX_API/auth/verify-2fa" \
            -H "Content-Type: application/json" \
            -d "{\"verificationCode\":\"$VERIFY_CODE\",\"verificationGuid\":\"$VERIFICATION_GUID\"}" 2>/dev/null || true)
        CORTEX_TOKEN=$(_jf "$VERIFY_RESP" "p.token||''" "")
        if [ -z "$CORTEX_TOKEN" ]; then
            VERIFY_ERR=$(_jf "$VERIFY_RESP" "p.error||'Verification failed'" "Verification failed")
            echo ""; echo "❌  $VERIFY_ERR"; echo ""; exit 1
        fi
    else
        CORTEX_TOKEN=$(_jf "$LOGIN_RESP" "p.token||''" "")
        if [ -z "$CORTEX_TOKEN" ]; then
            LOGIN_ERR=$(_jf "$LOGIN_RESP" "p.error||'Authentication failed'" "Authentication failed")
            echo ""; echo "❌  $LOGIN_ERR"; echo ""; exit 1
        fi
    fi
    printf '%s' "$CORTEX_TOKEN" > "$HOME/.cortex_token"
    chmod 600 "$HOME/.cortex_token"
    echo "        ✓ Signed in via JubileeInspire.com SSO."
fi

# Verify the token and read role
ME_RESP=$(curl -s --max-time 10 \
    -H "Authorization: Bearer $CORTEX_TOKEN" \
    "$CORTEX_API/auth/me" 2>/dev/null || true)
USER_ROLE=$(_jf "$ME_RESP" "(p.user||{}).role||''" "")
USER_EMAIL=$(_jf "$ME_RESP" "(p.user||{}).email||''" "")

if [ -z "$USER_ROLE" ]; then
    rm -f "$HOME/.cortex_token"
    echo ""
    echo "❌  Session expired or invalid. Please run the command again to re-authenticate."
    echo ""
    exit 1
fi

# Publish requires Architect (admin) role only
if [ "$USER_ROLE" != "admin" ]; then
    echo ""
    echo "❌  Insufficient privileges."
    echo ""
    echo "   Account : $USER_EMAIL"
    echo "   Role    : $USER_ROLE"
    echo "   Required: Architect (admin) — Publish to Production is restricted."
    echo ""
    echo "   Developers can release to UAT using release.sh."
    echo "   Contact your Cortex administrator to request Architect access."
    echo ""
    exit 1
fi

echo "        ✓ Authenticated as $USER_EMAIL (Architect)"

# ── Step 0c: Machine registration check ──────────────────────────────────────
MACHINE_HOSTNAME=$(hostname 2>/dev/null || echo "unknown")
OS_PLATFORM=$(uname -s 2>/dev/null || echo "unknown")
echo "        Verifying machine: $MACHINE_HOSTNAME"

MACHINE_HOSTNAME_ENC=$(node -e "process.stdout.write(encodeURIComponent('$MACHINE_HOSTNAME'))" 2>/dev/null || echo "$MACHINE_HOSTNAME")
MACHINE_RESP=$(curl -s --max-time 10 \
    -H "Authorization: Bearer $CORTEX_TOKEN" \
    "$CORTEX_API/machines/check?hostname=$MACHINE_HOSTNAME_ENC" \
    2>/dev/null || true)
MACHINE_STATUS=$(_jf "$MACHINE_RESP" "p.machine?p.machine.status||'':''" "")
MACHINE_CAN_PUBLISH=$(_jf "$MACHINE_RESP" "p.machine&&p.machine.canPublish?'yes':'no'" "no")

if [ "$MACHINE_STATUS" != "approved" ] || [ "$MACHINE_CAN_PUBLISH" != "yes" ]; then
    echo ""
    echo "❌  Machine not authorized to publish to Production."
    echo ""
    echo "   Computer : $MACHINE_HOSTNAME"
    if [ -z "$MACHINE_STATUS" ]; then
        echo "   Status   : Not registered"
        echo ""
        echo "   Run the Workstation Setup script from Cortex → Releases → Download Execution Code"
        echo "   to register this machine, then wait for Architect approval."
    elif [ "$MACHINE_STATUS" = "pending" ]; then
        echo "   Status   : Pending approval"
        echo ""
        echo "   An Architect must approve this machine in Cortex before it can publish to Production."
    elif [ "$MACHINE_STATUS" = "rejected" ]; then
        echo "   Status   : Rejected"
        echo ""
        echo "   This machine has been denied publish access. Contact your Cortex administrator."
    else
        echo "   Status   : Approved (publish not permitted)"
        echo ""
        echo "   Contact your Cortex administrator to enable publish permission for this machine."
    fi
    echo ""
    exit 1
fi
echo "        ✓ Machine authorized: $MACHINE_HOSTNAME"

# ── Step 1: Commit & push to Gitea ───────────────────────────────────────────
echo "[ 1/5 ] Committing and pushing to Gitea..."
cd "$LOCAL_DIR"
git add -A
if git diff --staged --quiet; then
    echo "        Nothing new to commit — pushing existing HEAD."
else
    git commit -m "$COMMIT_MSG"
fi
git push $GITEA_REMOTE $BRANCH
echo "        ✓ Gitea updated."

# ── Step 2: Sync files to VPS ─────────────────────────────────────────────────
echo "[ 2/5 ] Syncing files to VPS..."
cd "$LOCAL_DIR"
tar -czf - \
    --exclude='./.git' \
    --exclude='./node_modules' \
    --exclude='./*.log' \
    --exclude='./release.sh' \
    --exclude='./publish.sh' \
    --exclude='./CLAUDE.md' \
    --exclude='./services/inspire-gateway/launcher.log' \
    --exclude='./services/inspire-gateway/monitor.log' \
    . | ssh -q "$VPS" "tar -xzf - -C $VPS_DIR"
echo "        ✓ Files synced."

# ── Step 3: Run DB migrations ────────────────────────────────────────────────
echo "[ 3/5 ] Running migrations..."
ssh -q "$VPS" "
  cd $VPS_DIR/api
  if node -e \"const p=require('./package.json'); process.exit(p.scripts&&p.scripts.migrate?0:1)\" 2>/dev/null; then
    npm run migrate --silent && echo '        ✓ Migrations applied.' || echo '        ⚠ Migration failed — review before continuing.'
  else
    echo '        — No migrate script, skipping.'
  fi
"

# ── Step 4: Restart services ─────────────────────────────────────────────────
echo "[ 4/5 ] Restarting services..."
ssh -q "$VPS" "nohup bash -c 'sleep 1; kill -SIGTERM \$(pgrep -f \"node $VPS_DIR/server.js\" | head -1) 2>/dev/null; kill -SIGTERM \$(pgrep -f \"node $VPS_DIR/api/server.js\" | head -1) 2>/dev/null' >/dev/null 2>&1 &"
sleep 5
echo "        ✓ Services restarted."

# ── Step 5: Purge Cloudflare cache ───────────────────────────────────────────
echo "[ 5/5 ] Purging Cloudflare cache..."
if [ -n "$CF_ZONE_ID" ] && [ -n "$CF_TOKEN" ]; then
    RESULT=$(curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
        -H "Authorization: Bearer ${CF_TOKEN}" \
        -H "Content-Type: application/json" \
        --data '{"purge_everything":true}' | grep -o '"success":[a-z]*')
    echo "        ✓ Cloudflare purge: $RESULT"
else
    echo "        ⚠ CF_ZONE_ID / CF_TOKEN not set — skipping cache purge."
    echo "          Add them to ~/.jubilee.env to automate."
fi

echo ""
echo "✅ Published to Production — https://jubileeinspire.com"
echo "   Published by : $USER_EMAIL (Architect)"
echo "   Machine      : $MACHINE_HOSTNAME"
echo "   Website      : $EXPECTED_WEBSITE"
echo "   Track this release in Cortex: https://jubileeinspire.com/cortex/"
echo ""
PUBLISH_SCRIPT_EOF

chmod +x "$INSTALL_DIR/release.sh" "$INSTALL_DIR/publish.sh"
echo "        ✓ release.sh and publish.sh created."

# ── Step 4: Save environment configuration ───────────────────────────────────
echo "[ 4/4 ] Saving environment configuration to ~/.jubilee.env..."
cat > "$HOME/.jubilee.env" << JUBILEE_ENV_EOF
# JubileeInspire.com — Deployment Configuration
# Generated by Cortex Workstation Setup — $(date '+%Y-%m-%d')
CORTEX_API=https://jubileeinspire.com/api/cortex
VPS=root@94.72.120.231
VPS_DIR=/var/www/jubileeinspire.com
GITEA_REMOTE=gitea-staging
# CF_ZONE_ID=your-cloudflare-zone-id   # Needed for publish cache purge
# CF_TOKEN=your-cloudflare-api-token   # Needed for publish cache purge
JUBILEE_ENV_EOF
chmod 600 "$HOME/.jubilee.env"
echo "        ✓ Configuration saved."

echo ""
echo "✅ Workstation setup complete."
echo "   Machine   : $MACHINE_HOSTNAME"
echo "   User      : $USER_EMAIL"
echo "   Scripts   : $INSTALL_DIR/release.sh"
echo "              $INSTALL_DIR/publish.sh"
echo "   Config    : ~/.jubilee.env"
echo ""
if [ "$REG_STATUS" = "pending" ]; then
    echo "⏳ Next step: Ask an Architect to approve this machine in Cortex."
    echo "   Open https://jubileeinspire.com/cortex/ → Machines"
    echo ""
elif [ "$REG_STATUS" = "approved" ]; then
    echo "   Ready to deploy:"
    echo "   bash $INSTALL_DIR/release.sh JubileeInspire.com"
    echo ""
fi

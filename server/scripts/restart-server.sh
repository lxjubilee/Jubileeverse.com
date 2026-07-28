#!/bin/bash

# Restart server and wait for it to be ready
# Handles edge cases: old process still running, port in use, etc.

set -e

echo "=== JubileeVerse Server Restart ==="
echo ""

# Try to find and kill any existing node processes on port 3107
echo "[1/5] Checking for existing server process..."
PIDS=$(lsof -t -i :3107 2>/dev/null || true)
if [ ! -z "$PIDS" ]; then
  echo "Found process(es) on port 3107: $PIDS"
  for PID in $PIDS; do
    echo "Killing PID $PID..."
    kill -9 $PID 2>/dev/null || true
  done
  echo "Waiting 3 seconds for port to release..."
  sleep 3
else
  echo "No existing process found on port 3107"
fi

# Verify port is free
echo ""
echo "[2/5] Verifying port 3107 is available..."
if lsof -t -i :3107 &>/dev/null; then
  echo "ERROR: Port 3107 still in use after cleanup"
  exit 1
fi
echo "✓ Port 3107 is free"

# Start the server
echo ""
echo "[3/5] Starting server..."
cd "$(dirname "$0")/.."
npm start > /tmp/server.log 2>&1 &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"

# Wait for server to be ready
echo ""
echo "[4/5] Waiting for server to be ready (max 15 seconds)..."
for i in {1..15}; do
  if curl -s http://localhost:3107/health > /dev/null 2>&1; then
    echo "✓ Server is ready (attempt $i)"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "ERROR: Server failed to start after 15 seconds"
    cat /tmp/server.log | tail -20
    exit 1
  fi
  echo "  Waiting... ($i/15)"
  sleep 1
done

# Verify server loaded .env correctly
echo ""
echo "[5/5] Verifying IC API credentials are loaded..."
HEALTH=$(curl -s http://localhost:3107/health)
if echo "$HEALTH" | grep -q '"service":"JubileeVerse"'; then
  echo "✓ Server is responding"
else
  echo "ERROR: Server not responding correctly"
  cat /tmp/server.log | tail -20
  exit 1
fi

echo ""
echo "=== ✓ Server restarted successfully ==="
echo "Server PID: $SERVER_PID"
echo "Port: 3107"
echo "Log: /tmp/server.log"
echo ""

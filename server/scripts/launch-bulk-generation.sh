#!/bin/bash

# Launch multiple bulk article generation workers in parallel
# Usage: ./scripts/launch-bulk-generation.sh [num_workers]
# Default: 15 workers

NUM_WORKERS=${1:-15}
LOG_DIR="logs"
DB_PASSWORD=${DB_PASSWORD:-""}

# Create logs directory
mkdir -p "$LOG_DIR"

echo "=========================================="
echo "Launching $NUM_WORKERS bulk generation workers"
echo "=========================================="

# Export environment for workers
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5433}"
export DB_NAME="${DB_NAME:-jubileeverse}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD}"

# Start workers
for i in $(seq 1 $NUM_WORKERS); do
  echo "Starting worker $i of $NUM_WORKERS..."
  WORKER_ID="worker-$i" nohup node workers/bulk-subcategory-generation.js >> "$LOG_DIR/worker-$i.log" 2>&1 &
  PIDS[$i]=$!
  sleep 1  # Stagger startup
done

echo "=========================================="
echo "Launched $NUM_WORKERS workers"
echo "=========================================="
echo ""
echo "Monitor progress with:"
echo "  tail -f logs/bulk-subcategory-generation.log"
echo ""
echo "Monitor individual workers with:"
echo "  tail -f logs/worker-1.log"
echo "  tail -f logs/worker-2.log"
echo "  ... etc"
echo ""
echo "Wait for all workers to complete..."
wait

echo "=========================================="
echo "All workers completed!"
echo "=========================================="

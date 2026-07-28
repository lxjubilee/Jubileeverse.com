#!/bin/bash

# Launch 10-20 concurrent bulk article generation workers
# Each worker targets different top-100 subcategories and generates unique articles

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOGS_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOGS_DIR"

echo "📦 Bulk Article Generation Worker Launcher"
echo "==========================================\n"

# Worker count
NUM_WORKERS=${1:-15}

echo "Launching $NUM_WORKERS workers..."
echo "Logs will be saved to: $LOGS_DIR"
echo ""

for i in $(seq 1 $NUM_WORKERS); do
    WORKER_LOG="$LOGS_DIR/worker-$i.log"
    
    # Stagger startup by 500ms to avoid thundering herd
    DELAY=$((($i - 1) * 500))
    
    echo "Worker $i: Starting in ${DELAY}ms..."
    
    (
        sleep $(echo "scale=3; $DELAY / 1000" | bc)
        echo "[$(date)] Worker $i starting..." >> "$WORKER_LOG"
        cd "$PROJECT_ROOT"
        node workers/bulk-subcategory-generation.js >> "$WORKER_LOG" 2>&1
    ) &
    
    PID=$!
    echo "Worker $i: PID=$PID, log=$WORKER_LOG"
done

echo ""
echo "✓ Launched $NUM_WORKERS workers"
echo "Monitor progress:"
echo "  tail -f logs/worker-1.log"
echo ""
echo "Wait for all workers to complete..."
wait
echo ""
echo "✓ All workers completed!"


#!/usr/bin/env node

/**
 * Bulk Article Generation Worker Launcher
 *
 * Spawns 10-20 concurrent Node.js worker processes to generate articles
 * across all JubileeVerse categories using the top 100 subcategories.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const NUM_WORKERS = process.argv[2] ? parseInt(process.argv[2]) : 15;
const PROJECT_ROOT = path.join(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const WORKER_SCRIPT = path.join(PROJECT_ROOT, 'workers', 'bulk-subcategory-generation.js');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

console.log('\n📦 Bulk Article Generation Worker Launcher');
console.log('==========================================\n');
console.log(`Launching ${NUM_WORKERS} workers...`);
console.log(`Logs will be saved to: ${LOGS_DIR}\n`);

const workers = [];
const startTime = Date.now();

for (let i = 1; i <= NUM_WORKERS; i++) {
    const logFile = path.join(LOGS_DIR, `worker-${i}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Stagger startup by 200ms to avoid thundering herd
    const delayMs = (i - 1) * 200;

    setTimeout(() => {
        console.log(`Worker ${i}: Starting...`);

        const worker = spawn('node', [WORKER_SCRIPT], {
            cwd: PROJECT_ROOT,
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        worker.stdout.on('data', (data) => {
            logStream.write(data);
            process.stdout.write(`[Worker ${i}] ${data}`);
        });

        worker.stderr.on('data', (data) => {
            logStream.write(`[STDERR] ${data}`);
            process.stderr.write(`[Worker ${i}] ERROR: ${data}`);
        });

        worker.on('close', (code) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`Worker ${i}: Exited with code ${code} (elapsed: ${elapsed}s)`);
            logStream.end();
        });

        workers.push({
            id: i,
            process: worker,
            logFile: logFile,
            startTime: Date.now()
        });

        console.log(`Worker ${i}: PID=${worker.pid}, log=${logFile}`);
    }, delayMs);
}

console.log(`\n✓ Spawned ${NUM_WORKERS} workers\n`);
console.log('Monitor individual worker progress:');
console.log(`  tail -f logs/worker-1.log`);
console.log(`  tail -f logs/worker-2.log`);
console.log('...\n');

// Periodically report status
const statusInterval = setInterval(() => {
    const runningWorkers = workers.filter(w => !w.process.killed);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Status] Elapsed: ${elapsed}s | Running: ${runningWorkers.length}/${NUM_WORKERS}`);
}, 30000);

// Wait for all workers to complete
const allDone = new Promise((resolve) => {
    let completed = 0;
    workers.forEach(w => {
        w.process.on('close', () => {
            completed++;
            if (completed === NUM_WORKERS) {
                resolve();
            }
        });
    });
});

allDone.then(() => {
    clearInterval(statusInterval);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n✓ All ${NUM_WORKERS} workers completed!`);
    console.log(`Total time: ${totalTime}s\n`);
    console.log('Results summary:');
    workers.forEach(w => {
        const duration = ((w.process.exitCode !== null ? w.process.exitCode : Date.now()) - w.startTime) / 1000;
        console.log(`  Worker ${w.id}: log=${w.logFile}`);
    });
    console.log('\nTo see total articles generated:');
    console.log('  grep -h "generated" logs/worker-*.log | wc -l');
});

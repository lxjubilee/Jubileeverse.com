const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const NUM_WORKERS = 15;
const PROJECT_ROOT = __dirname;
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const WORKER_SCRIPT = path.join(PROJECT_ROOT, 'workers', 'bulk-subcategory-generation.js');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

console.log('\n📦 Launching Bulk Article Generation Workers');
console.log('============================================\n');
console.log(`Launching ${NUM_WORKERS} workers...\n`);

const workers = [];
const startTime = Date.now();

for (let i = 1; i <= NUM_WORKERS; i++) {
  const logFile = path.join(LOGS_DIR, `worker-${i}.log`);
  const delayMs = (i - 1) * 100;

  setTimeout(() => {
    console.log(`Worker ${i}: Starting...`);

    const worker = spawn('node', [WORKER_SCRIPT], {
      cwd: PROJECT_ROOT,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WORKER_ID: `worker-${i}` }
    });

    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

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

    workers.push({ id: i, process: worker, logFile, startTime: Date.now() });
    console.log(`Worker ${i}: PID=${worker.pid}, log=${logFile}`);
  }, delayMs);
}

console.log(`\n✓ Spawned ${NUM_WORKERS} workers\n`);
console.log('Monitor progress:');
console.log('  tail -f logs/worker-1.log');
console.log('  tail -f logs/bulk-subcategory-generation.log\n');

// Status updates every 30 seconds
const statusInterval = setInterval(() => {
  const running = workers.filter(w => !w.process.killed).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Status] Elapsed: ${elapsed}s | Running: ${running}/${NUM_WORKERS}`);
}, 30000);

// Wait for all workers
const allDone = new Promise((resolve) => {
  let completed = 0;
  workers.forEach(w => {
    w.process.on('close', () => {
      completed++;
      if (completed === NUM_WORKERS) resolve();
    });
  });
});

allDone.then(() => {
  clearInterval(statusInterval);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ All ${NUM_WORKERS} workers completed!`);
  console.log(`Total time: ${totalTime}s\n`);
});

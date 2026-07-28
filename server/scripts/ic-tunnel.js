#!/usr/bin/env node
/**
 * Persistent SSH reverse tunnel: production:8081 → localhost:8080 (InspireCortex API)
 * Managed by PM2 (auto-restarts on exit). Run: pm2 start scripts/ic-tunnel.js --name ic-tunnel
 */
'use strict';

const { spawn } = require('child_process');

function startTunnel() {
    console.log(`[${new Date().toISOString()}] Starting SSH reverse tunnel (prod:8081 → local:8080)...`);

    const ssh = spawn('ssh', [
        '-N',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'StrictHostKeyChecking=no',
        '-R', '8081:localhost:8080',
        'jubilee-prod',
    ], { stdio: 'inherit' });

    ssh.on('exit', (code, signal) => {
        console.log(`[${new Date().toISOString()}] SSH tunnel exited (code=${code}, signal=${signal}) — PM2 will restart`);
        process.exit(1); // PM2 sees non-zero exit and restarts
    });

    ssh.on('error', (err) => {
        console.error(`[${new Date().toISOString()}] SSH spawn error: ${err.message}`);
        process.exit(1);
    });

    process.on('SIGTERM', () => { ssh.kill(); process.exit(0); });
    process.on('SIGINT',  () => { ssh.kill(); process.exit(0); });
}

startTunnel();

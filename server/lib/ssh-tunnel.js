/**
 * SSH Tunnel Manager - Programmatic SSH tunnel to remote database
 *
 * Automatically detects whether direct database connection is available.
 * If not, establishes an SSH tunnel from localhost:5433 to the remote database.
 * Works from any system in the lab environment. No manual SSH commands required.
 */

const { Client } = require('ssh2');
const net = require('net');
const pg = require('pg');

let tunnel = null;
let sshClient = null;
let forwardServer = null;
let isConnected = false;
let reconnectAttempts = 0;
let tunnelInUse = false;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL = 5000; // 5 seconds between retries

/**
 * Auto-detect whether to use direct connection or SSH tunnel
 * Returns true if SSH tunnel should be used, false if direct connection works
 */
async function detectConnectionMethod() {
    const DB_HOST = process.env.DB_HOST || 'localhost';
    const DB_PORT = parseInt(process.env.DB_PORT || '5433');
    const DB_NAME = process.env.DB_NAME || 'jubileeverse';
    const DB_USER = process.env.DB_USER || 'postgres';
    const DB_PASSWORD = process.env.DB_PASSWORD || '';

    console.log(`[SSH Tunnel] Testing direct database connection to ${DB_HOST}:${DB_PORT}...`);

    return new Promise((resolve) => {
        const testPool = new pg.Pool({
            host: DB_HOST,
            port: DB_PORT,
            database: DB_NAME,
            user: DB_USER,
            password: DB_PASSWORD,
            statement_timeout: 5000,
            connectionTimeoutMillis: 5000,
            idle_in_transaction_session_timeout: 5000,
            max: 1,
        });

        testPool.query('SELECT NOW()', (err) => {
            testPool.end();

            if (!err) {
                console.log(`[SSH Tunnel] ✓ Direct database connection works — SSH tunnel not needed`);
                resolve(false); // Don't use SSH tunnel
            } else {
                console.log(`[SSH Tunnel] ✗ Direct connection failed: ${err.message}`);
                console.log(`[SSH Tunnel] Will attempt to establish SSH tunnel instead...`);
                resolve(true); // Use SSH tunnel
            }
        });

        // Timeout fallback
        setTimeout(() => {
            testPool.end();
            console.log(`[SSH Tunnel] ✗ Direct connection timeout — will use SSH tunnel`);
            resolve(true);
        }, 6000);
    });
}

/**
 * Initialize SSH tunnel to remote database (only if needed)
 * Resolves when tunnel is ready
 */
async function initializeSSHTunnel() {
    return new Promise((resolve, reject) => {
        const SSH_HOST = process.env.SSH_HOST || 'jubilee-uat';
        const SSH_PORT = parseInt(process.env.SSH_PORT || '22');
        const SSH_USER = process.env.SSH_USER || 'root';
        const SSH_KEY = process.env.SSH_PRIVATE_KEY || null;
        const SSH_PASSWORD = process.env.SSH_PASSWORD || null;

        const REMOTE_DB_HOST = process.env.REMOTE_DB_HOST || 'localhost';
        const REMOTE_DB_PORT = parseInt(process.env.REMOTE_DB_PORT || '5432');
        const LOCAL_BIND_HOST = '127.0.0.1';
        const LOCAL_BIND_PORT = parseInt(process.env.DB_PORT || '5433');

        console.log(`[SSH Tunnel] Connecting to ${SSH_USER}@${SSH_HOST}:${SSH_PORT}...`);

        sshClient = new Client();
        let connectionEstablished = false;

        sshClient.on('ready', () => {
            console.log(`[SSH Tunnel] ✓ SSH connection established`);
            connectionEstablished = true;

            // Create forward server
            forwardServer = net.createServer((socket) => {
                sshClient.forwardOut(
                    LOCAL_BIND_HOST,
                    LOCAL_BIND_PORT,
                    REMOTE_DB_HOST,
                    REMOTE_DB_PORT,
                    (err, stream) => {
                        if (err) {
                            console.error(`[SSH Tunnel] Forward error:`, err.message);
                            socket.destroy();
                            return;
                        }
                        socket.pipe(stream).pipe(socket);
                    }
                );
            });

            forwardServer.listen(LOCAL_BIND_PORT, LOCAL_BIND_HOST, () => {
                console.log(`[SSH Tunnel] ✓ Tunnel ready: localhost:${LOCAL_BIND_PORT} → ${REMOTE_DB_HOST}:${REMOTE_DB_PORT}`);
                isConnected = true;
                tunnelInUse = true;
                reconnectAttempts = 0;
                resolve();
            });

            forwardServer.on('error', (err) => {
                console.error(`[SSH Tunnel] Server error:`, err.message);
                if (!isConnected) reject(err);
                attemptReconnect();
            });
        });

        sshClient.on('error', (err) => {
            console.error(`[SSH Tunnel] ✗ SSH error:`, err.message);
            if (!connectionEstablished && !isConnected) {
                reject(err);
            } else {
                attemptReconnect();
            }
        });

        sshClient.on('close', () => {
            console.log(`[SSH Tunnel] SSH connection closed`);
            isConnected = false;
            if (forwardServer) forwardServer.close();
            attemptReconnect();
        });

        sshClient.on('end', () => {
            console.log(`[SSH Tunnel] SSH connection ended`);
            isConnected = false;
        });

        // Configure SSH connection
        const sshConfig = {
            host: SSH_HOST,
            port: SSH_PORT,
            username: SSH_USER,
            readyTimeout: 30000,
            tryKeyboard: false,
        };

        // Use key-based auth if available, otherwise password
        if (SSH_KEY) {
            sshConfig.privateKey = Buffer.from(SSH_KEY);
        } else if (SSH_PASSWORD) {
            sshConfig.password = SSH_PASSWORD;
        } else {
            // Try default key locations
            try {
                const fs = require('fs');
                const homeDir = require('os').homedir();
                const keyPath = `${homeDir}/.ssh/id_rsa`;
                if (fs.existsSync(keyPath)) {
                    sshConfig.privateKey = fs.readFileSync(keyPath);
                } else {
                    sshConfig.password = 'root'; // Fallback
                }
            } catch (e) {
                sshConfig.password = 'root'; // Fallback
            }
        }

        try {
            sshClient.connect(sshConfig);
        } catch (err) {
            console.error(`[SSH Tunnel] Connection failed:`, err.message);
            reject(err);
        }

        // Set timeout for connection attempt
        setTimeout(() => {
            if (!isConnected && connectionEstablished === false) {
                console.error(`[SSH Tunnel] Connection timeout`);
                sshClient.end();
                reject(new Error('SSH connection timeout'));
            }
        }, 35000);
    });
}

/**
 * Attempt to reconnect after connection loss
 */
function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(`[SSH Tunnel] ✗ Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded`);
        process.exit(1);
    }

    reconnectAttempts++;
    console.log(`[SSH Tunnel] Attempting reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_INTERVAL}ms...`);

    setTimeout(() => {
        if (!isConnected) {
            console.log(`[SSH Tunnel] Reconnecting...`);
            initializeSSHTunnel().catch(err => {
                console.error(`[SSH Tunnel] Reconnection failed:`, err.message);
                // Keep trying
            });
        }
    }, RECONNECT_INTERVAL);
}

/**
 * Get tunnel status
 */
function getStatus() {
    return {
        connected: isConnected,
        tunnelInUse,
        reconnectAttempts,
        maxAttempts: MAX_RECONNECT_ATTEMPTS
    };
}

/**
 * Gracefully close tunnel
 */
function closeTunnel() {
    console.log(`[SSH Tunnel] Closing...`);
    if (forwardServer) {
        forwardServer.close();
    }
    if (sshClient) {
        sshClient.end();
    }
    isConnected = false;
}

module.exports = {
    detectConnectionMethod,
    initializeSSHTunnel,
    getStatus,
    closeTunnel,
    isConnected: () => isConnected,
    isTunnelInUse: () => tunnelInUse
};

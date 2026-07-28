'use strict';

/**
 * lib/oauth-encryption.js — AES-256-GCM token encryption for user_oauth_tokens
 *
 * Storage format: "iv_hex:authTag_hex:ciphertext_hex"
 * Key source:     OAUTH_TOKEN_ENCRYPTION_KEY env var (64 hex chars = 32 bytes)
 */

const crypto = require('crypto');

const ALGO    = 'aes-256-gcm';
const IV_LEN  = 12;  // 96-bit IV recommended for GCM
const TAG_LEN = 16;  // 128-bit authentication tag

function _getKey() {
    const hex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
        throw new Error(
            'OAUTH_TOKEN_ENCRYPTION_KEY must be set to exactly 64 hex characters (32 bytes)'
        );
    }
    return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns "iv:authTag:ciphertext" (all hex-encoded), or null if plaintext is falsy.
 */
function encrypt(plaintext) {
    if (!plaintext) return null;
    const key    = _getKey();
    const iv     = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a stored "iv:authTag:ciphertext" string.
 * Returns the original plaintext, or null if stored value is falsy.
 */
function decrypt(stored) {
    if (!stored) return null;
    const parts = stored.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted token format — expected iv:tag:enc');
    const [ivHex, tagHex, encHex] = parts;
    const key      = _getKey();
    const iv       = Buffer.from(ivHex, 'hex');
    const authTag  = Buffer.from(tagHex, 'hex');
    const enc      = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/**
 * Mask a plaintext token for display (never expose full token via API).
 * "sk-ant-api..." → "sk-ant-...last4"
 * Arbitrary keys:  "abc...last4"
 */
function mask(plaintext) {
    if (!plaintext || plaintext.length < 8) return '***';
    if (plaintext.startsWith('sk-')) {
        // Anthropic-style key: keep first 6 chars prefix
        return `${plaintext.slice(0, 6)}...${plaintext.slice(-4)}`;
    }
    return `${plaintext.slice(0, 3)}...${plaintext.slice(-4)}`;
}

module.exports = { encrypt, decrypt, mask };

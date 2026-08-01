'use strict';

/**
 * anthropic-client.js — builds Anthropic SDK clients that authenticate correctly.
 *
 * Two credential shapes live in .env and they do NOT go in the same place:
 *
 *   sk-ant-oat*   OAuth token   ->  Authorization: Bearer   (SDK `authToken`)
 *   sk-ant-api*   API key       ->  x-api-key               (SDK `apiKey`)
 *
 * Passing an OAuth token as `apiKey` fails with 401 "invalid x-api-key", which
 * is easy to misread as an expired credential. Every call site used to do
 * exactly that, so the Claude Code token silently never worked and each caller
 * rotated straight past it to the api-key chain.
 *
 * Never set both fields: the SDK then sends both headers and the API rejects
 * the request outright.
 *
 * Use `clientFor()` when you hold a specific credential (key-rotation loops),
 * and `buildAnthropicClient()` when you just want the best available one.
 */

const Anthropic = require('@anthropic-ai/sdk');

/** OAuth access tokens carry this prefix; API keys use sk-ant-api*. */
const OAUTH_PREFIX = 'sk-ant-oat';

/**
 * Required for OAuth-authenticated requests. Some endpoints happen to work
 * without it, so it is sent always rather than per-endpoint.
 */
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';

/** Whether a credential authenticates as a Bearer token rather than an API key. */
function isOAuthToken(credential) {
    return typeof credential === 'string' && credential.startsWith(OAUTH_PREFIX);
}

/** A label safe to log — never the credential itself. */
function describeCredential(credential) {
    if (!credential) return 'none';
    return isOAuthToken(credential) ? 'OAuth token (Bearer)' : 'API key (x-api-key)';
}

/**
 * An Anthropic client for one specific credential, or null when there is none.
 * The credential's own shape decides which auth field it lands in.
 */
function clientFor(credential) {
    if (!credential) return null;

    if (isOAuthToken(credential)) {
        return new Anthropic({
            apiKey: null,   // must stay null: apiKey + authToken together => 401
            authToken: credential,
            defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADER },
        });
    }

    return new Anthropic({ apiKey: credential });
}

/**
 * Every configured credential, best first and de-duplicated.
 *
 * CLAUDE_CODE leads because it is the one verified to work; the api-key chain
 * follows so a restored key takes over with no code change. `preferred` is for
 * callers that accept an explicit credential (constructor arguments) — it is
 * tried ahead of the environment.
 */
function credentialChain(preferred) {
    return [
        preferred,
        process.env.ANTHROPIC_API_KEY_CLAUDE_CODE,
        process.env.ANTHROPIC_API_KEY,
        process.env.ANTHROPIC_API_KEY_PRIMARY,
        process.env.ANTHROPIC_API_KEY_BACKUP,
        process.env.CLAUDE_API_KEY,
    ]
        .filter(Boolean)
        .filter((credential, i, all) => all.indexOf(credential) === i);
}

/**
 * A client on the best available credential, or null when none is configured.
 * Callers that want rotation should hold `credentialChain()` and walk it with
 * `clientFor()` instead.
 */
function buildAnthropicClient(preferred) {
    const credential = credentialChain(preferred)[0];
    if (!credential) {
        console.warn('[Anthropic] No credential configured');
        return null;
    }
    console.log(`[Anthropic] Using ${describeCredential(credential)}`);
    return clientFor(credential);
}

// ── Credential rotation ──────────────────────────────────────────────────────

/** 401/403: this credential will not work again this run. */
function isAuthError(e) {
    const status = e?.status ?? e?.$metadata?.httpStatusCode;
    return status === 401 || status === 403;
}

/** 429/5xx: transient, so the credential stays in the pool. */
function isRetryableApiError(e) {
    const status = e?.status ?? e?.$metadata?.httpStatusCode;
    return status === 429 || status === 529 || (status >= 500 && status < 600);
}

/**
 * A rotating view over the credential chain.
 *
 * The chain usually holds an OAuth token plus one or two API keys, and they
 * carry independent rate limits. A 429 on the first credential should move the
 * work to the next one rather than end it — a night of image judging exhausts a
 * small quota long before it runs out of articles, and this was not theoretical:
 * the very first live judge call in development came back 429.
 *
 * Rate limits are transient, so a throttled credential stays in the pool and
 * comes round again. An authentication failure is permanent for this run, so
 * that credential is retired outright; otherwise one bad key in the middle of
 * the chain fails everything after it.
 *
 * (article-composer.js carries its own copy of this logic, written first and
 * proven on live runs. It is deliberately not refactored onto this one here —
 * that is a change to the working composition path, not to image quality.)
 */
function createRotator({ label = 'anthropic', logger = console } = {}) {
    let chain = null;
    let index = 0;
    const clients = new Map();
    const dead = new Set();

    const all = () => (chain || (chain = credentialChain()));
    const usable = () => all().filter(c => !dead.has(c));

    return {
        size: () => usable().length,
        /** The current credential's client, or null when the chain is exhausted. */
        client() {
            const pool = usable();
            if (!pool.length) return null;
            if (index >= pool.length) index = 0;
            const credential = pool[index];
            if (!clients.has(credential)) {
                clients.set(credential, clientFor(credential));
                logger.log(`[${label}] using credential ${index + 1}/${pool.length} — ${describeCredential(credential)}`);
            }
            return clients.get(credential);
        },
        /** Advance past the current credential. False when there is nowhere to go. */
        rotate(reason, { permanent = false } = {}) {
            const pool = usable();
            const current = pool[Math.min(index, pool.length - 1)];

            if (permanent && current) {
                dead.add(current);
                clients.delete(current);
                logger.warn(`[${label}] ${reason} — retiring ${describeCredential(current)}`);
                if (index >= usable().length) index = 0;
                return usable().length > 0;
            }

            if (pool.length <= 1) return false;
            index = (index + 1) % pool.length;
            logger.warn(`[${label}] ${reason} — rotating to credential ${index + 1}/${pool.length}`);
            return true;
        },
    };
}

// ── Vision ───────────────────────────────────────────────────────────────────

/**
 * Media type from the first bytes, rather than from a filename.
 *
 * Buffers reach this module straight from a renderer or an object store, where
 * there is often no filename to trust and never an extension worth believing.
 * A wrong media_type is rejected by the API, so sniffing is the reliable path.
 */
function sniffImageMediaType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG') return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    if (buffer.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
    return null;
}

/**
 * One image content block for the Messages API.
 *
 * WebP is the format to send where there is a choice: these are 1344x768
 * photographic renders, so WebP carries the same pixels at roughly a tenth of
 * the base64 payload, and base64 is what the request body actually pays for.
 */
function imageBlock(buffer, { mediaType = null } = {}) {
    const type = mediaType || sniffImageMediaType(buffer);
    if (!type) throw new Error('imageBlock: unrecognised image format');
    return {
        type: 'image',
        source: { type: 'base64', media_type: type, data: buffer.toString('base64') },
    };
}

module.exports = {
    isOAuthToken,
    describeCredential,
    clientFor,
    credentialChain,
    buildAnthropicClient,
    isAuthError,
    isRetryableApiError,
    createRotator,
    sniffImageMediaType,
    imageBlock,
};

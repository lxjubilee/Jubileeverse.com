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

module.exports = {
    isOAuthToken,
    describeCredential,
    clientFor,
    credentialChain,
    buildAnthropicClient,
};

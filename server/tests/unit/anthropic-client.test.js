'use strict';
/**
 * Credential shape, rotation, and image blocks.
 *
 * The auth half of this module exists because passing an OAuth token as an API
 * key returns 401 "invalid x-api-key", which reads like an expired credential
 * rather than a misplaced one. The rotation half exists because the first live
 * judge call of development came back 429 on the first credential in the chain.
 */

const Client = require('../../lib/anthropic-client');

const withEnv = async (vars, fn) => {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try { return await fn(); } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
};

/** Every credential env var this module reads, cleared. */
const CLEARED = {
    ANTHROPIC_API_KEY_CLAUDE_CODE: undefined,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_API_KEY_PRIMARY: undefined,
    ANTHROPIC_API_KEY_BACKUP: undefined,
    CLAUDE_API_KEY: undefined,
};

const quiet = { log() {}, warn() {} };

describe('credential shape', () => {
    test('an OAuth token is recognised by its prefix, an API key is not', () => {
        expect(Client.isOAuthToken('sk-ant-oat01-abc')).toBe(true);
        expect(Client.isOAuthToken('sk-ant-api03-abc')).toBe(false);
        expect(Client.isOAuthToken(undefined)).toBe(false);
    });

    test('the description never leaks the credential itself', () => {
        const secret = 'sk-ant-api03-SUPERSECRETVALUE';
        expect(Client.describeCredential(secret)).not.toContain('SUPERSECRET');
        expect(Client.describeCredential(secret)).toMatch(/API key/);
        expect(Client.describeCredential('sk-ant-oat01-x')).toMatch(/OAuth/);
    });
});

describe('the credential chain', () => {
    test('deduplicates, so one key repeated across vars is not three attempts', async () => {
        await withEnv({ ...CLEARED, ANTHROPIC_API_KEY: 'same', ANTHROPIC_API_KEY_PRIMARY: 'same' }, () => {
            expect(Client.credentialChain()).toEqual(['same']);
        });
    });

    test('an explicitly passed credential is tried before the environment', async () => {
        await withEnv({ ...CLEARED, ANTHROPIC_API_KEY: 'from-env' }, () => {
            expect(Client.credentialChain('explicit')[0]).toBe('explicit');
        });
    });
});

describe('rotation', () => {
    test('a rate limit moves to the next credential and keeps the first in the pool', async () => {
        await withEnv({ ...CLEARED, ANTHROPIC_API_KEY: 'key-a', ANTHROPIC_API_KEY_BACKUP: 'key-b' }, () => {
            const r = Client.createRotator({ logger: quiet });
            expect(r.size()).toBe(2);
            expect(r.client()).toBeTruthy();
            expect(r.rotate('HTTP 429')).toBe(true);
            expect(r.size()).toBe(2);          // throttling is transient
        });
    });

    test('an auth failure retires the credential for the rest of the run', async () => {
        await withEnv({ ...CLEARED, ANTHROPIC_API_KEY: 'key-a', ANTHROPIC_API_KEY_BACKUP: 'key-b' }, () => {
            const r = Client.createRotator({ logger: quiet });
            expect(r.rotate('HTTP 401', { permanent: true })).toBe(true);
            expect(r.size()).toBe(1);
            // Retiring the last one leaves nowhere to go.
            expect(r.rotate('HTTP 401', { permanent: true })).toBe(false);
            expect(r.client()).toBeNull();
        });
    });

    test('a single credential cannot rotate, and says so rather than looping', async () => {
        await withEnv({ ...CLEARED, ANTHROPIC_API_KEY: 'only' }, () => {
            const r = Client.createRotator({ logger: quiet });
            expect(r.rotate('HTTP 429')).toBe(false);
        });
    });

    test('with no credentials at all there is no client to hand back', async () => {
        await withEnv(CLEARED, () => {
            expect(Client.createRotator({ logger: quiet }).client()).toBeNull();
        });
    });

    test('classifies the statuses that drive each decision', () => {
        expect(Client.isAuthError({ status: 401 })).toBe(true);
        expect(Client.isAuthError({ status: 429 })).toBe(false);
        expect(Client.isRetryableApiError({ status: 429 })).toBe(true);
        expect(Client.isRetryableApiError({ status: 529 })).toBe(true);
        expect(Client.isRetryableApiError({ status: 503 })).toBe(true);
        expect(Client.isRetryableApiError({ status: 400 })).toBe(false);
    });
});

describe('image blocks', () => {
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(8)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12)]);

    test('sniffs the format from the bytes, not from a filename', () => {
        expect(Client.sniffImageMediaType(png)).toBe('image/png');
        expect(Client.sniffImageMediaType(webp)).toBe('image/webp');
        expect(Client.sniffImageMediaType(jpeg)).toBe('image/jpeg');
        expect(Client.sniffImageMediaType(Buffer.from('not an image at all'))).toBeNull();
    });

    test('builds a base64 source block the Messages API accepts', () => {
        const block = Client.imageBlock(webp);
        expect(block.type).toBe('image');
        expect(block.source.type).toBe('base64');
        expect(block.source.media_type).toBe('image/webp');
        expect(Buffer.from(block.source.data, 'base64')).toEqual(webp);
    });

    test('an unrecognised buffer raises rather than sending a wrong media_type', () => {
        expect(() => Client.imageBlock(Buffer.from('nope'))).toThrow(/unrecognised/);
    });
});

'use strict';
/**
 * Article translation — the pieces that decided whether it worked in production.
 *
 * Three defects are covered here, each one only reachable with production's
 * configuration:
 *
 *   1. The CSRF guard 403s every /api/ POST from a reader who holds a session
 *      cookie, and the frontend never sent the header back. Signing in is what
 *      creates that cookie, and only the deployed site puts readers through the
 *      sign-in that sets it.
 *   2. Article ids that are not plain integers became NaN on the way into the
 *      translation cache, which pg sends as the string "NaN" — so the query
 *      failed and no article addressed by slug or UUID ever cached.
 *   3. The shared 30 s request timeout could not express a parameterised path,
 *      so a translation slower than 30 s was answered 503 mid-flight.
 *
 * Nothing here is re-implemented: the real middleware and helpers are lifted out
 * of server.js, and the client helper out of src/lib/csrf.ts, so the assertions
 * fail if the shipped source drifts.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');

const SERVER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

/**
 * The source text of a top-level `function <name>(...) { ... }`, found by
 * scanning for its balanced closing brace. Keeps these tests bound to the
 * shipped implementation rather than a copy that can quietly diverge.
 */
function extractFunction(src, name) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} not found in server.js`);
    let depth = 0;
    let seenBody = false;
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') { depth++; seenBody = true; }
        else if (src[i] === '}') {
            depth--;
            if (seenBody && depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error(`unbalanced braces reading ${name}`);
}

/** A `const NAME = [...]` / `= new Map([...])` style declaration, whole. */
function extractDeclaration(src, name) {
    const start = src.indexOf(`const ${name} = `);
    if (start < 0) throw new Error(`const ${name} not found in server.js`);
    let depth = 0;
    let seen = false;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === '[' || c === '(' || c === '{') { depth++; seen = true; }
        else if (c === ']' || c === ')' || c === '}') {
            depth--;
            if (seen && depth === 0) return src.slice(start, src.indexOf(';', i) + 1);
        }
    }
    throw new Error(`unbalanced brackets reading ${name}`);
}

/** Run extracted source in a sandbox and hand back the named globals. */
function evaluate(source, names) {
    const sandbox = { console, module: {}, exports: {} };
    vm.createContext(sandbox);
    vm.runInContext(`${source}\n;__out = { ${names.join(', ')} };`, sandbox);
    return sandbox.__out;
}

// ── The real helpers, lifted from server.js ──────────────────────────────────

const { translationIdentity, hashIdToInt } = evaluate(
    [
        'const HASHED_ID_FLOOR = 1_000_000_000;',
        extractFunction(SERVER_JS, 'hashIdToInt'),
        extractFunction(SERVER_JS, 'isUUID'),
        extractFunction(SERVER_JS, 'translationIdentity'),
    ].join('\n'),
    ['translationIdentity', 'hashIdToInt'],
);

const { LONG_RUNNING_PATHS } = evaluate(
    extractDeclaration(SERVER_JS, 'LONG_RUNNING_PATHS'),
    ['LONG_RUNNING_PATHS'],
);

const { LARGE_BODY_PATHS } = evaluate(
    extractDeclaration(SERVER_JS, 'LARGE_BODY_PATHS'),
    ['LARGE_BODY_PATHS'],
);

/** requireCsrf, with the session cookie name injectable so dev and prod both run. */
function buildCsrfMiddleware(sessionCookieName) {
    const { requireCsrf } = evaluate(
        [
            extractFunction(SERVER_JS, '_parseCookies'),
            `function _getSessionCookieName() { return ${JSON.stringify(sessionCookieName)}; }`,
            extractFunction(SERVER_JS, 'requireCsrf'),
        ].join('\n'),
        ['requireCsrf'],
    );
    return requireCsrf;
}

/** A miniature of the real app: the CSRF guard in front of the two endpoints. */
function buildApp(sessionCookieName = 'jv-session') {
    const app = express();
    app.use(express.json());
    app.use('/api/', buildCsrfMiddleware(sessionCookieName));
    app.post('/api/translate-batch', (_req, res) => res.json({ translations: { Prayer: 'Oración' } }));
    app.post('/api/articles/:id/translate', (_req, res) => res.json({ ok: true }));
    app.get('/api/articles/:id/translation/:lang', (_req, res) => res.json({ found: false }));
    return app;
}

// ── The real client helper, lifted from src/lib/csrf.ts ──────────────────────

function loadCsrfClient(cookieString) {
    const file = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'csrf.ts');
    const src = fs.readFileSync(file, 'utf8')
        .replace(/:\s*Record<string,\s*string>/g, '')
        .replace(/:\s*string\s*\|\s*null/g, '')
        .replace(/\bexport\s+/g, '');
    const sandbox = { document: { cookie: cookieString }, console };
    vm.createContext(sandbox);
    vm.runInContext(`${src}\n;__out = { getCsrfToken, csrfHeaders };`, sandbox);
    return sandbox.__out;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('CSRF token — the reason translation failed for signed-in readers', () => {
    test('a reader with no session cookie is not challenged (bearer path)', async () => {
        await request(buildApp()).post('/api/translate-batch').send({ texts: ['Prayer'] }).expect(200);
    });

    test('a session cookie without the header is rejected — the production failure', async () => {
        const res = await request(buildApp())
            .post('/api/articles/123/translate')
            .set('Cookie', 'jv-session=abc; jv-csrf=tok-1')
            .send({ language_code: 'es-ES' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/CSRF/i);
    });

    test('echoing the jv-csrf cookie back as a header lets it through', async () => {
        await request(buildApp())
            .post('/api/articles/123/translate')
            .set('Cookie', 'jv-session=abc; jv-csrf=tok-1')
            .set('X-CSRF-Token', 'tok-1')
            .send({ language_code: 'es-ES' })
            .expect(200);

        await request(buildApp())
            .post('/api/translate-batch')
            .set('Cookie', 'jv-session=abc; jv-csrf=tok-1')
            .set('X-CSRF-Token', 'tok-1')
            .send({ texts: ['Prayer'] })
            .expect(200);
    });

    test("production's __Host-jv-session cookie is guarded the same way", async () => {
        const app = buildApp('__Host-jv-session');
        await request(app)
            .post('/api/translate-batch')
            .set('Cookie', '__Host-jv-session=abc; jv-csrf=tok-9')
            .send({ texts: ['Prayer'] })
            .expect(403);
        await request(app)
            .post('/api/translate-batch')
            .set('Cookie', '__Host-jv-session=abc; jv-csrf=tok-9')
            .set('X-CSRF-Token', 'tok-9')
            .send({ texts: ['Prayer'] })
            .expect(200);
    });

    test('a mismatched token is still refused', async () => {
        await request(buildApp())
            .post('/api/translate-batch')
            .set('Cookie', 'jv-session=abc; jv-csrf=tok-1')
            .set('X-CSRF-Token', 'tok-2')
            .send({ texts: ['Prayer'] })
            .expect(403);
    });

    test('reading a cached translation is a GET and never challenged', async () => {
        await request(buildApp())
            .get('/api/articles/123/translation/es-ES')
            .set('Cookie', 'jv-session=abc; jv-csrf=tok-1')
            .expect(200);
    });
});

describe('the client sends what that guard asks for', () => {
    test('no cookie session — no header, so the bearer path is untouched', () => {
        expect(loadCsrfClient('').csrfHeaders()).toEqual({});
        expect(loadCsrfClient('other=1; theme=dark').csrfHeaders()).toEqual({});
    });

    test('the jv-csrf cookie becomes the X-CSRF-Token header', () => {
        expect(loadCsrfClient('jv-session=abc; jv-csrf=tok-1').csrfHeaders())
            .toEqual({ 'X-CSRF-Token': 'tok-1' });
    });

    test('a url-encoded token is decoded', () => {
        expect(loadCsrfClient('jv-csrf=a%2Bb%3Dc').getCsrfToken()).toBe('a+b=c');
    });

    test('a cookie merely ending in the name is not mistaken for it', () => {
        expect(loadCsrfClient('not-jv-csrf=nope').getCsrfToken()).toBeNull();
    });

    test('the header the client sends satisfies the real middleware', async () => {
        const headers = loadCsrfClient('jv-session=abc; jv-csrf=round-trip').csrfHeaders();
        await request(buildApp())
            .post('/api/translate-batch')
            .set('Cookie', 'jv-session=abc; jv-csrf=round-trip')
            .set(headers)
            .send({ texts: ['Prayer'] })
            .expect(200);
    });
});

describe('translation cache key — every id shape the reader can arrive with', () => {
    test('a backend serial keys on itself and may be read from the articles table', () => {
        const id = translationIdentity('4821');
        expect(id.cacheKey).toBe(4821);
        expect(id.isNativeInteger).toBe(true);
    });

    test('a published bundle id no longer becomes NaN', () => {
        const id = translationIdentity('biblical-wisdom__the-name-of-god');
        expect(Number.isNaN(id.cacheKey)).toBe(false);
        expect(Number.isInteger(id.cacheKey)).toBe(true);
        expect(id.cacheKey).toBeGreaterThanOrEqual(1_000_000_000);
        expect(id.cacheKey).toBeLessThan(2_147_483_647);   // INTEGER ceiling
        // Never used to look up an unrelated row in `articles`.
        expect(id.isNativeInteger).toBe(false);
    });

    test('a UUID keys stably instead of reporting a permanent miss', () => {
        const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
        const id = translationIdentity(uuid);
        expect(Number.isNaN(id.cacheKey)).toBe(false);
        expect(id.isUUID).toBe(true);
        expect(id.isNativeInteger).toBe(false);
        expect(id.cacheKey).toBe(translationIdentity(uuid).cacheKey);
    });

    test('a hashed news id is a cache key but never an articles lookup', () => {
        // src/lib/homeFeed.ts hands the backend ids in 1e9..2e9 for CDN news.
        const id = translationIdentity('1500000042');
        expect(id.cacheKey).toBe(1500000042);
        expect(id.isNativeInteger).toBe(false);
    });

    test('keys are stable across calls and distinct across articles', () => {
        const a = translationIdentity('faith-journey__walking-by-faith').cacheKey;
        const b = translationIdentity('faith-journey__walking-by-faith').cacheKey;
        const c = translationIdentity('faith-journey__walking-by-sight').cacheKey;
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    test('no id shape produces a value pg would send as the string "NaN"', () => {
        const shapes = [
            '4821', 'biblical-wisdom__the-name-of-god',
            '3f2504e0-4f89-11d3-9a0c-0305e82c3301', '1500000042',
            'sermons__a-very-long-slug-with-many-parts', '',
        ];
        for (const shape of shapes) {
            expect(String(translationIdentity(shape).cacheKey)).not.toBe('NaN');
        }
    });

    test('the hash matches the frontend scheme (FNV-1a, offset into 1e9)', () => {
        // Mirrors reactionIdForSlug in src/lib/homeFeed.ts.
        const reference = (slug) => {
            let hash = 2166136261;
            for (let i = 0; i < slug.length; i++) {
                hash ^= slug.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return 1_000_000_000 + (Math.abs(hash) % 1_000_000_000);
        };
        expect(hashIdToInt('church-history__nicaea')).toBe(reference('church-history__nicaea'));
    });
});

describe('request timeout — a translation is allowed to outlive 30 s', () => {
    const limitFor = (p) => {
        const hit = LONG_RUNNING_PATHS.find(([pattern]) => pattern.test(p));
        return hit ? hit[1] : 30_000;
    };

    test('the article translation stream gets a long budget', () => {
        expect(limitFor('/api/articles/4821/translate')).toBeGreaterThan(30_000);
        expect(limitFor('/api/articles/biblical-wisdom__the-name-of-god/translate')).toBeGreaterThan(30_000);
    });

    test('the batch UI translator gets a long budget', () => {
        expect(limitFor('/api/translate-batch')).toBeGreaterThan(30_000);
    });

    test('image regeneration keeps the budget it already had', () => {
        expect(limitFor('/api/admin/regenerate-image')).toBe(300_000);
    });

    test('ordinary endpoints are still held to 30 s', () => {
        expect(limitFor('/api/articles/4821/translation/es-ES')).toBe(30_000);
        expect(limitFor('/api/homepage-placement')).toBe(30_000);
        expect(limitFor('/api/articles/4821')).toBe(30_000);
    });
});

describe('request body limit — long articles reach the translator', () => {
    const isLarge = (p) => LARGE_BODY_PATHS.some((r) => r.test(p));

    test('only the translate route carries the raised cap', () => {
        expect(isLarge('/api/articles/4821/translate')).toBe(true);
        expect(isLarge('/api/articles/biblical-wisdom__the-name-of-god/translate')).toBe(true);
        expect(isLarge('/api/translate-batch')).toBe(false);
        expect(isLarge('/api/auth/login')).toBe(false);
        expect(isLarge('/api/admin/users/1')).toBe(false);
    });

    test('an article body over the 100 kb default is accepted there', async () => {
        const app = express();
        app.use((req, res, next) => {
            const parser = LARGE_BODY_PATHS.some((r) => r.test(req.path))
                ? express.json({ limit: '2mb' })
                : express.json();
            return parser(req, res, next);
        });
        app.post('/api/articles/:id/translate', (req, res) =>
            res.json({ length: (req.body.fallback_content || '').length }));
        app.post('/api/other', (_req, res) => res.json({ ok: true }));

        const body = { fallback_content: 'x'.repeat(300 * 1024) };
        const res = await request(app).post('/api/articles/4821/translate').send(body);
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(300 * 1024);

        // Everything else keeps the tighter default.
        await request(app).post('/api/other').send(body).expect(413);
    });
});

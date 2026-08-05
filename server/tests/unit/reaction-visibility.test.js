'use strict';
/**
 * Who can see a like count.
 *
 * The totals on a card are public: a like cast by one reader has to still be on
 * the card for a visitor who has never signed in. That is easy to state and easy
 * to lose, because it can be broken from either end without anything failing
 * loudly —
 *
 *   - the CLIENT sending an Authorization header on the counts request, which
 *     turns a public read into one that only works while signed in;
 *   - the SERVER growing an auth gate on the counts endpoint, at which point
 *     anonymous readers silently get zeros instead of an error.
 *
 * Both ends are pinned here. The personal reaction is checked from the other
 * direction: it MUST be authenticated, because it is per-reader by definition.
 *
 * The client half is TypeScript in src/, so the test transpiles the real file
 * and stubs its `api` module rather than restating the URLs.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const REACTIONS_TS = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'reactions.ts');
const SERVER_JS = path.join(__dirname, '..', '..', 'server.js');

/** Load src/lib/reactions.ts with a recording stub in place of ./api. */
function loadReactions() {
    const calls = [];
    const api = {
        async get(url, options) {
            calls.push({ method: 'GET', url, options });
            return { success: true, counts: {}, reactions: {} };
        },
        async post(url, body) {
            calls.push({ method: 'POST', url, body });
            return { reaction: 'like', counts: { likes: 1, dislikes: 0 } };
        },
    };

    const { outputText } = ts.transpileModule(fs.readFileSync(REACTIONS_TS, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    vm.runInNewContext(outputText, {
        module,
        exports: module.exports,
        require: (id) => (id === './api' ? { api } : {}),
    });
    return { ...module.exports, calls };
}

/**
 * The body of one Express handler in server.js, from its `app.<verb>(` line to
 * the next one. Enough to tell whether a route consults the token.
 */
function handlerSource(routeExpr) {
    const source = fs.readFileSync(SERVER_JS, 'utf8');
    const start = source.indexOf(routeExpr);
    if (start < 0) throw new Error(`route not found in server.js: ${routeExpr}`);
    const rest = source.slice(start + routeExpr.length);
    const next = rest.search(/\napp\.(get|post|put|patch|delete|use)\(/);
    return next < 0 ? rest : rest.slice(0, next);
}

describe('the client asks for totals as a public read', () => {
    test('counts go out with auth explicitly off', async () => {
        const { fetchSlugCounts, calls } = loadReactions();
        await fetchSlugCounts(['a-news-slug', 'covenant-identity__some-article']);

        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toContain('/api/reactions/slug/counts');
        // The whole point: no Authorization header is attached.
        expect(calls[0].options).toEqual(expect.objectContaining({ auth: false }));
    });

    test('both slugs travel in one request, comma separated and encoded', async () => {
        const { fetchSlugCounts, calls } = loadReactions();
        await fetchSlugCounts(['first-slug', 'second-slug']);

        expect(calls).toHaveLength(1);
        expect(decodeURIComponent(calls[0].url)).toContain('slugs=first-slug,second-slug');
    });

    test('an empty grid issues no request at all', async () => {
        const { fetchSlugCounts, calls } = loadReactions();
        await expect(fetchSlugCounts([])).resolves.toEqual({});
        expect(calls).toHaveLength(0);
    });
});

describe('the personal reaction stays authenticated', () => {
    test("reading the reader's own reactions does NOT disable auth", async () => {
        const { fetchUserSlugReactions, calls } = loadReactions();
        await fetchUserSlugReactions(['a-news-slug']);

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/api/reactions/slug/user');
        // Anything other than an explicit `auth: false` means the bearer token
        // is attached, which is what makes the answer this reader's own.
        expect(calls[0].options?.auth).not.toBe(false);
    });

    test('posting a reaction does not disable auth either', async () => {
        const { postSlugReaction, calls } = loadReactions();
        await postSlugReaction('a-news-slug', 'like');

        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toBe('/api/reactions/slug');
        expect(calls[0].body).toEqual({ slug: 'a-news-slug', reaction: 'like' });
    });
});

describe('the server keeps the counts endpoint open', () => {
    test('counts never consults the bearer token', () => {
        const body = handlerSource("app.get('/api/reactions/slug/counts'");
        expect(body).not.toMatch(/authVerifyJWT/);
        expect(body).not.toMatch(/Unauthorized/);
    });

    test('writing a reaction does require a verified token', () => {
        const body = handlerSource("app.post('/api/reactions/slug'");
        expect(body).toMatch(/authVerifyJWT/);
        expect(body).toMatch(/401/);
    });

    test("reading the reader's own reactions verifies the token, but does not 401", () => {
        // A signed-out reader gets an empty map: the grid asks on every load, and
        // "nobody is signed in" is not an error worth failing the page for.
        const body = handlerSource("app.get('/api/reactions/slug/user'");
        expect(body).toMatch(/authVerifyJWT/);
        expect(body).toMatch(/reactions: \{\}/);
    });
});

describe('the identifier a reaction is stored against', () => {
    test('news articles use their slug', () => {
        const { reactionSlugOf } = loadReactions();
        expect(reactionSlugOf({ slug: 'a-news-slug', id: 'a-news-slug' })).toBe('a-news-slug');
    });

    test('category articles, which have no slug, fall back to their id', () => {
        const { reactionSlugOf } = loadReactions();
        expect(reactionSlugOf({ id: 'covenant-identity__nobody-had-to-call-him-back' }))
            .toBe('covenant-identity__nobody-had-to-call-him-back');
    });

    test('a story with neither yields an empty string, which the caller filters', () => {
        const { reactionSlugOf } = loadReactions();
        expect(reactionSlugOf({})).toBe('');
    });
});

'use strict';
/**
 * The five-fold nav, built without a catalog file.
 *
 * The nav used to be read from `articles_catalog.json` at the CDN root. That
 * file is not published — it 404s — so the nav rendered empty and none of the
 * five categories were reachable from the header. The list now comes from the
 * category structure itself, with display names read from each published
 * bundle's manifest.
 *
 * Two properties matter and are asserted against the real source:
 *   1. all five categories are always returned, in reading order, whatever the
 *      CDN does — the nav is structural and must never lose an entry;
 *   2. no request goes to a catalog path.
 *
 * The module is TypeScript in src/, so the test transpiles the real file and
 * drives it with `fetch` stubbed, rather than restating the logic.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'articles.ts');

/** Label as published in each `<category>/articles.json`. */
const LABELS = {
    'covenant-identity': 'Covenant & Identity',
    'teshuvah-restoration': 'Teshuvah & Restoration',
    'shalom-salvation': 'Shalom & Salvation',
    'celebration-mishpakhah': 'Celebration & Mishpakhah',
    // The bundle is published under the catalog's folder name, not the route.
    'torah-hebraic': 'Torah & Hebraic Insights',
};

/**
 * Load src/lib/articles.ts for real, with `fetch` stubbed.
 *
 * TypeScript does the erasing — hand-rolled regexes go stale the moment the
 * source grows a type they do not know. The module's two imports are stubbed in
 * the sandbox: it has no other dependency.
 *
 * @param {(url: string) => {ok: boolean, status?: number, body?: string}} respond
 * @returns {{ exports: object, requested: string[] }}
 */
function loadArticles(respond) {
    const requested = [];
    const { outputText } = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });

    const stubs = {
        './articleId': { makeArticleId: (category, slug) => `${category}__${slug}` },
        './cdn': { CDN_BASE_URL: 'https://cdn.jubileeverse.com' },
    };

    const sandbox = {
        exports: {},
        module: { exports: {} },
        require: (id) => stubs[id] ?? {},
        console: { error() {}, warn() {}, log() {} },
        process: { env: {} },
        AbortSignal: { timeout: () => undefined },
        async fetch(url) {
            requested.push(String(url));
            const r = respond(String(url));
            return {
                ok: r.ok,
                status: r.status ?? (r.ok ? 200 : 404),
                text: async () => r.body ?? '',
            };
        },
    };
    sandbox.module.exports = sandbox.exports;
    vm.createContext(sandbox);
    vm.runInContext(outputText, sandbox);
    return { exports: sandbox.exports, requested };
}

/** Every manifest resolves, as on the live CDN. */
const allPublished = (url) => {
    const folder = (url.match(/\/articles\/([^/]+)\/articles\.json$/) || [])[1];
    return folder && LABELS[folder]
        ? { ok: true, body: JSON.stringify({ category: LABELS[folder], articles: [] }) }
        : { ok: false, status: 404 };
};

describe('fetchNavCategories — the five-fold nav without a catalog', () => {
    test('returns all five categories in reading order', async () => {
        const { exports: A } = loadArticles(allPublished);
        const nav = await A.fetchNavCategories();
        expect(nav.map((c) => c.slug)).toEqual([
            'covenant-identity',
            'teshuvah-restoration',
            'shalom-salvation',
            'celebration-mishpakhah',
            'torah-hebraic-insights',
        ]);
    });

    test('labels come from the published manifests, upper-cased as the nav renders them', async () => {
        const { exports: A } = loadArticles(allPublished);
        const nav = await A.fetchNavCategories();
        expect(nav.map((c) => c.label)).toEqual([
            'COVENANT & IDENTITY',
            'TESHUVAH & RESTORATION',
            'SHALOM & SALVATION',
            'CELEBRATION & MISHPAKHAH',
            'TORAH & HEBRAIC INSIGHTS',
        ]);
    });

    test('never asks for a catalog file', async () => {
        const { exports: A, requested } = loadArticles(allPublished);
        await A.fetchNavCategories();
        expect(requested.some((u) => /catalog/i.test(u))).toBe(false);
        expect(requested).toHaveLength(5);
        for (const url of requested) expect(url).toMatch(/\/articles\/[^/]+\/articles\.json$/);
    });

    test('the torah bundle folder still resolves behind its route slug', async () => {
        const { exports: A, requested } = loadArticles(allPublished);
        await A.fetchNavCategories();
        // Route is "torah-hebraic-insights"; the bundle is "torah-hebraic".
        expect(requested).toContain('https://cdn.jubileeverse.com/articles/torah-hebraic/articles.json');
    });
});

describe('fetchNavCategories — the nav survives a bad CDN', () => {
    test('a category with no manifest keeps its place, under a humanised name', async () => {
        const { exports: A } = loadArticles((url) =>
            url.includes('shalom-salvation') ? { ok: false, status: 404 } : allPublished(url));
        const nav = await A.fetchNavCategories();
        expect(nav).toHaveLength(5);
        expect(nav[2]).toEqual({ slug: 'shalom-salvation', label: 'SHALOM SALVATION' });
    });

    test('a total CDN outage still renders all five links', async () => {
        const { exports: A } = loadArticles(() => { throw new Error('network down'); });
        const nav = await A.fetchNavCategories();
        expect(nav.map((c) => c.slug)).toEqual(A.CATEGORY_ROUTES.slice());
        expect(nav.every((c) => c.label.length > 0)).toBe(true);
    });
});

describe('isNavCategorySlug — the root segment asks this about every slug', () => {
    const { exports: A } = loadArticles(allPublished);

    test('recognises the five category routes', () => {
        for (const slug of A.CATEGORY_ROUTES) expect(A.isNavCategorySlug(slug)).toBe(true);
    });

    test('rejects a news slug, so articles still resolve at the root', () => {
        expect(A.isNavCategorySlug('seouls-chip-stocks-jump-18-percent')).toBe(false);
        expect(A.isNavCategorySlug('')).toBe(false);
    });

    test('costs no request', () => {
        const { exports: B, requested } = loadArticles(allPublished);
        B.isNavCategorySlug('anything-at-all');
        expect(requested).toHaveLength(0);
    });
});

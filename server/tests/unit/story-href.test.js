'use strict';
/**
 * Where a story is read.
 *
 * Every card, carousel slide, search result and related-story row builds its
 * link through `storyHref`, so this one function decides the site's article
 * URLs. CDN news lives at the root (`/<slug>`); everything else keeps
 * `/article/<id>`. Sending news to /article/<id> breaks twice over — the id is
 * a slug, and that route reads `a__b` as `<category>__<slug>`.
 *
 * The reactions/views key is asserted alongside it because the two travel
 * together at every call site: a slug cannot go into an INTEGER article_id.
 *
 * The module is TypeScript in src/, so this test loads the real source and
 * erases the annotations rather than restating the rule.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load the URL helpers out of src/lib/article.ts, with their types erased. */
function loadHelpers() {
    const file = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'article.ts');
    const src = fs.readFileSync(file, 'utf8');

    const take = (signature, erased) => {
        const start = src.indexOf(signature);
        if (start === -1) throw new Error(`${signature} is no longer exported from src/lib/article.ts`);
        return src.slice(start, src.indexOf('\n}', start) + 2).replace(signature, erased);
    };

    const code = [
        take(
            "export function storyHref(story: Pick<Story, 'id' | 'slug' | 'date'>): string",
            'function storyHref(story)',
        ),
        take(
            "export function trackingIdOf(story: Pick<Story, 'id' | 'reaction_id'>): string | number",
            'function trackingIdOf(story)',
        ),
    ].join('\n\n');

    const sandbox = { exports: {} };
    vm.createContext(sandbox);
    vm.runInContext(`${code}\nexports.storyHref = storyHref; exports.trackingIdOf = trackingIdOf;`, sandbox);
    return sandbox.exports;
}

const { storyHref, trackingIdOf } = loadHelpers();

describe('storyHref — CDN news reads at the root', () => {
    const news = {
        id: 'seouls-chip-stocks-jump-18-percent',
        slug: 'seouls-chip-stocks-jump-18-percent',
        date: '2026-07-31',
        reaction_id: 1234567890,
    };

    test('a news story links to /<slug>, not /news/<slug>', () => {
        expect(storyHref(news)).toBe('/seouls-chip-stocks-jump-18-percent');
    });

    test('the slug itself is unchanged by the move', () => {
        expect(storyHref(news).slice(1)).toBe(news.slug);
    });

    test('no article URL is built under /news any more', () => {
        expect(storyHref(news).startsWith('/news/')).toBe(false);
    });
});

describe('storyHref — everything else is untouched', () => {
    test('a backend story still reads at /article/<id>', () => {
        expect(storyHref({ id: 4821 })).toBe('/article/4821');
    });

    test('a published bundle article keeps its composite id', () => {
        expect(storyHref({ id: 'covenant-identity__sealed-by-the-ruach' }))
            .toBe('/article/covenant-identity__sealed-by-the-ruach');
    });

    test('a slug without a day is not treated as news', () => {
        // Both fields are required: `date` is what marks a story as CDN news.
        expect(storyHref({ id: 77, slug: 'looks-like-news' })).toBe('/article/77');
    });
});

describe('trackingIdOf — reactions and views still key on an integer', () => {
    test('news uses its hashed reaction id, never the slug', () => {
        expect(trackingIdOf({ id: 'a-slug', reaction_id: 1500000000 })).toBe(1500000000);
    });

    test('everything else uses its own id', () => {
        expect(trackingIdOf({ id: 4821 })).toBe(4821);
    });
});

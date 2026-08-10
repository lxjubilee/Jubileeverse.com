'use strict';
/**
 * Where a translated article is stored, and what may reach that key.
 *
 * Two separate concerns, both pinned here because both are one edit away from
 * being expensive:
 *
 *   1. The key shape is a contract with itself. A translation written under one
 *      shape and looked up under another is never found, so every reader pays
 *      for a fresh model call while the bucket quietly fills with orphans —
 *      a failure with no error, no log line, and no wrong pixel.
 *   2. The language segment comes from the request. It is the first
 *      caller-supplied value in this codebase to become part of an object key,
 *      so what it may contain is asserted directly rather than assumed.
 */

const T = require('../../lib/r2-translations');
const C = require('../../lib/r2-client');
const N = require('../../lib/r2-news');
const { LANGUAGE_CODES } = require('../../lib/languages');

const DAY = '2026-07-31';
const SLUG = 'federal-court-rules-on-church-zoning';

describe('key shapes', () => {
    test('a news translation sits between the day and the slug', () => {
        expect(T.buildNewsTranslationKey({ date: DAY, slug: SLUG, lang: 'hi-IN' })).toBe(
            `news/2026/07/31/hi-IN/${SLUG}/article.md`,
        );
    });

    test('its English source is the same key without the language segment', () => {
        expect(T.buildNewsSourceKey({ date: DAY, slug: SLUG })).toBe(
            `news/2026/07/31/${SLUG}/article.md`,
        );
    });

    test('a category translation sits between the category and the slug', () => {
        expect(T.buildArticleTranslationKey({
            category: 'covenant-identity', slug: 'the-name-of-god', lang: 'hi-IN',
        })).toBe('articles/covenant-identity/hi-IN/the-name-of-god.md');
    });

    test('the route slug is mapped to the published folder', () => {
        // The nav links to torah-hebraic-insights; the bundle is torah-hebraic.
        expect(T.buildArticleTranslationKey({
            category: 'torah-hebraic-insights', slug: 'the-name-of-god', lang: 'ar-EG',
        })).toBe('articles/torah-hebraic/ar-EG/the-name-of-god.md');
        expect(T.buildArticleSourceKey({
            category: 'torah-hebraic-insights', slug: 'the-name-of-god',
        })).toBe('articles/torah-hebraic/the-name-of-god.md');
    });
});

describe('a key can only be built from values that belong in one', () => {
    test.each([
        ['../../etc'],
        ['hi-IN/../..'],
        ['/hi-IN'],
        ['xx-XX'],
        ['en-US'],
        [''],
        [null],
    ])('language %p is refused', (lang) => {
        expect(() => T.buildNewsTranslationKey({ date: DAY, slug: SLUG, lang })).toThrow();
    });

    test.each([['../other'], ['a/b'], ['Church-Zoning'], [''], [null]])(
        'slug %p is refused',
        (slug) => {
            expect(() => T.buildNewsTranslationKey({ date: DAY, slug, lang: 'hi-IN' })).toThrow();
        },
    );

    test.each([['2026-13-45'], ['2026/07/31'], ['31-07-2026'], [''], [null]])(
        'date %p is refused',
        (date) => {
            expect(() => T.buildNewsTranslationKey({ date, slug: SLUG, lang: 'hi-IN' })).toThrow();
        },
    );

    // A pattern alone accepts 2026-13-45, and Date rolls it forward into a
    // perfectly well-formed key for a day nobody asked for.
    test('an impossible date is not silently rolled into a real one', () => {
        expect(() => T.buildNewsTranslationKey({ date: '2026-02-30', slug: SLUG, lang: 'hi-IN' }))
            .toThrow();
    });

    test('a case variant resolves to the one canonical key, never a second one', () => {
        const canonical = T.buildNewsTranslationKey({ date: DAY, slug: SLUG, lang: 'hi-IN' });
        for (const variant of ['hi-in', 'HI-IN', 'Hi-In', ' hi-IN ']) {
            expect(T.buildNewsTranslationKey({ date: DAY, slug: SLUG, lang: variant }))
                .toBe(canonical);
        }
    });
});

describe('a language folder can never be mistaken for an article slug', () => {
    // Asserted structurally rather than by listing today's slugs: the property
    // has to keep proving itself when a language is added, and it rests on
    // newsSlugify lowercasing everything it emits.
    test.each(LANGUAGE_CODES)('%s carries an uppercase region', (code) => {
        expect(/[A-Z]/.test(code)).toBe(true);
    });

    test.each([
        'Hi-IN as a headline',
        'ZH-CN chip stocks jump 18%',
        'Seoul’s AR-SA trade deal',
        'FR CA summit opens',
    ])('newsSlugify(%p) cannot equal a language code', (headline) => {
        const slug = N.newsSlugify(headline);
        expect(/[A-Z]/.test(slug)).toBe(false);
        expect(LANGUAGE_CODES).not.toContain(slug);
    });
});

describe('resolveTranslationTarget', () => {
    test('news coordinates win, and carry their English source with them', () => {
        const target = T.resolveTranslationTarget({
            id: '1234567890', lang: 'hi-IN', newsDate: DAY, newsSlug: SLUG,
        });
        expect(target).toEqual({
            kind: 'news',
            lang: 'hi-IN',
            key: `news/2026/07/31/hi-IN/${SLUG}/article.md`,
            sourceKey: `news/2026/07/31/${SLUG}/article.md`,
        });
    });

    test('a published bundle resolves from its id alone — no coordinates needed', () => {
        expect(T.resolveTranslationTarget({ id: 'covenant-identity__the-name-of-god', lang: 'ar-EG' }))
            .toEqual({
                kind: 'article',
                lang: 'ar-EG',
                key: 'articles/covenant-identity/ar-EG/the-name-of-god.md',
                sourceKey: 'articles/covenant-identity/the-name-of-god.md',
            });
    });

    // Everything below stays on the PostgreSQL cache. Returning null rather than
    // throwing is the contract: a request must not 500 because a caller sent
    // junk, it must simply lose the CDN leg.
    test.each([
        ['a backend serial', { id: '4821', lang: 'hi-IN' }],
        ['a UUID', { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', lang: 'hi-IN' }],
        ['English', { id: 'covenant-identity__x', lang: 'en-US' }],
        ['an unknown language', { id: 'covenant-identity__x', lang: 'xx-XX' }],
        ['a forged news slug', { lang: 'hi-IN', newsDate: DAY, newsSlug: '../../' }],
        ['a forged news date', { lang: 'hi-IN', newsDate: '../..', newsSlug: SLUG }],
        ['a traversal language', { id: 'covenant-identity__x', lang: '../../etc' }],
        ['nothing at all', {}],
        ['undefined', undefined],
    ])('%s resolves to null without throwing', (_label, input) => {
        expect(T.resolveTranslationTarget(input)).toBeNull();
    });
});

describe('the stored file', () => {
    const base = {
        lang: 'hi-IN',
        kind: 'news',
        sourceKey: `news/2026/07/31/${SLUG}/article.md`,
        sourceHash: 'a1b2c3',
        sourceObject: 'sha256:d4e5f6',
        title: 'अदालत ने चर्च ज़ोनिंग पर फैसला सुनाया',
        sourceBadge: 'रॉयटर्स',
        category: 'विश्वास',
        isRtl: false,
        model: 'claude-haiku-4-5-20251001',
        content: 'पहला अनुच्छेद।\n\nदूसरा अनुच्छेद।',
        translatedAt: '2026-07-31T18:04:11.221Z',
    };

    test('render and parse round-trip', () => {
        const parsed = T.parseTranslationMarkdown(T.renderTranslationMarkdown(base));
        expect(parsed.fm.lang).toBe('hi-IN');
        expect(parsed.fm.title).toBe(base.title);
        expect(parsed.fm.source_hash).toBe('a1b2c3');
        expect(parsed.fm.source_object).toBe('sha256:d4e5f6');
        expect(parsed.content).toBe(base.content);
    });

    test('quotes and backslashes in a title survive the round trip', () => {
        const messy = { ...base, title: 'He said "no" \\ then left' };
        const parsed = T.parseTranslationMarkdown(T.renderTranslationMarkdown(messy));
        expect(parsed.fm.title).toBe('He said "no" \\ then left');
    });

    test('a newline in a title is flattened rather than breaking the block', () => {
        const messy = { ...base, title: 'Line one\nline two' };
        const md = T.renderTranslationMarkdown(messy);
        for (const line of md.split('---')[1].split('\n').filter(Boolean)) {
            expect(line).toMatch(/^[a-z_]+: /);
        }
        expect(T.parseTranslationMarkdown(md).fm.title).toBe('Line one line two');
    });

    test('no frontmatter value starts with [ or { — the parsers skip those', () => {
        const md = T.renderTranslationMarkdown({ ...base, title: '[bracketed]', category: '{braced}' });
        for (const line of md.split('---')[1].split('\n').filter(Boolean)) {
            const value = line.slice(line.indexOf(': ') + 2).trim();
            expect(value.startsWith('[')).toBe(false);
            expect(value.startsWith('{')).toBe(false);
        }
    });

    test('a body containing its own rule is not mistaken for the frontmatter', () => {
        const withRule = { ...base, content: 'Opening line.\n\n---\n\nClosing line.' };
        expect(T.parseTranslationMarkdown(T.renderTranslationMarkdown(withRule)).content)
            .toBe(withRule.content);
    });

    // '"false"' is truthy, and an LTR article rendered right-to-left is not
    // merely wrong, it is unreadable.
    test('is_rtl comes back as a boolean, both ways round', () => {
        expect(T.parseTranslationMarkdown(T.renderTranslationMarkdown(base)).isRtl).toBe(false);
        expect(T.parseTranslationMarkdown(
            T.renderTranslationMarkdown({ ...base, lang: 'ar-EG', isRtl: true }),
        ).isRtl).toBe(true);
    });

    // A truncated or hand-mangled object must read as a miss, so the reader gets
    // a fresh translation rather than a blank article.
    test.each([
        ['no frontmatter', 'just a body'],
        ['an unterminated block', '---\nlang: hi-IN\nstill going'],
        ['frontmatter but no body', '---\nlang: hi-IN\n---\n\n'],
        ['nothing', ''],
        ['not a string', null],
    ])('%s parses as a miss', (_label, raw) => {
        expect(T.parseTranslationMarkdown(raw)).toBeNull();
    });
});

describe('the module never reaches R2 without credentials', () => {
    // Guarded so a dev box with no R2 keys does zero network work and the
    // translation path behaves exactly as it did before this feature existed.
    const configured = C.isConfigured();

    test('readTranslation answers null rather than throwing', async () => {
        if (configured) return; // an integration concern, not a unit one
        await expect(T.readTranslation({ key: 'news/x/article.md', lang: 'hi-IN' }))
            .resolves.toBeNull();
    });

    test('readTranslation with no target is a miss', async () => {
        await expect(T.readTranslation(null)).resolves.toBeNull();
    });
});

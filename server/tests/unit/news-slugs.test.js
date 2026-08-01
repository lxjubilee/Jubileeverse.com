'use strict';
/**
 * Slug identity and image isolation.
 *
 * Two guarantees are enforced here, both of which were violated in a real run:
 *   1. A story keeps ONE folder, no matter how its headline is re-worded.
 *   2. No two articles can ever share an image, because image ids derive from
 *      the article id, which derives from the slug.
 */

const News = require('../../lib/r2-news');
const Images = require('../../lib/news-images');
const R2 = require('../../lib/r2-client');

const DAY = R2.dateFromPstString('2026-07-31');

describe('newsSlugify — SEO shape', () => {
    test('drops apostrophes rather than turning them into separators', () => {
        expect(News.newsSlugify("Seoul's Chip Stocks Jump 18%"))
            .toBe('seouls-chip-stocks-jump-18-percent');
    });

    test('truncates on a word boundary, never mid-word', () => {
        // The live run produced "...keep-the-lights-on-until-decem".
        const slug = News.newsSlugify('Senators Near a Funding Deal That Would Keep the Lights On Until December');
        expect(slug.length).toBeLessThanOrEqual(70);
        expect(slug.endsWith('-')).toBe(false);
        expect(slug).not.toMatch(/decem$/);
        for (const word of slug.split('-')) {
            expect('senators near a funding deal that would keep the lights on until december'.split(' '))
                .toContain(word);
        }
    });

    test('expands & and % into words search engines can read', () => {
        expect(News.newsSlugify('Faith & Freedom Up 22%')).toBe('faith-and-freedom-up-22-percent');
    });

    test('is lowercase, hyphenated, and free of stray separators', () => {
        for (const title of [
            '  Leading and trailing  ',
            'Punctuation!!! Everywhere??? Yes...',
            '“Smart quotes” and — dashes',
            'MiXeD CaSe TiTlE',
        ]) {
            const slug = News.newsSlugify(title);
            expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        }
    });

    test('never returns an empty slug', () => {
        for (const title of ['', '   ', '!!!', null, undefined]) {
            expect(News.newsSlugify(title)).toBe('article');
        }
    });
});

describe('claimNewsSlug — one story, one folder', () => {
    const HASH_A = 'a'.repeat(64);
    const HASH_B = 'b'.repeat(64);

    test('a re-worded headline reuses the folder the story already owns', () => {
        // This is the exact failure seen live: the same Deadline story was
        // re-composed as "A Biopic Sends Old Songs Viral..." and then as
        // "An Old Catalog Goes Viral...", producing two folders.
        const claims = News.readSlugClaims({
            articles: [{ slug: 'an-old-catalog-goes-viral-and-sony-music-sales-jump-22', content_hash: HASH_A }],
        });
        const slug = News.claimNewsSlug('A Biopic Sends Old Songs Viral and Lifts Sony Music Sales 22%', HASH_A, claims);
        expect(slug).toBe('an-old-catalog-goes-viral-and-sony-music-sales-jump-22');
    });

    test('a genuinely different story with the same headline gets its own slug', () => {
        const claims = News.readSlugClaims({
            articles: [{ slug: 'court-rules-on-zoning', content_hash: HASH_A }],
        });
        const slug = News.claimNewsSlug('Court Rules on Zoning', HASH_B, claims);
        expect(slug).not.toBe('court-rules-on-zoning');
        expect(slug.length).toBeLessThanOrEqual(70);
    });

    test('disambiguation is deterministic across runs', () => {
        const make = () => News.readSlugClaims({
            articles: [{ slug: 'court-rules-on-zoning', content_hash: HASH_A }],
        });
        expect(News.claimNewsSlug('Court Rules on Zoning', HASH_B, make()))
            .toBe(News.claimNewsSlug('Court Rules on Zoning', HASH_B, make()));
    });

    test('an unseen story on an empty day gets the plain slug', () => {
        expect(News.claimNewsSlug('Court Rules on Zoning', HASH_A, News.readSlugClaims(null)))
            .toBe('court-rules-on-zoning');
    });

    test('a whole run of same-titled stories still yields unique slugs', () => {
        const claims = { byHash: new Map(), bySlug: new Map() };
        const slugs = [];
        for (let i = 0; i < 25; i++) {
            const hash = String(i).padStart(64, '0');
            const slug = News.claimNewsSlug('Breaking News Today', hash, claims);
            claims.bySlug.set(slug, hash);
            claims.byHash.set(hash, slug);
            slugs.push(slug);
        }
        expect(new Set(slugs).size).toBe(25);
    });

    test('re-running that whole set reproduces the same slugs', () => {
        const run = () => {
            const claims = { byHash: new Map(), bySlug: new Map() };
            return Array.from({ length: 10 }, (_, i) => {
                const hash = String(i).padStart(64, '0');
                const slug = News.claimNewsSlug('Breaking News Today', hash, claims);
                claims.bySlug.set(slug, hash);
                claims.byHash.set(hash, slug);
                return slug;
            });
        };
        expect(run()).toEqual(run());
    });
});

describe('images are never shared between articles', () => {
    test('30 articles yield 90 distinct image ids', () => {
        const ids = [];
        for (let a = 0; a < 30; a++) {
            const articleId = `2026-07-31__story-number-${a}`;
            for (let n = 1; n <= Images.IMAGES_PER_ARTICLE; n++) {
                ids.push(Images.mintImageId(articleId, n));
            }
        }
        expect(ids).toHaveLength(90);
        expect(new Set(ids).size).toBe(90);
    });

    test('two articles with near-identical slugs still get distinct images', () => {
        const a = Images.mintImageId('2026-07-31__court-rules-on-zoning', 1);
        const b = Images.mintImageId('2026-07-31__court-rules-on-zoning-2', 1);
        expect(a).not.toBe(b);
    });

    test('the same article on two different days gets distinct images', () => {
        expect(Images.mintImageId('2026-07-31__same-slug', 1))
            .not.toBe(Images.mintImageId('2026-08-01__same-slug', 1));
    });

    test('image keys live under their own article folder', () => {
        const article = { slug: 'court-rules-on-zoning' };
        const id = Images.mintImageId('2026-07-31__court-rules-on-zoning', 1);
        expect(News.buildNewsImageKey(article, id, DAY))
            .toBe(`news/2026/07/31/court-rules-on-zoning/images/${id}.webp`);
    });

    test('a full simulated day has no key collisions of any kind', () => {
        const claims = { byHash: new Map(), bySlug: new Map() };
        const keys = new Set();
        for (let i = 0; i < 30; i++) {
            const hash = String(i).padStart(64, '0');
            // Deliberately repetitive titles: the worst realistic case.
            const slug = News.claimNewsSlug(`Senate Advances Funding Bill ${i % 3}`, hash, claims);
            claims.bySlug.set(slug, hash);
            claims.byHash.set(hash, slug);

            const articleId = `2026-07-31__${slug}`;
            keys.add(News.buildNewsArticleKey({ slug }, DAY));
            for (let n = 1; n <= 3; n++) {
                keys.add(News.buildNewsImageKey({ slug }, Images.mintImageId(articleId, n), DAY));
            }
        }
        // 30 markdown + 90 images, all distinct.
        expect(keys.size).toBe(120);
    });
});

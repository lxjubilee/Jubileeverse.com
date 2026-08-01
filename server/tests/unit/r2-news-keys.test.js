'use strict';
/**
 * Key shapes and the PST day boundary for the daily news pipeline.
 *
 * These are pinned against fixed dates on purpose. The R2 layout is a published
 * contract — the site reads it off the CDN — so a key shape changing silently
 * would orphan every article already stored under the old shape.
 */

const N = require('../../lib/r2-news');
const C = require('../../lib/r2-client');

const DAY = C.dateFromPstString('2026-07-31');
const ARTICLE = { slug: 'federal-court-rules-on-church-zoning' };

describe('PST day boundary', () => {
    test('a UTC timestamp past midnight still belongs to the previous PST day', () => {
        // 05:30Z on Aug 1 is 22:30 on Jul 31 in Los Angeles (UTC-7 in summer).
        expect(C.pstDateString(new Date('2026-08-01T05:30:00Z'))).toBe('2026-07-31');
    });

    test('the day rolls over once PST midnight actually passes', () => {
        expect(C.pstDateString(new Date('2026-08-01T07:30:00Z'))).toBe('2026-08-01');
    });

    test('winter dates land correctly under UTC-8', () => {
        expect(C.pstDateString(new Date('2026-01-15T06:30:00Z'))).toBe('2026-01-14');
        expect(C.pstDateString(new Date('2026-01-15T08:30:00Z'))).toBe('2026-01-15');
    });

    test('dateFromPstString round-trips in both seasons', () => {
        for (const day of ['2026-07-31', '2026-01-15', '2026-03-08', '2026-11-01']) {
            expect(C.pstDateString(C.dateFromPstString(day))).toBe(day);
        }
    });

    test('dateFromPstString rejects a malformed date', () => {
        expect(() => C.dateFromPstString('07/31/2026')).toThrow(/YYYY-MM-DD/);
    });
});

describe('key shapes', () => {
    test('day prefix', () => {
        expect(N.newsDayPrefix(DAY)).toBe('news/2026/07/31/');
    });

    test('article markdown key', () => {
        expect(N.buildNewsArticleKey(ARTICLE, DAY))
            .toBe('news/2026/07/31/federal-court-rules-on-church-zoning/article.md');
    });

    test('image key uses a bare 12-char id, no ordinal', () => {
        expect(N.buildNewsImageKey(ARTICLE, 'aB3xK9mQ2pLz', DAY))
            .toBe('news/2026/07/31/federal-court-rules-on-church-zoning/images/aB3xK9mQ2pLz.webp');
    });

    test('legacy .png keys can still be addressed for migration', () => {
        expect(N.buildNewsImageKey(ARTICLE, 'aB3xK9mQ2pLz', DAY, 'png'))
            .toMatch(/aB3xK9mQ2pLz\.png$/);
    });

    test('day index key', () => {
        expect(N.buildNewsDayIndexKey(DAY)).toBe('news/2026/07/31/index.json');
    });

    test('article id is a single path segment', () => {
        const id = N.buildNewsArticleId(ARTICLE, DAY);
        expect(id).toBe('2026-07-31__federal-court-rules-on-church-zoning');
        expect(id).not.toContain('/');
    });
});

describe('image id validation', () => {
    test.each(['01', '1', 'aB3xK9mQ2p_z', 'aB3xK9mQ2pL', 'aB3xK9mQ2pLzz', '', null])(
        'rejects %p',
        (bad) => {
            expect(() => N.buildNewsImageKey(ARTICLE, bad, DAY)).toThrow(/12/);
        },
    );

    test.each(['aB3xK9mQ2pLz', '000000000000', 'ZZZZZZZZZZZZ', '7fRt4WnJ0cVe'])(
        'accepts %p',
        (good) => {
            expect(N.buildNewsImageKey(ARTICLE, good, DAY)).toContain(`/${good}.webp`);
        },
    );
});

describe('slug collision resolution', () => {
    test('is deterministic — a re-run picks the same folder', () => {
        const taken = new Map([['church-zoning', 'hash-AAA']]);
        const first = N.newsSlug('Church Zoning', 'hash-BBB', taken);
        const second = N.newsSlug('Church Zoning', 'hash-BBB', taken);
        expect(first).toBe(second);
        expect(first).not.toBe('church-zoning');
    });

    test('the story that already owns the slug keeps it', () => {
        const taken = new Map([['church-zoning', 'hash-AAA']]);
        expect(N.newsSlug('Church Zoning', 'hash-AAA', taken)).toBe('church-zoning');
    });

    test('an unclaimed headline gets the plain slug', () => {
        expect(N.newsSlug('Church Zoning', 'hash-AAA', new Map())).toBe('church-zoning');
    });
});

describe('markdown rendering', () => {
    const base = {
        slug: 'church-zoning-ruling',
        title: 'Federal Court Rules on Church Zoning',
        topic: 'church-us',
        source_name: 'Christianity Today',
        source_url: 'https://example.org/story',
        summary: 'A one-line summary.',
        marketing_summary: 'Shareable line.',
        introduction: 'Intro text.',
        body: 'Body text.',
        faith_relevance_analysis: 'Analysis text.',
        status: 'published',
    };

    const img = (n, id) => ({
        n,
        url: `https://cdn.jubileeverse.com/news/2026/07/31/church-zoning-ruling/images/${id}.webp`,
    });

    test('references only images that were actually supplied', () => {
        const { markdown } = N.buildNewsMarkdown(base, { images: [img(1, 'aB3xK9mQ2pLz')], date: DAY });
        expect(markdown).toContain('aB3xK9mQ2pLz.webp');
        expect((markdown.match(/!\[/g) || []).length).toBe(1);
    });

    test('emits no image links at all when none are confirmed', () => {
        const { markdown } = N.buildNewsMarkdown(base, { images: [], date: DAY });
        expect(markdown).not.toContain('![');
        expect(markdown).toContain('image_file: \n');
    });

    test('image URLs are absolute so they resolve off the CDN', () => {
        const { markdown } = N.buildNewsMarkdown(base, {
            images: [img(1, 'aB3xK9mQ2pLz'), img(2, '7fRt4WnJ0cVe'), img(3, 'Xq8dH2sYb6Nk')],
            date: DAY,
        });
        for (const m of markdown.match(/!\[[^\]]*\]\(([^)]+)\)/g) || []) {
            expect(m).toContain('https://cdn.jubileeverse.com/');
        }
    });

    test('the writer byline is the newsroom, not a persona', () => {
        const { markdown } = N.buildNewsMarkdown(base, { date: DAY });
        expect(markdown).toContain('**Writer:** JubileeVerse Newsroom');
    });

    test('every frontmatter value stays on one line', () => {
        const messy = {
            ...base,
            title: 'Line one\nline two',
            summary: 'Has: a colon, "quotes", and\na newline',
        };
        const { markdown } = N.buildNewsMarkdown(messy, { date: DAY });
        const fm = markdown.split('---')[1];
        for (const line of fm.split('\n').filter(Boolean)) {
            expect(line).toMatch(/^[a-z_]+: /);
        }
    });

    test('no frontmatter value starts with [ or { — the parsers skip those', () => {
        const { markdown } = N.buildNewsMarkdown(base, { date: DAY });
        const fm = markdown.split('---')[1];
        for (const line of fm.split('\n').filter(Boolean)) {
            const value = line.slice(line.indexOf(': ') + 2).trim();
            expect(value.startsWith('[')).toBe(false);
            expect(value.startsWith('{')).toBe(false);
        }
    });
});

describe('manifest entry', () => {
    const base = { slug: 'church-zoning-ruling', title: 'T', status: 'published' };
    const img = (n, id) => ({
        n,
        role: ['', 'hero', 'supporting', 'symbolic'][n],
        url: `https://cdn.jubileeverse.com/news/2026/07/31/church-zoning-ruling/images/${id}.webp`,
    });

    test('carries both the singular hero and the images array', () => {
        const e = N.buildIndexEntry(base, {
            images: [img(1, 'aB3xK9mQ2pLz'), img(2, '7fRt4WnJ0cVe'), img(3, 'Xq8dH2sYb6Nk')],
            date: DAY,
        });
        expect(e.image_file).toBe('church-zoning-ruling/images/aB3xK9mQ2pLz.webp');
        expect(e.images).toHaveLength(3);
        expect(e.images.map(i => i.n)).toEqual([1, 2, 3]);
        expect(e.image_status).toBe('generated');
        expect(e.status).toBe('published');
    });

    test('partial image sets are flagged, not hidden', () => {
        const e = N.buildIndexEntry(base, { images: [img(1, 'aB3xK9mQ2pLz')], date: DAY });
        expect(e.image_status).toBe('partial');
        expect(e.status).toBe('published');
    });

    test('an imageless article is held back as a draft', () => {
        const e = N.buildIndexEntry(base, { images: [], date: DAY });
        expect(e.image_status).toBe('pending');
        expect(e.image_file).toBe('');
        expect(e.status).toBe('draft');
    });

    test('image 2 is promoted to hero when image 1 never landed', () => {
        const e = N.buildIndexEntry(base, { images: [img(2, '7fRt4WnJ0cVe')], date: DAY });
        expect(e.image_file).toBe('church-zoning-ruling/images/7fRt4WnJ0cVe.webp');
        expect(e.status).toBe('published');
    });
});

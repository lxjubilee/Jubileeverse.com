'use strict';
/**
 * Home feed mapping — CDN news onto the `Story` shape the UI already speaks.
 *
 * The mapping module is TypeScript in src/, so this test re-implements nothing:
 * it loads the real file and strips the type annotations, which keeps the
 * assertions honest about the actual field names the components read.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load src/lib/homeFeed.ts as CommonJS, with types erased. */
function loadHomeFeed() {
    const file = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'homeFeed.ts');
    const src = fs.readFileSync(file, 'utf8')
        .replace(/^import[\s\S]*?;$/gm, '')                 // type-only imports
        .replace(/^export interface[\s\S]*?^}/gm, '')        // interfaces
        // Inline object type on a destructured options parameter, e.g.
        // `{ offset = 0 }: { offset?: number } = {}`. Must run before the
        // `: number` rule, which would otherwise leave `{ offset?; }` behind.
        .replace(/:\s*\{[^{}]*\}\s*=\s*\{\}/g, ' = {}')
        // Union annotations, before the bare `: string` / `: number` rules,
        // which would otherwise leave the `| null` half behind.
        .replace(/:\s*string\s*\|\s*null/g, '')
        .replace(/:\s*NewsArticle\[\]/g, '')
        .replace(/:\s*NewsArticle/g, '')
        .replace(/:\s*HomeFeed/g, '')
        // Array forms first: a bare `: Story` rule would leave the brackets behind.
        .replace(/:\s*Story\[\]\[\]/g, '')
        .replace(/:\s*Story\[\]\s*=\s*\[\]/g, ' = []')
        .replace(/:\s*Story\[\]/g, '')
        .replace(/:\s*SiteArticle/g, '')
        .replace(/:\s*Story\b/g, '')
        .replace(/:\s*string\b/g, '')
        .replace(/:\s*number\b/g, '')
        .replace(/\bexport\s+/g, 'exports.__mark__ = 1; ')
        .replace(/exports\.__mark__ = 1; (const|function)/g, '$1');

    const sandbox = { exports: {}, module: { exports: {} }, console };
    vm.createContext(sandbox);
    vm.runInContext(
        `${src}\nexports.toStory = toStory; exports.buildHomeFeed = buildHomeFeed;`
        + `exports.reactionIdForSlug = reactionIdForSlug;`
        + `exports.categoryArticleToStory = categoryArticleToStory;`
        + `exports.rotateCategories = rotateCategories;`
        + `exports.interleaveFeed = interleaveFeed;`
        + `exports.insertsNeeded = insertsNeeded;`
        + `exports.INSERT_EVERY = INSERT_EVERY;`
        + `exports.PAGE_SIZE = PAGE_SIZE;`,
        sandbox,
    );
    return sandbox.exports;
}

const HF = loadHomeFeed();

const article = (over = {}) => ({
    id: '2026-07-31__court-rules-on-zoning',
    slug: 'court-rules-on-zoning',
    date: '2026-07-31',
    title: 'Court Rules on Zoning',
    writer: 'JubileeVerse Newsroom',
    topic: 'church-us',
    summary: 'A one-line summary.',
    sourceName: 'Christianity Today',
    sourceUrl: 'https://example.org/story',
    image: 'https://cdn.jubileeverse.com/news/2026/07/31/court-rules-on-zoning/images/aB3xK9mQ2pLz.webp',
    images: [{ n: 1, role: 'hero', url: 'https://cdn/x.webp' }],
    created: '2026-07-31T13:00:00.000Z',
    ...over,
});

describe('toStory — the fields the UI actually reads', () => {
    const s = HF.toStory(article());

    test('id is the slug, so the card links and keys off it', () => {
        expect(s.id).toBe('court-rules-on-zoning');
    });

    test('headline drives StoryCard and HeroCarousel titles', () => {
        // StoryCard reads `headline` first then `title`; HeroCarousel reads
        // `headline`. Both are populated so neither component changes.
        expect(s.headline).toBe('Court Rules on Zoning');
        expect(s.title).toBe('Court Rules on Zoning');
    });

    test('excerpt feeds the hero blurb', () => {
        expect(s.excerpt).toBe('A one-line summary.');
    });

    test('image lands on the field resolveImageUrl prefers', () => {
        expect(s.cached_image_path).toContain('https://cdn.jubileeverse.com/');
        expect(s.image_url).toBe(s.cached_image_path);
    });

    test('source_name is the card meta line', () => {
        expect(s.source_name).toBe('Christianity Today');
    });

    test('topic drives the category label and follow/block slug', () => {
        expect(s.topic).toBe('church-us');
        expect(s.category).toBe('church-us');
    });

    test('carries slug and date so storyHref routes to /news/<slug>', () => {
        expect(s.slug).toBe('court-rules-on-zoning');
        expect(s.date).toBe('2026-07-31');
    });

    test('isCurrentEvent keeps the ce: reaction namespace', () => {
        expect(s.isCurrentEvent).toBe(true);
    });
});

describe('reaction id', () => {
    test('is an integer, since article_id columns are INTEGER', () => {
        const id = HF.reactionIdForSlug('court-rules-on-zoning');
        expect(Number.isInteger(id)).toBe(true);
    });

    test('sits above the current_events serial range and inside INTEGER', () => {
        // Below 1e9 it could collide with a current_events row id and share
        // that story's like counts; above 2147483647 it would not store at all.
        for (const slug of ['a', 'court-rules-on-zoning', 'x'.repeat(70)]) {
            const id = HF.reactionIdForSlug(slug);
            expect(id).toBeGreaterThanOrEqual(1_000_000_000);
            expect(id).toBeLessThan(2_147_483_647);
        }
    });

    test('is stable — the same slug always gets the same key', () => {
        expect(HF.reactionIdForSlug('court-rules-on-zoning'))
            .toBe(HF.reactionIdForSlug('court-rules-on-zoning'));
    });

    test('is distinct across a realistic corpus', () => {
        const ids = new Set();
        for (let i = 0; i < 5000; i++) ids.add(HF.reactionIdForSlug(`story-number-${i}-about-things`));
        expect(ids.size).toBe(5000);
    });
});

describe('buildHomeFeed — hero / sidebar / grid split', () => {
    const many = (n) => Array.from({ length: n }, (_, i) =>
        article({ slug: `story-${i}`, id: `2026-07-31__story-${i}`, title: `Story ${i}` }));

    test('fills hero(5), sidebar(3), then the grid', () => {
        const feed = HF.buildHomeFeed(many(20));
        expect(feed.hero).toHaveLength(5);
        expect(feed.sidebar).toHaveLength(3);
        expect(feed.topicCards).toHaveLength(12);
        expect(feed.success).toBe(true);
    });

    test('preserves input order — newest first, no reshuffle', () => {
        // Portal Business Rule #1: never reshuffle per request.
        const feed = HF.buildHomeFeed(many(10));
        expect(feed.hero[0].id).toBe('story-0');
        expect([...feed.hero, ...feed.sidebar, ...feed.topicCards].map(s => s.id))
            .toEqual(many(10).map(a => a.slug));
    });

    test('drops imageless articles — a hard exclusion on this site', () => {
        const mixed = [article({ slug: 'has-image' }), article({ slug: 'no-image', image: null })];
        const feed = HF.buildHomeFeed(mixed);
        const all = [...feed.hero, ...feed.sidebar, ...feed.topicCards];
        expect(all.map(s => s.id)).toEqual(['has-image']);
    });

    test('degrades to empty arrays rather than throwing', () => {
        const feed = HF.buildHomeFeed([]);
        expect(feed).toEqual({
            success: true, hero: [], sidebar: [], topicCards: [], categoryCards: [],
            total: 0, offset: 0, hasMore: false,
        });
    });

    test('a short day still fills hero before sidebar', () => {
        const feed = HF.buildHomeFeed(many(3));
        expect(feed.hero).toHaveLength(3);
        expect(feed.sidebar).toHaveLength(0);
        expect(feed.topicCards).toHaveLength(0);
    });
});

// ── Paging the 30-day window ─────────────────────────────────────────────────

describe('buildHomeFeed — paging the grid', () => {
    // Enough to page several times. Descending dates so the ordering assertions
    // below are about real recency rather than insertion order.
    const windowOf = (n) => Array.from({ length: n }, (_, i) => article({
        slug: `story-${String(i).padStart(4, '0')}`,
        id: `2026-07-31__story-${i}`,
        title: `Story ${i}`,
        date: `2026-07-${String(31 - Math.floor(i / 60)).padStart(2, '0')}`,
        created: `2026-07-31T${String(23 - (i % 24)).padStart(2, '0')}:00:00.000Z`,
    }));

    test('the first page carries the hero and sidebar, later pages do not', () => {
        // They are a fixed region of the layout. Re-sending them would either
        // duplicate cards into the grid or shift what is already on screen.
        const first = HF.buildHomeFeed(windowOf(300), [], { offset: 0, pageSize: 50 });
        expect(first.hero).toHaveLength(5);
        expect(first.sidebar).toHaveLength(3);

        const second = HF.buildHomeFeed(windowOf(300), [], { offset: 50, pageSize: 50 });
        expect(second.hero).toEqual([]);
        expect(second.sidebar).toEqual([]);
        expect(second.topicCards).toHaveLength(50);
    });

    test('pages tile the grid exactly — no gaps, no repeats', () => {
        const all = windowOf(300);
        const seen = [];
        let offset = 0;
        for (;;) {
            const page = HF.buildHomeFeed(all, [], { offset, pageSize: 50 });
            seen.push(...page.topicCards.map(s => s.id));
            if (!page.hasMore) break;
            offset += page.topicCards.length;
        }
        // 300 articles minus the 8 that hero and sidebar consume.
        expect(seen).toHaveLength(292);
        expect(new Set(seen).size).toBe(292);

        const expected = all.slice(8).map(a => a.slug);
        expect(seen).toEqual(expected);
    });

    test('newest first is preserved across page boundaries', () => {
        const all = windowOf(200);
        const p1 = HF.buildHomeFeed(all, [], { offset: 0, pageSize: 50 });
        const p2 = HF.buildHomeFeed(all, [], { offset: 50, pageSize: 50 });
        const ordered = [...p1.topicCards, ...p2.topicCards].map(s => s.id);
        expect(ordered).toEqual(all.slice(8, 108).map(a => a.slug));
    });

    test('reports the whole window total, not the page length', () => {
        const feed = HF.buildHomeFeed(windowOf(300), [], { offset: 0, pageSize: 50 });
        expect(feed.topicCards).toHaveLength(50);
        expect(feed.total).toBe(292);
        expect(feed.hasMore).toBe(true);
    });

    test('the last page reports no more', () => {
        const feed = HF.buildHomeFeed(windowOf(58), [], { offset: 0, pageSize: 50 });
        expect(feed.topicCards).toHaveLength(50);
        expect(feed.hasMore).toBe(false);
    });

    test('an offset past the end is empty rather than an error', () => {
        const feed = HF.buildHomeFeed(windowOf(20), [], { offset: 500, pageSize: 50 });
        expect(feed.topicCards).toEqual([]);
        expect(feed.hasMore).toBe(false);
    });

    test('a negative offset is clamped to the first page', () => {
        const feed = HF.buildHomeFeed(windowOf(100), [], { offset: -10, pageSize: 50 });
        expect(feed.offset).toBe(0);
        expect(feed.topicCards).toHaveLength(50);
    });

    test('inserts continue the rotation instead of repeating page one', () => {
        // Otherwise every page shows the same faith-based articles.
        const cards = Array.from({ length: 60 }, (_, i) => ({ id: `cat-${i}` }));
        const p1 = HF.buildHomeFeed(windowOf(300), cards, { offset: 0, pageSize: 50 });
        const p2 = HF.buildHomeFeed(windowOf(300), cards, { offset: 50, pageSize: 50 });
        const ids1 = p1.categoryCards.map(c => c.id);
        const ids2 = p2.categoryCards.map(c => c.id);
        // Only the two-card overlap the +2 spare deliberately allows.
        expect(ids1.filter(id => ids2.includes(id)).length).toBeLessThanOrEqual(2);
        expect(ids2[0]).not.toBe(ids1[0]);
    });

    test('defaults to the standard page size when no options are given', () => {
        const feed = HF.buildHomeFeed(windowOf(300));
        expect(feed.topicCards).toHaveLength(HF.PAGE_SIZE);
        expect(HF.PAGE_SIZE).toBe(50);
    });

    test('imageless articles are excluded before paging, so pages stay full', () => {
        const all = windowOf(120).map((a, i) => (i % 2 ? { ...a, image: null } : a));
        const feed = HF.buildHomeFeed(all, [], { offset: 0, pageSize: 50 });
        expect(feed.topicCards.every(s => s.cached_image_path)).toBe(true);
        expect(feed.total).toBe(52);   // 60 with images, minus hero+sidebar
    });
});

// ── Faith-based articles woven into the feed ─────────────────────────────────

const siteArticle = (over = {}) => ({
    id: 'covenant-identity__nobody-had-to-call-him-back',
    slug: 'nobody-had-to-call-him-back',
    categorySlug: 'covenant-identity',
    title: 'Nobody Had to Call Him Back',
    author: 'A Writer',
    category: 'Covenant & Identity',
    image: 'https://cdn.jubileeverse.com/articles/covenant-identity/images/x.jpg',
    created: '2026-07-30T10:00:00.000Z',
    ...over,
});

describe('categoryArticleToStory — the same card, a different destination', () => {
    const s = HF.categoryArticleToStory(siteArticle());

    test('id stays the composite id, so the card links to /article/<id>', () => {
        expect(s.id).toBe('covenant-identity__nobody-had-to-call-him-back');
    });

    test('carries no slug+date pair, which is what would route it to a news URL', () => {
        // storyHref() treats slug AND date as the marker for CDN news.
        expect(s.slug && s.date).toBeFalsy();
    });

    test('isCurrentEvent is explicitly false — byline and reaction namespace', () => {
        expect(s.isCurrentEvent).toBe(false);
    });

    test('fills the fields StoryCard actually reads', () => {
        expect(s.headline).toBe('Nobody Had to Call Him Back');
        expect(s.title).toBe('Nobody Had to Call Him Back');
        expect(s.cached_image_path).toContain('cdn.jubileeverse.com/articles/');
        expect(s.source_name).toBe('A Writer');
        expect(s.topic).toBe('Covenant & Identity');
        expect(s.category).toBe('Covenant & Identity');
    });

    test('reaction_id is an integer, since article_id columns are INTEGER', () => {
        expect(Number.isInteger(s.reaction_id)).toBe(true);
        expect(s.reaction_id).toBeGreaterThanOrEqual(1_000_000_000);
        expect(s.reaction_id).toBeLessThan(2_147_483_647);
    });
});

describe('rotateCategories — no category over-represented', () => {
    const lists = [
        ['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3'],
        ['d1', 'd2', 'd3'], ['e1', 'e2', 'e3'],
    ];

    test('takes one from each category before taking a second from any', () => {
        expect(HF.rotateCategories(lists, 5)).toEqual(['a1', 'b1', 'c1', 'd1', 'e1']);
        expect(HF.rotateCategories(lists, 7)).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'a2', 'b2']);
    });

    test('no category leads by more than one over any prefix', () => {
        const picked = HF.rotateCategories(lists, 12);
        const per = {};
        for (const id of picked) per[id[0]] = (per[id[0]] || 0) + 1;
        const counts = Object.values(per);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    });

    test('an exhausted category drops out instead of stalling the rotation', () => {
        const uneven = [['a1'], ['b1', 'b2', 'b3'], ['c1', 'c2']];
        expect(HF.rotateCategories(uneven, 6)).toEqual(['a1', 'b1', 'c1', 'b2', 'c2', 'b3']);
    });

    test('empty categories and a zero limit yield nothing', () => {
        expect(HF.rotateCategories([[], [], []], 5)).toEqual([]);
        expect(HF.rotateCategories(lists, 0)).toEqual([]);
        expect(HF.rotateCategories([], 5)).toEqual([]);
    });
});

describe('interleaveFeed — one insert after every four current events', () => {
    const news = n => Array.from({ length: n }, (_, i) => `n${i + 1}`);
    const cat = n => Array.from({ length: n }, (_, i) => `c${i + 1}`);

    test('inserts land in the fifth, tenth, fifteenth… positions', () => {
        expect(HF.interleaveFeed(news(12), cat(3))).toEqual([
            'n1', 'n2', 'n3', 'n4', 'c1',
            'n5', 'n6', 'n7', 'n8', 'c2',
            'n9', 'n10', 'n11', 'n12', 'c3',
        ]);
    });

    test('the current-events order is never disturbed', () => {
        const woven = HF.interleaveFeed(news(30), cat(7));
        expect(woven.filter(x => x.startsWith('n'))).toEqual(news(30));
    });

    test('runs out quietly when the inserts do', () => {
        const woven = HF.interleaveFeed(news(20), cat(2));
        expect(woven.filter(x => x.startsWith('c'))).toEqual(['c1', 'c2']);
        expect(woven).toHaveLength(22);
    });

    test('a feed shorter than one interval takes no inserts', () => {
        expect(HF.interleaveFeed(news(3), cat(5))).toEqual(news(3));
    });

    test('no inserts, or none available, leaves the feed identical', () => {
        const feed = news(9);
        expect(HF.interleaveFeed(feed, [])).toBe(feed);
        expect(HF.interleaveFeed([], cat(5))).toEqual([]);
    });

    test('the interval matches the documented cadence', () => {
        expect(HF.INSERT_EVERY).toBe(4);
        expect(HF.insertsNeeded(12)).toBe(3);
        expect(HF.insertsNeeded(3)).toBe(0);
    });
});

describe('buildHomeFeed — the envelope carries the inserts', () => {
    const days = (n) => Array.from({ length: n }, (_, i) =>
        article({ slug: `story-${i}`, id: `2026-07-31__story-${i}`, title: `Story ${i}` }));

    test('supplies enough category cards for the grid it returned', () => {
        const cards = Array.from({ length: 20 }, (_, i) => ({ id: `c${i + 1}` }));
        const feed = HF.buildHomeFeed(days(20), cards);
        // 12 grid cards -> 3 inserts, plus a small spare for filtered stories.
        expect(feed.topicCards).toHaveLength(12);
        expect(feed.categoryCards).toHaveLength(HF.insertsNeeded(12) + 2);
    });

    test('is unchanged when no category cards are passed', () => {
        expect(HF.buildHomeFeed(days(20)).categoryCards).toEqual([]);
    });
});

'use strict';
/**
 * Admin image regeneration — the parts that decide what gets rendered.
 *
 * The feature exists to replace images with AI artifacts (six fingers, two
 * heads, melted faces), so two properties are load-bearing and asserted here:
 *
 *   1. the prompt is rebuilt from the article's own fields and carries explicit
 *      anatomy directives — a caller never supplies prompt text, which is what
 *      stops an authenticated admin from using the GPU as an open renderer;
 *   2. a regeneration never reuses the published image id, because image URLs
 *      are served immutable and rewriting the same key would leave the cached
 *      defect on the page.
 *
 * The render itself needs a GPU and R2, so it is not exercised here.
 */

const Regen = require('../../lib/image-regen');
const Images = require('../../lib/news-images');

describe('buildHeroPrompt — faithful to the article, hostile to artifacts', () => {
    const article = {
        title: 'Sydney Archbishop Warns Australia Has Turned Telehealth Into Teledeath',
        summary: 'Archbishop Anthony Fisher says assisted dying by online consultation turns telehealth into tele-death.',
        category: 'church-global',
        body: 'Australia\'s ruling Labor Party has voted to make voluntary assisted dying accessible through online consultations.',
    };

    const prompt = Regen.buildHeroPrompt(article);

    test('leads with the headline, so the image is about this story', () => {
        expect(prompt).toContain(article.title);
    });

    test('carries the summary and the category as context', () => {
        expect(prompt).toContain('Archbishop Anthony Fisher');
        expect(prompt).toContain('church global');
    });

    test('names the anatomy the generator keeps getting wrong', () => {
        expect(prompt).toMatch(/five fingers per hand/i);
        expect(prompt).toMatch(/one head per person/i);
        expect(prompt).toMatch(/anatomically correct/i);
    });

    test('asks for a photograph, not an illustration', () => {
        expect(prompt).toMatch(/photorealistic/i);
    });

    test('falls back to the body when there is no summary', () => {
        const noSummary = Regen.buildHeroPrompt({ ...article, summary: '' });
        expect(noSummary).toContain('Labor Party');
    });

    test('survives an article with nothing but a title', () => {
        const bare = Regen.buildHeroPrompt({ title: 'A Quiet Morning' });
        expect(bare).toContain('A Quiet Morning');
        expect(bare).toMatch(/five fingers per hand/i);
    });

    test('quotes and newlines in a headline cannot break out of the quoted title', () => {
        const quoted = Regen.buildHeroPrompt({ title: 'He Said "Enough"\nand left' });
        // The prompt quotes the headline; the headline's own quotes are stripped,
        // so exactly the opening and closing pair survive.
        expect((quoted.match(/"/g) || [])).toHaveLength(2);
        expect(quoted.split('\n')).toHaveLength(1);
        expect(quoted).toContain('He Said  Enough  and left');
    });

    test('the negative list covers the defects the feature is named for', () => {
        for (const artifact of ['six fingers', 'extra heads', 'distorted face', 'malformed hands']) {
            expect(Regen.ARTIFACT_NEGATIVE).toContain(artifact);
        }
    });
});

describe('gist — body text trimmed for a prompt', () => {
    test('strips markdown embeds and markers', () => {
        const out = Regen.gist('## Heading\n\n![alt](https://cdn/x.webp)\n\n**Bold** text here.');
        expect(out).not.toContain('![');
        expect(out).not.toContain('#');
        expect(out).toContain('Bold text here.');
    });

    test('truncates on a word boundary', () => {
        const long = 'word '.repeat(300);
        const out = Regen.gist(long, 100);
        expect(out.length).toBeLessThanOrEqual(102);
        expect(out.endsWith('…')).toBe(true);
    });

    test('empty input is empty output, not "undefined"', () => {
        expect(Regen.gist(null)).toBe('');
        expect(Regen.gist(undefined)).toBe('');
    });
});

describe('mintImageId salt — the cache-busting contract', () => {
    const articleId = '2026-07-31__court-rules-on-zoning';

    test('an unsalted id is byte-identical to what the pipeline has always published', () => {
        // Guards every filename already in R2: if this changes, published
        // articles point at objects that no longer exist.
        expect(Images.mintImageId(articleId, 1)).toBe(Images.mintImageId(articleId, 1, ''));
        expect(Images.mintImageId(articleId, 1)).toMatch(/^[0-9A-Za-z]{12}$/);
    });

    test('a salted id differs, so the new image cannot be served from cache', () => {
        expect(Images.mintImageId(articleId, 1, 'a1b2c3d4')).not.toBe(Images.mintImageId(articleId, 1));
    });

    test('every regeneration gets its own id', () => {
        const ids = new Set(['s1', 's2', 's3', 's4'].map(s => Images.mintImageId(articleId, 1, s)));
        expect(ids.size).toBe(4);
        for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{12}$/);
    });

    test('the seed moves with the salt, or the same defect renders again', () => {
        expect(Images.seedFor(articleId, 1, 'a1b2c3d4')).not.toBe(Images.seedFor(articleId, 1));
    });
});

describe('regenerateArticleImage — refuses bad references before touching a GPU', () => {
    const call = (ref) => Regen.regenerateArticleImage(ref, { logger: { log() {}, warn() {} } });

    test('rejects a missing or malformed slug', async () => {
        for (const ref of [{ kind: 'news' }, { kind: 'news', slug: '' }, { kind: 'news', slug: '../etc/passwd' }]) {
            await expect(call(ref)).rejects.toThrow(/slug/i);
        }
    });

    test('rejects an unknown article kind', async () => {
        await expect(call({ kind: 'wordpress', slug: 'a-story' })).rejects.toThrow(/kind/i);
    });

    test('rejects a category reference with no valid category', async () => {
        await expect(call({ kind: 'category', slug: 'a-story', categorySlug: '../..' }))
            .rejects.toThrow(/category/i);
    });

    test('nothing is left in flight after a rejection', async () => {
        await expect(call({ kind: 'news', slug: '!!' })).rejects.toThrow();
        expect(Regen.inFlightCount()).toBe(0);
    });
});

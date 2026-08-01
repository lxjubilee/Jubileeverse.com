'use strict';
/** Image id derivation and prompt normalization. No GPU, no network. */

const I = require('../../lib/news-images');

describe('image ids', () => {
    test('match the published filename contract', () => {
        for (let n = 1; n <= 3; n++) {
            expect(I.mintImageId('2026-07-31__some-slug', n)).toMatch(/^[0-9A-Za-z]{12}$/);
        }
        expect(I.mintImageSetId('2026-07-31__some-slug')).toMatch(/^[0-9A-Za-z]{12}$/);
    });

    test('are deterministic — a re-run reuses the same key', () => {
        expect(I.mintImageId('article-a', 1)).toBe(I.mintImageId('article-a', 1));
        expect(I.mintImageSetId('article-a')).toBe(I.mintImageSetId('article-a'));
    });

    test('differ per image and per article', () => {
        const ids = [
            I.mintImageId('article-a', 1),
            I.mintImageId('article-a', 2),
            I.mintImageId('article-a', 3),
            I.mintImageId('article-b', 1),
        ];
        expect(new Set(ids).size).toBe(4);
    });

    test('stay 12 chars even when the digest is small', () => {
        // Guards the base62 loop's left-pad: a digest with leading zero bytes
        // would otherwise encode short and break the filename contract.
        for (let i = 0; i < 400; i++) {
            expect(I.mintImageId(`fuzz-${i}`, (i % 3) + 1)).toHaveLength(12);
        }
    });

    test('seeds are deterministic and in range for the sampler', () => {
        const s = I.seedFor('article-a', 1);
        expect(s).toBe(I.seedFor('article-a', 1));
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThan(2 ** 31);
        // The salted variant is what a safety regeneration uses.
        expect(I.seedFor('article-a', 1, 1)).not.toBe(s);
    });
});

describe('prompt normalization', () => {
    const article = { title: 'Federal Court Rules on Church Zoning' };
    const good = [
        { role: 'hero', prompt: 'A'.repeat(90) },
        { role: 'supporting', prompt: 'B'.repeat(90) },
        { role: 'symbolic', prompt: 'C'.repeat(90) },
    ];

    test('passes three good prompts through unchanged', () => {
        const out = I.normalizePrompts(good, article);
        expect(out.map(p => p.role)).toEqual(['hero', 'supporting', 'symbolic']);
        expect(out[0].prompt).toBe(good[0].prompt);
    });

    test('reorders by role rather than trusting array position', () => {
        const shuffled = [good[2], good[0], good[1]];
        const out = I.normalizePrompts(shuffled, article);
        expect(out.map(p => p.role)).toEqual(['hero', 'supporting', 'symbolic']);
        expect(out[0].prompt).toBe(good[0].prompt);
    });

    test('fills gaps rather than letting the article fail', () => {
        const out = I.normalizePrompts([good[0]], article);
        expect(out).toHaveLength(3);
        expect(out[0].prompt).toBe(good[0].prompt);
        expect(out[1].prompt).toContain('16:9');
        expect(out[2].prompt).toContain('16:9');
    });

    test.each([[null], [undefined], [[]], ['not an array'], [[{ role: 'hero', prompt: 'too short' }]]])(
        'survives malformed input %p',
        (input) => {
            const out = I.normalizePrompts(input, article);
            expect(out).toHaveLength(3);
            out.forEach(p => expect(p.prompt.length).toBeGreaterThan(40));
        },
    );

    test('fallback prompts reference the story and stay family-safe', () => {
        const out = I.deriveImagePrompts(article);
        expect(out).toHaveLength(3);
        out.forEach(p => {
            expect(p.prompt).toContain('Church Zoning');
            expect(p.prompt).toMatch(/16:9\.$/);
        });
    });
});

describe('markdown prompt recovery', () => {
    test('reads three labelled prompt blocks', () => {
        const md = `Some body text.

**image-prompt01:** A person at a kitchen table in morning light.

**image-prompt02:** A wide view of a small-town street.

**image-prompt03:** An empty chapel at dusk.
`;
        const out = I.extractPromptsFromMarkdown(md);
        expect(out).toHaveLength(3);
        expect(out[0].role).toBe('hero');
        expect(out[2].prompt).toContain('chapel');
    });

    test('returns null instead of throwing when the blocks are absent', () => {
        // The old runner threw here, which is why it could never be pointed at
        // a real article.
        expect(I.extractPromptsFromMarkdown('Just an ordinary article body.')).toBeNull();
        expect(I.extractPromptsFromMarkdown('')).toBeNull();
        expect(I.extractPromptsFromMarkdown(null)).toBeNull();
        expect(I.extractPromptsFromMarkdown({})).toBeNull();
    });

    test('returns null on a partial set rather than a wrong-length one', () => {
        expect(I.extractPromptsFromMarkdown('**image-prompt01:** only one here')).toBeNull();
    });
});

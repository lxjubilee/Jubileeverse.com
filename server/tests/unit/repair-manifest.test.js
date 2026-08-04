'use strict';
/**
 * Matching stored image objects back to their display slots.
 *
 * This is the function a manifest rebuild leans on, and getting it wrong does
 * not fail loudly — it drops the article's images, which makes buildIndexEntry
 * force the article to draft, which removes it from the site. Two real defects
 * are pinned here:
 *
 *   1. An admin-regenerated hero is minted with a RANDOM salt (image-regen.js),
 *      so no deriver can ever reproduce its id. Bare derivation unpublished
 *      every regenerated article on the next --repair.
 *   2. Replacing a rendered image with the outlet's own photograph changes the
 *      id, so the same bug would have reverted the entire image migration —
 *      and --repair runs implicitly from --to-webp and --prune.
 */

const Images = require('../../lib/news-images');

const ARTICLE_ID = '2026-07-31__federal-court-rules-on-church-zoning';

const rendered = (n) => Images.mintImageId(ARTICLE_ID, n);
const sourced = (n) => Images.mintImageId(ARTICLE_ID, n, Images.SOURCED_SALT);

/** The shape repairManifest builds while walking the day prefix. */
const stored = (...ids) => new Map(ids.map(id => [id, 'webp']));

describe('imageIdFromFile', () => {
    test('reads the id out of a frontmatter image_file path', () => {
        expect(Images.imageIdFromFile('images/aB3xK9mQ2pLz.webp')).toBe('aB3xK9mQ2pLz');
    });

    test('accepts the legacy .png extension', () => {
        expect(Images.imageIdFromFile('images/aB3xK9mQ2pLz.png')).toBe('aB3xK9mQ2pLz');
    });

    test('rejects anything that is not the 12-char contract', () => {
        expect(Images.imageIdFromFile('images/hero.webp')).toBe('');
        expect(Images.imageIdFromFile('images/../../etc/passwd')).toBe('');
        expect(Images.imageIdFromFile('')).toBe('');
        expect(Images.imageIdFromFile(null)).toBe('');
    });
});

describe('matchStoredImages — derivation', () => {
    test('a full rendered set maps to slots 1..3 in order', () => {
        const out = Images.matchStoredImages(ARTICLE_ID, stored(rendered(1), rendered(2), rendered(3)));
        expect(out.map(i => i.n)).toEqual([1, 2, 3]);
        expect(out.map(i => i.id)).toEqual([rendered(1), rendered(2), rendered(3)]);
        expect(out.map(i => i.role)).toEqual(['hero', 'supporting', 'symbolic']);
    });

    test('ordering comes from the slot, not from the order objects were listed', () => {
        const out = Images.matchStoredImages(ARTICLE_ID, stored(rendered(3), rendered(1), rendered(2)));
        expect(out.map(i => i.n)).toEqual([1, 2, 3]);
    });

    test('a gap in the middle is preserved rather than closed up', () => {
        const out = Images.matchStoredImages(ARTICLE_ID, stored(rendered(1), rendered(3)));
        expect(out.map(i => i.n)).toEqual([1, 3]);
    });

    test('the legacy .png extension is carried through, not assumed', () => {
        const out = Images.matchStoredImages(ARTICLE_ID, new Map([[rendered(1), 'png']]));
        expect(out[0].ext).toBe('png');
    });

    test('expected caps how many slots are looked for', () => {
        const out = Images.matchStoredImages(
            ARTICLE_ID,
            stored(rendered(1), rendered(2), rendered(3)),
            { expected: 1 },
        );
        expect(out.map(i => i.n)).toEqual([1]);
    });
});

describe('matchStoredImages — sourced images', () => {
    test('a sourced hero is matched by its salted id', () => {
        const out = Images.matchStoredImages(ARTICLE_ID, stored(sourced(1)), { expected: 1 });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ n: 1, id: sourced(1), role: 'hero' });
    });

    test('the sourced id wins when a superseded render is still sitting in the folder', () => {
        // Migration uploads the photograph before deleting the render, and a
        // crash in between must not resurrect the render as the hero.
        const out = Images.matchStoredImages(ARTICLE_ID, stored(rendered(1), sourced(1)), { expected: 1 });
        expect(out.map(i => i.id)).toEqual([sourced(1)]);
    });

    test('a sourced id is never confused with a rendered one', () => {
        expect(sourced(1)).not.toBe(rendered(1));
        expect(sourced(1)).toMatch(Images.IMAGE_ID_RE);
    });
});

describe('matchStoredImages — frontmatter outranks derivation', () => {
    test('an unreproducible admin-regen id is recovered from the frontmatter', () => {
        // image-regen.js mints this with crypto.randomBytes(4). No deriver can
        // reach it; the published markdown is the only record of it.
        const regenerated = Images.mintImageId(ARTICLE_ID, 1, 'a1b2c3d4');
        const out = Images.matchStoredImages(ARTICLE_ID, stored(regenerated, rendered(2)), {
            imageFile: `images/${regenerated}.webp`,
        });
        expect(out[0]).toMatchObject({ n: 1, id: regenerated });
        expect(out.map(i => i.n)).toEqual([1, 2]);
    });

    test('the frontmatter hero is not also claimed by a later slot', () => {
        const out = Images.matchStoredImages(ARTICLE_ID, stored(rendered(2)), {
            imageFile: `images/${rendered(2)}.webp`,
        });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ n: 1, id: rendered(2) });
    });

    test('a frontmatter pointing at a file that is gone falls back to derivation', () => {
        const out = Images.matchStoredImages(ARTICLE_ID, stored(rendered(1)), {
            imageFile: 'images/zzzzzzzzzzzz.webp',
        });
        expect(out.map(i => i.id)).toEqual([rendered(1)]);
    });
});

describe('matchStoredImages — the article must survive', () => {
    test('a lone unrecognised object is adopted as the hero', () => {
        // The case that unpublished real articles: no frontmatter to lean on,
        // an id nothing can derive, and one file plainly sitting there.
        const out = Images.matchStoredImages(ARTICLE_ID, stored('QQQQQQQQQQQQ'));
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ n: 1, id: 'QQQQQQQQQQQQ', role: 'hero' });
    });

    test('several unrecognised objects are left alone rather than guessed at', () => {
        // Ordering these would put an arbitrary picture at the top of the
        // article. Reporting none is honest; the caller warns and drafts it.
        const out = Images.matchStoredImages(ARTICLE_ID, stored('QQQQQQQQQQQQ', 'ZZZZZZZZZZZZ'));
        expect(out).toEqual([]);
    });

    test('an empty folder yields no images and does not throw', () => {
        expect(Images.matchStoredImages(ARTICLE_ID, new Map())).toEqual([]);
        expect(Images.matchStoredImages(ARTICLE_ID, null)).toEqual([]);
    });

    test('a plain object is accepted as well as a Map', () => {
        const out = Images.matchStoredImages(ARTICLE_ID, { [rendered(1)]: 'webp' });
        expect(out.map(i => i.id)).toEqual([rendered(1)]);
    });
});

describe('matchStoredImages — isolation between articles', () => {
    test('an image derived for a different article is not matched by derivation', () => {
        const other = '2026-07-31__a-different-story';
        const out = Images.matchStoredImages(ARTICLE_ID, stored(Images.mintImageId(other, 1)));
        // Adopted only because it is alone in the folder, which cannot happen
        // across articles: keys are scoped to the article's own prefix.
        expect(out).toHaveLength(1);
        expect(Images.mintImageId(other, 1)).not.toBe(rendered(1));
    });
});

'use strict';
/**
 * Sourcing the outlet's own photograph.
 *
 * Every test here is pure — fixtures are synthesised with sharp rather than
 * checked in, and nothing touches the network. The validation cases are the
 * point: an `og:image` is whatever the publisher put there, and the failures
 * that matter (a tracking pixel, a house logo, an HTML error page served as an
 * image) all publish silently if nothing rejects them.
 */

const sharp = require('sharp');
const Source = require('../../lib/news-image-source');

/** A synthetic photograph: noise, so it decodes and carries real entropy. */
async function photo(width, height, format = 'jpeg') {
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7919) % 251;
    const img = sharp(pixels, { raw: { width, height, channels: 3 } });
    return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

/** A flat PNG with an alpha channel — the shape of a logo. */
async function transparentLogo(width = 800, height = 600) {
    return sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
}

describe('resolveImageUrl — the ladder', () => {
    const sheet = { source_url: 'https://news.example.com/world/story' };

    test('the RSS enclosure wins when the feed carried one', () => {
        const out = Source.resolveImageUrl(
            { imageUrl: 'https://img.example.com/from-feed.jpg' },
            { ...sheet, image: 'https://img.example.com/from-page.jpg', image_stage: 'og' },
        );
        expect(out).toEqual({ url: 'https://img.example.com/from-feed.jpg', stage: 'rss' });
    });

    test('falls through to the page image when the feed had none', () => {
        const out = Source.resolveImageUrl({}, { ...sheet, image: 'https://img.example.com/og.jpg', image_stage: 'og' });
        expect(out).toEqual({ url: 'https://img.example.com/og.jpg', stage: 'og' });
    });

    test('carries the jsonld stage through so hit rates are attributable', () => {
        const out = Source.resolveImageUrl({}, { ...sheet, image: 'https://img.example.com/ld.jpg', image_stage: 'jsonld' });
        expect(out.stage).toBe('jsonld');
    });

    test('reports a reason rather than throwing when there is nothing', () => {
        const out = Source.resolveImageUrl({}, sheet);
        expect(out.url).toBeNull();
        expect(out.stage).toBe('none');
        expect(out.reason).toMatch(/no image url/);
    });

    test('a relative feed image is resolved against the article URL', () => {
        const out = Source.resolveImageUrl({ imageUrl: '/media/photo.jpg' }, sheet);
        expect(out.url).toBe('https://news.example.com/media/photo.jpg');
    });

    test('a protocol-relative URL keeps the page protocol', () => {
        const out = Source.resolveImageUrl({ imageUrl: '//cdn.example.com/photo.jpg' }, sheet);
        expect(out.url).toBe('https://cdn.example.com/photo.jpg');
    });

    test('data: and javascript: URLs are refused', () => {
        expect(Source.normalizeCandidateUrl('data:image/png;base64,AAAA', 'https://x.test/')).toBe('');
        expect(Source.normalizeCandidateUrl('javascript:alert(1)', 'https://x.test/')).toBe('');
    });
});

describe('resolveImageCandidates — fallback, not a single guess', () => {
    const sheet = { source_url: 'https://news.example.com/world/story' };

    test('offers the feed image first and the page image behind it', () => {
        // The failure this exists for: a feed serving a 240x135 thumbnail cost
        // five of thirty-two stories their picture on the first live run, while
        // the source page was serving a perfectly good 1200x630 og:image.
        const out = Source.resolveImageCandidates(
            { imageUrl: 'https://img.example.com/thumb-240.jpg' },
            { ...sheet, image: 'https://img.example.com/full-1200.jpg', image_stage: 'og' },
        );
        expect(out).toEqual([
            { url: 'https://img.example.com/thumb-240.jpg', stage: 'rss' },
            { url: 'https://img.example.com/full-1200.jpg', stage: 'og' },
        ]);
    });

    test('does not offer the same url twice', () => {
        const same = 'https://img.example.com/p.jpg';
        const out = Source.resolveImageCandidates({ imageUrl: same }, { ...sheet, image: same });
        expect(out).toHaveLength(1);
    });

    test('is empty when there is nothing, rather than holding a null entry', () => {
        expect(Source.resolveImageCandidates({}, sheet)).toEqual([]);
    });

    test('resolveImageUrl stays the head of the same list', () => {
        const args = [
            { imageUrl: 'https://img.example.com/a.jpg' },
            { ...sheet, image: 'https://img.example.com/b.jpg' },
        ];
        const [first] = Source.resolveImageCandidates(...args);
        expect(Source.resolveImageUrl(...args)).toMatchObject({ url: first.url, stage: first.stage });
    });
});

describe('looksLikeHouseImage', () => {
    test.each([
        'https://cdn.example.com/assets/default-share.jpg',
        'https://cdn.example.com/img/logo.png',
        'https://example.com/static/og-image.jpg',
        'https://example.com/social_card.jpg',
        'https://example.com/media/placeholder.jpg',
        'https://example.com/no-image.png',
    ])('flags %s', (url) => {
        expect(Source.looksLikeHouseImage(url)).toBe(true);
    });

    test.each([
        'https://cdn.example.com/2026/08/senate-hearing-crowd.jpg',
        'https://cdn.example.com/photos/GettyImages-1234567.jpg',
        'https://logo-news.example.com/2026/flood-rescue.jpg',
    ])('leaves %s alone', (url) => {
        expect(Source.looksLikeHouseImage(url)).toBe(false);
    });

    test('a CDN transform path is not mistaken for a house image', () => {
        // Brightspot serves every NPR photograph through `/dims3/default/`,
        // where `default` names a transform preset. Matching the whole path
        // threw away real 4382x2465 press photographs during the migration.
        expect(Source.looksLikeHouseImage(
            'https://npr.brightspotcdn.com/dims3/default/strip/false/crop/4382x2465+0+228/resize/1400/quality/85/format/jpeg/?url=x',
        )).toBe(false);
    });

    test('but the outlet\'s actual fallback card is still caught', () => {
        expect(Source.looksLikeHouseImage(
            'https://media.npr.org/include/images/facebook-default-wide-s1400-c85.jpg',
        )).toBe(true);
    });

    test('a query string cannot smuggle a house image past the check', () => {
        expect(Source.looksLikeHouseImage('https://cdn.example.com/logo.png?v=2')).toBe(true);
    });
});

describe('sniffFormat', () => {
    test('identifies a real jpeg', async () => {
        expect(Source.sniffFormat(await photo(64, 64))).toBe('jpeg');
    });

    test('identifies a real png', async () => {
        expect(Source.sniffFormat(await photo(64, 64, 'png'))).toBe('png');
    });

    test('refuses html served at an image url', () => {
        expect(Source.sniffFormat(Buffer.from('<!DOCTYPE html><html><body>Subscribe</body></html>'))).toBe('');
    });

    test('refuses an empty or truncated buffer', () => {
        expect(Source.sniffFormat(Buffer.alloc(0))).toBe('');
        expect(Source.sniffFormat(Buffer.from([0xff, 0xd8]))).toBe('');
    });
});

describe('validateSourcedImage', () => {
    test('accepts an ordinary 1200x630 share photograph', async () => {
        const out = await Source.validateSourcedImage(await photo(1200, 630), {
            contentType: 'image/jpeg',
            url: 'https://cdn.example.com/2026/08/hearing.jpg',
        });
        expect(out.ok).toBe(true);
        expect(out.meta).toMatchObject({ width: 1200, height: 630, format: 'jpeg' });
    });

    test('rejects svg outright rather than handing it to librsvg', async () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
        const out = await Source.validateSourcedImage(svg, { contentType: 'image/svg+xml' });
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/svg/);
    });

    test('rejects an HTML paywall page served with a 200', async () => {
        const out = await Source.validateSourcedImage(
            Buffer.from('<!DOCTYPE html><html><head><title>Subscribe</title></head></html>'),
            { contentType: 'text/html' },
        );
        expect(out.ok).toBe(false);
    });

    test('rejects a tracking pixel', async () => {
        const out = await Source.validateSourcedImage(await photo(1, 1), { contentType: 'image/png' });
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/too small/);
    });

    test('rejects an image below the upscale floor', async () => {
        const out = await Source.validateSourcedImage(await photo(500, 300), { contentType: 'image/jpeg' });
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/too small \(500x300\)/);
    });

    test('rejects a banner strip', async () => {
        const out = await Source.validateSourcedImage(await photo(2000, 400), { contentType: 'image/jpeg' });
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/aspect/);
    });

    test('accepts a square image — the layout risk is handled by normalizing', async () => {
        // 1:1 is within the accepted band on purpose. It is a legitimate news
        // crop, and normalizeSourcedImage is what stops it reaching the reader
        // as a screen-filling hero.
        const out = await Source.validateSourcedImage(await photo(1000, 1000), { contentType: 'image/jpeg' });
        expect(out.ok).toBe(true);
    });

    test('rejects a transparent png as a logo', async () => {
        const out = await Source.validateSourcedImage(await transparentLogo(), { contentType: 'image/png' });
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/transparent png/);
    });

    test('rejects an image whose url names it as house furniture', async () => {
        const out = await Source.validateSourcedImage(await photo(1200, 630), {
            contentType: 'image/jpeg',
            url: 'https://cdn.example.com/assets/default-share.jpg',
        });
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/house/);
    });

    test('rejects an unexpected content-type', async () => {
        const out = await Source.validateSourcedImage(await photo(1200, 630), { contentType: 'application/pdf' });
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/content-type/);
    });

    test('an empty body is a reason, not an exception', async () => {
        const out = await Source.validateSourcedImage(Buffer.alloc(0), { contentType: 'image/jpeg' });
        expect(out.ok).toBe(false);
        expect(out.reason).toMatch(/empty/);
    });

    test('a missing content-type does not by itself disqualify', async () => {
        // Some CDNs omit it. The magic bytes are the real check.
        const out = await Source.validateSourcedImage(await photo(1200, 630), { contentType: '' });
        expect(out.ok).toBe(true);
    });
});

describe('normalizeSourcedImage', () => {
    test.each([
        ['square', 1000, 1000],
        ['portrait', 800, 1200],
        ['ultrawide', 2400, 800],
        ['undersized', 700, 400],
        ['already 16:9', 1920, 1080],
    ])('%s input publishes as exactly 1600x900 webp', async (_label, w, h) => {
        const out = await Source.normalizeSourcedImage(await photo(w, h));
        const meta = await sharp(out).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.width).toBe(Source.TARGET_WIDTH);
        expect(meta.height).toBe(Source.TARGET_HEIGHT);
    });

    test('output clears the publish floor, so nothing is dropped as truncated', async () => {
        const out = await Source.normalizeSourcedImage(await photo(1200, 630));
        expect(out.length).toBeGreaterThan(require('../../lib/r2-news').MIN_IMAGE_BYTES);
    });

    test('EXIF orientation is applied and then stripped', async () => {
        // orientation 6 = rotate 90deg. A wire JPEG carrying this publishes
        // sideways unless .rotate() runs first.
        const rotated = await sharp(await photo(1200, 630))
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer();
        const out = await Source.normalizeSourcedImage(rotated);
        const meta = await sharp(out).metadata();
        expect(meta.width).toBe(Source.TARGET_WIDTH);
        expect(meta.height).toBe(Source.TARGET_HEIGHT);
        expect(meta.orientation).toBeUndefined();
    });
});

describe('imageHash / hashDistance', () => {
    test('the same picture hashes identically', async () => {
        const buf = await photo(800, 600);
        expect(await Source.imageHash(buf)).toBe(await Source.imageHash(buf));
    });

    test('survives re-encoding, which is what CDNs do to every image', async () => {
        const original = await photo(1200, 630);
        const recompressed = await sharp(original).jpeg({ quality: 60 }).toBuffer();
        const d = Source.hashDistance(await Source.imageHash(original), await Source.imageHash(recompressed));
        expect(d).toBeLessThanOrEqual(Source.DUPLICATE_HASH_DISTANCE);
    });

    test('a missing hash compares as infinitely distant, never as a match', () => {
        expect(Source.hashDistance(null, 'abcdef0123456789')).toBe(Infinity);
        expect(Source.hashDistance('abcdef0123456789', null)).toBe(Infinity);
    });
});

describe('createImageTracker', () => {
    test('the first claim on a url is allowed and the repeats are not', () => {
        const t = Source.createImageTracker();
        expect(t.claim('https://cdn.example.com/default.jpg').ok).toBe(true);
        expect(t.claim('https://cdn.example.com/default.jpg').ok).toBe(false);
        expect(t.claim('https://cdn.example.com/default.jpg').reason).toMatch(/already used/);
    });

    test('reports the repeated urls so they can be denylisted next run', () => {
        const t = Source.createImageTracker();
        t.claim('https://cdn.example.com/a.jpg');
        t.claim('https://cdn.example.com/house.jpg');
        t.claim('https://cdn.example.com/house.jpg');
        expect(t.repeats()).toEqual(['https://cdn.example.com/house.jpg']);
    });

    test('a known house image is refused on its first claim', () => {
        const t = Source.createImageTracker({ denylist: ['https://cdn.example.com/house.jpg'] });
        expect(t.claim('https://cdn.example.com/house.jpg').ok).toBe(false);
    });

    test('the same picture under two urls is caught by hash', () => {
        const t = Source.createImageTracker();
        expect(t.claim('https://cdn.example.com/a.jpg?v=1', 'ffffffff00000000').ok).toBe(true);
        expect(t.claim('https://cdn.example.com/a.jpg?v=2', 'ffffffff00000000').ok).toBe(false);
    });

    test('claimHash works on its own, for the caller that only has bytes later', () => {
        // The pipeline claims the URL before paying for a download and the
        // hash only afterwards, so the two must be usable separately.
        const t = Source.createImageTracker();
        expect(t.claim('https://cdn.example.com/a.jpg?v=1').ok).toBe(true);
        expect(t.claimHash('ffffffff00000000').ok).toBe(true);

        expect(t.claim('https://cdn.example.com/a.jpg?v=2').ok).toBe(true);
        expect(t.claimHash('ffffffff00000000').ok).toBe(false);
    });

    test('claiming a hash does not pollute the repeated-url report', () => {
        const t = Source.createImageTracker();
        t.claim('https://cdn.example.com/a.jpg');
        t.claimHash('ffffffff00000000');
        expect(t.repeats()).toEqual([]);
    });

    test('genuinely different pictures both pass', () => {
        const t = Source.createImageTracker();
        expect(t.claim('https://cdn.example.com/a.jpg', 'ffffffffffffffff').ok).toBe(true);
        expect(t.claim('https://cdn.example.com/b.jpg', '0000000000000000').ok).toBe(true);
    });
});

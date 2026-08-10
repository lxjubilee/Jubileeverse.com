'use strict';
/**
 * A day folder now holds two kinds of object, and two pieces of code have to
 * tell them apart in opposite directions.
 *
 * Translations are stored one segment above the article they translate —
 * `news/Y/M/D/hi-IN/<slug>/article.md` beside `news/Y/M/D/<slug>/article.md` —
 * so:
 *
 *   - Deleting an article must take its translations with it. Scoped to
 *     `<slug>/`, as it was, every translated copy survives the article forever:
 *     nothing links to them, nothing lists them, and nothing ever deletes them.
 *   - Rebuilding the day manifest must NOT see them. repairManifest walks the
 *     day prefix and treats each `<x>/article.md` as an article, so a pattern one
 *     segment too loose would publish `hi-IN` as a story of its own.
 *
 * Both properties are invisible until they are wrong, so both are pinned here —
 * the second against the regex read out of the shipped script rather than a copy
 * of it, so widening that pattern fails this test instead of the site.
 */

const fs = require('fs');
const path = require('path');

const N = require('../../lib/r2-news');
const C = require('../../lib/r2-client');

const DAY = C.dateFromPstString('2026-07-31');
const PREFIX = 'news/2026/07/31/';
const SLUG = 'church-zoning-ruling';

describe('deleting an article takes its translations', () => {
    const match = (key) => N.newsArticleKeyPattern(SLUG, DAY).test(key);

    test.each([
        `${PREFIX}${SLUG}/article.md`,
        `${PREFIX}${SLUG}/images/a1b2c3d4e5f6.webp`,
        `${PREFIX}hi-IN/${SLUG}/article.md`,
        `${PREFIX}ar-EG/${SLUG}/article.md`,
        `${PREFIX}fil-PH/${SLUG}/article.md`,
    ])('%s belongs to the article', (key) => {
        expect(match(key)).toBe(true);
    });

    test.each([
        // A slug this one is a prefix of. The trailing slash is what separates
        // them, and losing it would delete a neighbouring story.
        `${PREFIX}${SLUG}-appeal/article.md`,
        `${PREFIX}hi-IN/${SLUG}-appeal/article.md`,
        // Another article entirely.
        `${PREFIX}seouls-chip-stocks/article.md`,
        // The same slug on another day.
        `news/2026/07/30/${SLUG}/article.md`,
        `news/2026/07/30/hi-IN/${SLUG}/article.md`,
        // The day manifest, which is rewritten rather than deleted.
        `${PREFIX}index.json`,
    ])('%s does not', (key) => {
        expect(match(key)).toBe(false);
    });
});

describe('rebuilding the manifest cannot mistake a language for an article', () => {
    /**
     * repairManifest's key matcher, read out of the shipped script. Copying it
     * here would let the two drift, which is the failure this guards against.
     */
    function repairMatcher(prefix) {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'scripts', 'publish-daily-news.js'),
            'utf8',
        );
        const line = /const m = new RegExp\(`([^`]+)`\)\.exec\(key\)/.exec(src);
        if (!line) throw new Error('repairManifest key matcher not found');
        // The template interpolates `${prefix}`; substitute the real one.
        return new RegExp(line[1].replace('${prefix}', prefix).replace(/\\\\/g, '\\'));
    }

    const matcher = repairMatcher(PREFIX);

    test('the matcher was found and still recognises a real article', () => {
        expect(matcher.test(`${PREFIX}${SLUG}/article.md`)).toBe(true);
        expect(matcher.test(`${PREFIX}${SLUG}/images/a1b2c3d4e5f6.webp`)).toBe(true);
    });

    test.each([
        `${PREFIX}hi-IN/${SLUG}/article.md`,
        `${PREFIX}ar-EG/${SLUG}/article.md`,
        `${PREFIX}fil-PH/${SLUG}/images/a1b2c3d4e5f6.webp`,
    ])('%s is skipped', (key) => {
        expect(matcher.test(key)).toBe(false);
    });
});

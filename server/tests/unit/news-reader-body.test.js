'use strict';
/**
 * What the article reader is given from a published news body.
 *
 * `/news/<slug>` renders the shared <ArticleReader>, which supplies the header,
 * the hero image and the source attribution itself. The stored body carries all
 * three as well — it is written for the pipeline as much as for the reader — so
 * `toReaderBody` trims them before the prose is rendered. Getting that wrong is
 * visible on the page: raw "**Article Title:** …" metadata at the top, or the
 * hero image shown twice.
 *
 * The reading experience is one picture in the hero and then prose, so the body
 * keeps no images at all — not the hero, and not the supporting images the
 * composer places between paragraphs.
 *
 * The function is TypeScript in src/, so this test loads the real source and
 * erases the annotations rather than restating the logic.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load `toReaderBody` out of src/lib/news.ts, with its types erased. */
function loadToReaderBody() {
    const file = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'news.ts');
    const src = fs.readFileSync(file, 'utf8');
    const start = src.indexOf('export function toReaderBody');
    if (start === -1) throw new Error('toReaderBody is no longer exported from src/lib/news.ts');
    const end = src.indexOf('\n}', start);
    const fn = src
        .slice(start, end + 2)
        .replace(
            'export function toReaderBody(content: string): string',
            'function toReaderBody(content)',
        );

    const sandbox = { exports: {} };
    vm.createContext(sandbox);
    vm.runInContext(`${fn}\nexports.toReaderBody = toReaderBody;`, sandbox);
    return sandbox.exports.toReaderBody;
}

const toReaderBody = loadToReaderBody();

const HERO = 'https://cdn.jubileeverse.com/news/2026/07/31/court-rules-on-zoning/images/TmgnuhH55ELT.webp';
const SUPPORTING = 'https://cdn.jubileeverse.com/news/2026/07/31/court-rules-on-zoning/images/efxDhrgIhkng.webp';

/** The exact shape buildNewsMarkdown() writes, minus the frontmatter. */
const published = [
    '**Article Title:** Court Rules on Zoning',
    '',
    '**Writer:** JubileeVerse Newsroom',
    '',
    '**Article Slug:** court-rules-on-zoning',
    '',
    '**Source News URL:** https://example.org/story',
    '',
    '**Published:** 2026-07-31',
    '',
    '---',
    '',
    `![Court Rules on Zoning](${HERO})`,
    '',
    '## Introduction',
    '',
    'The council voted on Tuesday.',
    '',
    `![Court Rules on Zoning](${SUPPORTING})`,
    '',
    '## Article Body',
    '',
    '## What the vote changed',
    '',
    'The ordinance now permits the shelter.',
    '',
    '## Faith-Based Relevance Analysis',
    '',
    '> Do justice, love mercy.',
    '',
    'Micah 6:8',
    '',
    '---',
    '',
    '**Source:** [Vatican News](https://example.org/story)',
    '',
    '_Reported from published sources and written with AI assistance for JubileeVerse Newsroom._',
    '',
].join('\n');

describe('toReaderBody — what the reader renders', () => {
    const body = toReaderBody(published);

    test('drops the labelled metadata block the reader shows in its header', () => {
        expect(body).not.toMatch(/\*\*Article Title:\*\*/);
        expect(body).not.toMatch(/\*\*Writer:\*\*/);
        expect(body).not.toMatch(/\*\*Article Slug:\*\*/);
        expect(body).not.toMatch(/\*\*Source News URL:\*\*/);
        expect(body).not.toMatch(/\*\*Published:\*\*/);
        expect(body).not.toContain('court-rules-on-zoning');
    });

    test('drops the hero image, which the reader shows full-bleed above the title', () => {
        expect(body).not.toContain(HERO);
    });

    test('drops the images placed between paragraphs', () => {
        expect(body).not.toContain(SUPPORTING);
        expect(body).not.toMatch(/!\[/);
        expect(body).not.toMatch(/\.webp/);
    });

    test('leaves no gap where an image was', () => {
        expect(body).not.toMatch(/\n{3,}/);
        expect(body).not.toMatch(/^[ \t]+$/m);
    });

    test('drops the generator scaffolding headings', () => {
        expect(body).not.toMatch(/^##\s+Introduction$/m);
        expect(body).not.toMatch(/^##\s+Article Body$/m);
    });

    test('keeps the editorial headings and prose', () => {
        expect(body).toMatch(/^## What the vote changed$/m);
        expect(body).toMatch(/^## Faith-Based Relevance Analysis$/m);
        expect(body).toContain('The council voted on Tuesday.');
        expect(body).toContain('The ordinance now permits the shelter.');
        expect(body).toContain('> Do justice, love mercy.');
    });

    test('drops the trailing source + disclosure block the reader renders itself', () => {
        expect(body).not.toMatch(/\*\*Source:\*\*/);
        expect(body).not.toMatch(/AI assistance/);
    });

    test('starts on the story, not on blank lines or a rule', () => {
        expect(body.startsWith('The council voted on Tuesday.')).toBe(true);
        expect(body).not.toMatch(/\n{3,}/);
    });
});

describe('toReaderBody — bodies that do not match the template', () => {
    test('a plain body is returned untouched', () => {
        const plain = '## A heading\n\nJust prose.';
        expect(toReaderBody(plain)).toBe(plain);
    });

    test('an image mid-paragraph leaves the sentence intact', () => {
        const inline = `The council met ![a photo](${SUPPORTING}) on Tuesday.`;
        expect(toReaderBody(inline)).toBe('The council met  on Tuesday.');
    });

    test('a linked image loses its wrapper link, not the prose around it', () => {
        const linked = `Before.\n\n[![alt](${SUPPORTING})](https://example.org/full)\n\nAfter.`;
        expect(toReaderBody(linked)).toBe('Before.\n\nAfter.');
    });

    test('ordinary links are never mistaken for images', () => {
        const link = 'See [the ruling](https://example.org/ruling) for the text.';
        expect(toReaderBody(link)).toBe(link);
    });

    test('empty and missing content degrade to an empty string', () => {
        expect(toReaderBody('')).toBe('');
        expect(toReaderBody(null)).toBe('');
        expect(toReaderBody(undefined, HERO)).toBe('');
    });
});

'use strict';
/**
 * The "*by <name>*" line under a published article's title.
 *
 * Every article in the five bundles is authored with the title as an h1 and the
 * author as an emphasised line beneath it. Both are already on the page by the
 * time the body renders — the reader puts the title in the hero and the author
 * in the source badge — so that line printed the byline a second time, as the
 * article's opening words.
 *
 * What matters here is that the removal is narrow. It must take the line under
 * the title and nothing else: not the title, not a paragraph further down that
 * happens to start with an emphasised "by", and not a single word of prose.
 *
 * The module is TypeScript in src/, so this test transpiles the real file and
 * drives fetchArticle() with `fetch` stubbed, rather than restating the regex.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'articles.ts');

const CATEGORY = 'covenant-identity';
const SLUG = 'the-laying-on-was-leaning';

/** Load src/lib/articles.ts for real, serving one manifest and one markdown file. */
function loadWithBody(markdown) {
    const { outputText } = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });

    const stubs = {
        './articleId': { makeArticleId: (category, slug) => `${category}__${slug}` },
        './cdn': { CDN_BASE_URL: 'https://cdn.jubileeverse.com' },
    };

    const manifest = JSON.stringify({
        category: 'Covenant & Identity',
        articles: [{
            slug: SLUG,
            title: 'The Laying On Was Leaning',
            file: `${SLUG}.md`,
            author: 'Santiago Inspire',
            status: 'published',
            date_updated: '2026-08-06',
            image_file: 'hero.png',
            image_status: 'generated',
        }],
    });

    const sandbox = {
        exports: {},
        module: { exports: {} },
        require: (id) => stubs[id] ?? {},
        console: { error() {}, warn() {}, log() {} },
        process: { env: {} },
        AbortSignal: { timeout: () => undefined },
        async fetch(url) {
            const u = String(url);
            if (u.endsWith('/articles.json')) return { ok: true, status: 200, text: async () => manifest };
            if (u.endsWith(`/${SLUG}.md`)) return { ok: true, status: 200, text: async () => markdown };
            return { ok: false, status: 404, text: async () => '' };
        },
    };
    sandbox.module.exports = sandbox.exports;
    vm.createContext(sandbox);
    vm.runInContext(outputText, sandbox);
    return sandbox.exports;
}

/** A published article: frontmatter, title, byline, then the body. */
const article = (afterTitle) => `---
title: "The Laying On Was Leaning"
slug: "${SLUG}"
author: "Santiago Inspire"
---

# The Laying On Was Leaning

${afterTitle}`;

const contentOf = async (markdown) =>
    (await loadWithBody(markdown).fetchArticle(CATEGORY, SLUG)).content;

describe('fetchArticle — the byline under the title', () => {
    test('drops the "*by <name>*" line the bundles are authored with', async () => {
        const content = await contentOf(article('*by Santiago Inspire*\n\nAbout 20 percent of adults.'));
        expect(content).not.toMatch(/by Santiago Inspire/);
        expect(content).toContain('About 20 percent of adults.');
    });

    test('keeps the title, which the reader strips for its own hero', async () => {
        const content = await contentOf(article('*by Santiago Inspire*\n\nAbout 20 percent of adults.'));
        expect(content.startsWith('# The Laying On Was Leaning')).toBe(true);
    });

    test('leaves the author on the article itself — only the body line goes', async () => {
        const piece = await loadWithBody(
            article('*by Santiago Inspire*\n\nAbout 20 percent of adults.'),
        ).fetchArticle(CATEGORY, SLUG);
        expect(piece.author).toBe('Santiago Inspire');
    });

    test('does not leave a ragged gap where the line was', async () => {
        const content = await contentOf(article('*by Santiago Inspire*\n\nAbout 20 percent of adults.'));
        expect(content).toBe('# The Laying On Was Leaning\n\nAbout 20 percent of adults.');
    });

    test('handles the bold variant as well as the italic one', async () => {
        expect(await contentOf(article('**by Santiago Inspire**\n\nBody text.')))
            .toBe('# The Laying On Was Leaning\n\nBody text.');
    });

    test('a line whose emphasis markers do not pair is left alone', async () => {
        // `*by X_` opens italic and never closes it. That is not the authoring
        // template's byline, so it is prose until someone says otherwise.
        expect(await contentOf(article('*by Santiago Inspire_\n\nBody text.')))
            .toContain('*by Santiago Inspire_');
    });

    test('an article written without a byline is untouched', async () => {
        const content = await contentOf(article('About 20 percent of adults.'));
        expect(content).toBe('# The Laying On Was Leaning\n\nAbout 20 percent of adults.');
    });

    test('a later paragraph opening with an emphasised "by" survives', async () => {
        const content = await contentOf(article(
            '*by Santiago Inspire*\n\nFirst paragraph.\n\n*by the way, this is prose*\n\nLast.',
        ));
        expect(content).toContain('*by the way, this is prose*');
        expect(content).not.toMatch(/by Santiago Inspire/);
    });

    test('strips a byline that stands alone, with no title above it', async () => {
        const markdown = `---\ntitle: "T"\nslug: "${SLUG}"\n---\n\n*by Santiago Inspire*\n\nBody text.`;
        expect(await contentOf(markdown)).toBe('Body text.');
    });

    test('a body whose prose merely starts with the word by is left alone', async () => {
        const content = await contentOf(article('By the rivers of Babylon we sat down.'));
        expect(content).toContain('By the rivers of Babylon we sat down.');
    });
});

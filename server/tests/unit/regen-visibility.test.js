'use strict';
/**
 * Which articles offer an admin the regenerate-image control.
 *
 * News no longer does. Its picture is the photograph the originating outlet
 * published, so "regenerate" names an action that cannot happen — and because
 * the control defaulted to on in StoryCard, it appeared over every card in
 * every grid for any signed-in admin.
 *
 * The rule lives in one function precisely so it cannot drift back: three
 * separate render sites (StoryCard, ArticleReader, and anything added later)
 * ask the same question. These tests load the real module so a change to that
 * function has to come past them.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Lift one exported function out of a .ts file and erase its annotations.
 *
 * Scoped to a named function rather than the whole module: `article.ts` also
 * holds sessionStorage and fetch-driven helpers whose types this has no reason
 * to model, and trying to strip the entire file just produces new syntax
 * errors every time something unrelated is added to it.
 */
function extractFn(src, name) {
    const m = new RegExp(`export function ${name}\\([\\s\\S]*?\\n}`).exec(src);
    if (!m) throw new Error(`${name} not found — was it renamed?`);
    return m[0]
        .replace(/^export\s+/, '')
        // Return type: from the parameter list's close paren to the body brace.
        .replace(/\)\s*:\s*.*\{\s*$/m, ') {')
        // Optional params: `date?: string` would strip to `date?`, a syntax error.
        .replace(/(\w+)\?\s*:/g, '$1:')
        .replace(/:\s*RegenTarget\s*\|\s*null/g, '')
        .replace(/:\s*string\s*\|\s*number\s*\|\s*undefined/g, '')
        .replace(/:\s*Pick<[^>]*>/g, '')
        .replace(/:\s*string\b/g, '');
}

function loadArticleLib() {
    const read = (f) => fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'src', 'lib', f), 'utf8',
    );
    const articleSrc = read('article.ts');
    const idSrc = read('articleId.ts');

    // Module-level constants the lifted functions close over. Cheaper and less
    // brittle than stripping the whole module, which drags in every unrelated
    // type in the file.
    const consts = (idSrc.match(/^const \w+ = .*;$/gm) || []).join('\n');

    const js = [
        consts,
        extractFn(idSrc, 'parseArticleId'),          // regenTargetFor depends on it
        extractFn(articleSrc, 'regenTargetFor'),
        extractFn(articleSrc, 'regenTargetOf'),
        extractFn(articleSrc, 'canRegenerateImage'),
    ].join('\n\n');

    const sandbox = { exports: {}, console };
    vm.createContext(sandbox);
    vm.runInContext(
        `${js}\n`
        + `exports.regenTargetFor = regenTargetFor;`
        + `exports.regenTargetOf = regenTargetOf;`
        + `exports.canRegenerateImage = canRegenerateImage;`,
        sandbox,
    );
    return sandbox.exports;
}

const A = loadArticleLib();

/** A CDN news story, as homeFeed.toStory builds it. */
const newsStory = (over = {}) => ({
    id: 'a-hill-columnist-says-the-press-not-just-fauci-failed',
    slug: 'a-hill-columnist-says-the-press-not-just-fauci-failed',
    date: '2026-08-03',
    ...over,
});

/** A five-fold category article, as categoryArticleToStory builds it. */
const categoryStory = (over = {}) => ({
    id: 'covenant-identity__the-bravest-prayer-says-perhaps',
    slug: undefined,
    date: undefined,
    ...over,
});

describe('regenTargetOf — which kind an article resolves to', () => {
    test('a news story resolves to kind news', () => {
        expect(A.regenTargetOf(newsStory())).toMatchObject({ kind: 'news' });
    });

    test('a category article resolves to kind category', () => {
        expect(A.regenTargetOf(categoryStory())).toMatchObject({ kind: 'category' });
    });

    test('a legacy numeric id resolves to nothing', () => {
        expect(A.regenTargetOf({ id: 48213, slug: undefined, date: undefined })).toBeNull();
    });
});

describe('canRegenerateImage', () => {
    test('is false for news — the outlet supplied the photograph', () => {
        expect(A.canRegenerateImage(A.regenTargetOf(newsStory()))).toBe(false);
    });

    test('is true for a category article — that image is still generated', () => {
        expect(A.canRegenerateImage(A.regenTargetOf(categoryStory()))).toBe(true);
    });

    test('is false when there is no target at all', () => {
        expect(A.canRegenerateImage(null)).toBe(false);
    });

    test('holds for every news story regardless of date or topic', () => {
        // The control appeared on all of them; none should bring it back.
        const days = ['2026-08-03', '2026-08-02', '2026-08-01', '2026-07-31', '2026-07-04'];
        for (const date of days) {
            const target = A.regenTargetOf(newsStory({ date }));
            expect(target.kind).toBe('news');
            expect(A.canRegenerateImage(target)).toBe(false);
        }
    });

    test('a news slug WITHOUT a date has no target, so still no control', () => {
        // storyHref needs the date pair too; without it there is nothing to act on.
        expect(A.canRegenerateImage(A.regenTargetOf(newsStory({ date: undefined })))).toBe(false);
    });
});

describe('the render sites all ask the same question', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', p), 'utf8');

    test('StoryCard gates on canRegenerateImage, not on the prop alone', () => {
        const src = read(path.join('components', 'content', 'StoryCard.tsx'));
        expect(src).toMatch(/canRegenerateImage\(regenTarget\)/);
        // The old form rendered whenever the prop was true, which defaulted on.
        expect(src).not.toMatch(/\{\s*showRegenerate\s*\?\s*\(/);
    });

    test('ArticleReader gates on canRegenerateImage', () => {
        const src = read(path.join('components', 'article', 'ArticleReader.tsx'));
        expect(src).toMatch(/canRegenerateImage\(regenTarget\)/);
    });

    test('no render site calls RegenerateImageButton unguarded', () => {
        for (const p of [
            path.join('components', 'content', 'StoryCard.tsx'),
            path.join('components', 'article', 'ArticleReader.tsx'),
        ]) {
            const src = read(p);
            const uses = src.match(/<RegenerateImageButton/g) || [];
            // Every usage sits behind a canRegenerateImage check.
            expect(uses.length).toBeGreaterThan(0);
            expect((src.match(/canRegenerateImage/g) || []).length).toBeGreaterThanOrEqual(uses.length);
        }
    });
});

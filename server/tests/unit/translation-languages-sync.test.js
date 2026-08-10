'use strict';
/**
 * Two hand-maintained mirrors of a TypeScript constant, checked against their
 * source.
 *
 * The Express process is unbuilt CommonJS and cannot require a `.ts` module, so
 * `lib/languages.js` and the `FOLDER_BY_ROUTE` table in `lib/r2-translations.js`
 * are copies of lists that live in `src/lib/`. Copies drift, and both failures
 * are silent:
 *
 *   - A language added to the picker but not to lib/languages.js is rejected by
 *     the allowlist, so it translates on every visit and is never stored. The
 *     reader sees a working translation; only the bill shows it.
 *   - A category route missing from FOLDER_BY_ROUTE writes translations to a
 *     folder no English article lives in. The write succeeds and every later
 *     read misses, forever.
 *
 * Neither surfaces in a log. So they are checked here instead, by reading the
 * TypeScript source directly — the same technique tts-voice-coverage.test.js
 * uses to hold the neural voice table against this same picker list.
 */

const fs = require('fs');
const path = require('path');

const {
    LANGUAGE_NAMES, LANGUAGE_CODES, LANG_CODE_RE, canonicalLang, isTranslatable,
} = require('../../lib/languages');
const { FOLDER_BY_ROUTE } = require('../../lib/r2-translations');

const ROOT = path.join(__dirname, '..', '..', '..');

/** `RAW` in src/lib/languages.ts, as `{ code: name }`. */
function pickerLanguages() {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'languages.ts'), 'utf8');
    const body = src.slice(src.indexOf('const RAW'), src.indexOf('export const LANGUAGES'));
    const map = {};
    for (const m of body.matchAll(/^\s*'([A-Za-z-]+)':\s*'([^']*)',/gm)) map[m[1]] = m[2];
    return map;
}

/** `FOLDER_BY_ROUTE` in src/lib/articles.ts, as `{ route: folder }`. */
function publishedFolders() {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'articles.ts'), 'utf8');
    const start = src.indexOf('const FOLDER_BY_ROUTE');
    const body = src.slice(start, src.indexOf('};', start));
    const map = {};
    for (const m of body.matchAll(/^\s*'([a-z0-9-]+)':\s*'([a-z0-9-]+)',/gm)) map[m[1]] = m[2];
    return map;
}

const picker = pickerLanguages();
const folders = publishedFolders();

describe('the language allowlist mirrors the picker', () => {
    // A parsing slip in the helper above would make every assertion below pass
    // over an empty object and prove nothing.
    test('both sources parsed', () => {
        expect(Object.keys(picker).length).toBeGreaterThan(50);
        expect(LANGUAGE_CODES.length).toBeGreaterThan(50);
        expect(picker['hi-IN']).toBe('Hindi');
    });

    // Both directions. An addition that never reaches the server is the obvious
    // failure; a removal that leaves a dead code on the server is the one that
    // gets missed, and it keeps a language storable that the reader can no
    // longer ask for.
    test('every picker language is on the server allowlist, and vice versa', () => {
        expect(LANGUAGE_CODES.slice().sort()).toEqual(Object.keys(picker).sort());
    });

    test('the display names match too, since the server prompt uses its own copy', () => {
        expect(LANGUAGE_NAMES).toEqual(picker);
    });
});

describe('every code has the shape the storage key depends on', () => {
    // This is what makes a language folder impossible to confuse with an article
    // slug: newsSlugify() lowercases, so a slug can never carry the uppercase
    // region every code below has.
    test.each(Object.keys(picker))('%s is a lowercase tag with an uppercase region', (code) => {
        expect(code).toMatch(LANG_CODE_RE);
    });
});

describe('canonicalisation', () => {
    test.each([
        ['hi-IN', 'hi-IN'],
        ['hi-in', 'hi-IN'],
        ['HI-IN', 'hi-IN'],
        ['  hi-IN  ', 'hi-IN'],
    ])('%s canonicalises to %s, so one language is never two objects', (input, expected) => {
        expect(canonicalLang(input)).toBe(expected);
    });

    test.each([['xx-XX'], ['hi'], ['../../etc'], [''], [null], [undefined], [42]])(
        '%p is not a language',
        (input) => {
            expect(canonicalLang(input)).toBe('');
        },
    );

    // English is what articles are stored in, so translating into it would mint
    // a second copy of the same bytes under a different key.
    test.each([['en-US'], ['en-GB'], ['en-us']])('%s is on the list but not translatable', (code) => {
        expect(canonicalLang(code)).not.toBe('');
        expect(isTranslatable(code)).toBe(false);
    });
});

describe('the category folder mirror matches src/lib/articles.ts', () => {
    test('both sources parsed', () => {
        expect(Object.keys(folders).length).toBeGreaterThan(0);
        expect(folders['torah-hebraic-insights']).toBe('torah-hebraic');
    });

    test('the mirror is exact', () => {
        expect({ ...FOLDER_BY_ROUTE }).toEqual(folders);
    });
});

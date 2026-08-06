'use strict';
/**
 * Daily rotation of category listings.
 *
 * A category portal shows every published article at once, so its order is
 * re-shuffled on a clock. Three properties carry the whole feature:
 *
 *   1. everyone inside one window sees the same order — it must be derived from
 *      the window, never from a random source, or a server render and its
 *      hydration would disagree and two readers would compare different pages;
 *   2. the order actually changes at midnight PST, and holds for the day
 *      between — a reader returning in the afternoon finds the page as they
 *      left it that dayOne;
 *   3. nothing is added, dropped, or duplicated — a shuffle, not a filter.
 *
 * The module is TypeScript in src/, so this test transpiles the real file
 * rather than restating the logic.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

/** Load src/lib/rotation.ts. It has no imports, so nothing needs stubbing. */
function loadRotation() {
    const file = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'rotation.ts');
    const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const sandbox = { exports: {}, module: { exports: {} }, Intl, Date, Math, Number, String };
    sandbox.module.exports = sandbox.exports;
    vm.createContext(sandbox);
    vm.runInContext(outputText, sandbox);
    return sandbox.exports;
}

const R = loadRotation();

/** 84 articles, the size a real category bundle actually carries. */
const articles = (n = 84) => Array.from({ length: n }, (_, i) => ({
    id: `covenant-identity__article-${i}`,
    title: `Article ${i}`,
}));

const ids = (list) => list.map((a) => a.id);

describe('rotationWindow — one PST day', () => {
    test('the default window is a full day', () => {
        expect(R.ROTATION_HOURS).toBe(24);
    });

    test('names the window by the PST day it opens', () => {
        // 14:30 UTC on 1 Aug 2026 is 07:30 PDT — the 1 August window.
        expect(R.rotationWindow(new Date('2026-08-01T14:30:00Z'))).toBe('2026-08-01T00');
    });

    test('every instant within one PST day yields the same key', () => {
        const inWindow = [
            '2026-08-01T07:00:00Z', // 00:00 PDT exactly
            '2026-08-01T15:45:12Z',
            '2026-08-02T06:59:59Z', // 23:59:59 PDT — still 1 August in PST
        ].map((t) => R.rotationWindow(new Date(t)));
        expect(new Set(inWindow).size).toBe(1);
        expect(inWindow[0]).toBe('2026-08-01T00');
    });

    test('rolls at midnight PST, not at midnight UTC', () => {
        // PDT is UTC-7 in August, so midnight UTC is still 17:00 the day before.
        expect(R.rotationWindow(new Date('2026-08-02T00:00:00Z'))).toBe('2026-08-01T00');
        // 07:00Z is midnight PDT: the new window.
        expect(R.rotationWindow(new Date('2026-08-02T07:00:00Z'))).toBe('2026-08-02T00');
    });

    test('a second before midnight PST is still the previous day', () => {
        expect(R.rotationWindow(new Date('2026-08-02T06:59:59Z'))).toBe('2026-08-01T00');
    });

    test('midnight PST opens the day, not hour 24', () => {
        expect(R.rotationWindow(new Date('2026-08-01T07:00:01Z'))).toBe('2026-08-01T00');
    });

    test('follows the timezone through DST rather than a fixed offset', () => {
        // January is PST (UTC-8): 06:00Z on the 16th is 22:00 PST on the 15th.
        expect(R.rotationWindow(new Date('2026-01-16T06:00:00Z'))).toBe('2026-01-15T00');
        // July is PDT (UTC-7): the same 06:00Z is 23:00 PDT on the 15th.
        expect(R.rotationWindow(new Date('2026-07-16T06:00:00Z'))).toBe('2026-07-15T00');
        // Two hours later in January is 00:00 PST on the 16th — the next window.
        expect(R.rotationWindow(new Date('2026-01-16T08:00:00Z'))).toBe('2026-01-16T00');
    });

    test('gives exactly one window a day', () => {
        const seen = new Set();
        for (let h = 0; h < 24; h++) {
            seen.add(R.rotationWindow(new Date(Date.UTC(2026, 7, 1, h, 30))));
        }
        // 24 hourly UTC samples span two PST days -> two keys, no more.
        expect(seen.size).toBe(2);
        for (const key of seen) expect(key).toMatch(/T00$/);
    });

    test('a shorter window is still available to a caller that asks', () => {
        // Only the default moved to a day; the size is still a parameter.
        expect(R.rotationWindow(new Date('2026-08-01T14:30:00Z'), 6)).toBe('2026-08-01T06');
        expect(R.rotationWindow(new Date('2026-08-01T19:00:00Z'), 6)).toBe('2026-08-01T12');
    });
});

describe('seededShuffle — same seed, same order', () => {
    test('is a permutation: nothing added, dropped, or duplicated', () => {
        const source = articles();
        const shuffled = R.seededShuffle(source, 'any-seed');
        expect(shuffled).toHaveLength(source.length);
        expect(ids(shuffled).sort()).toEqual(ids(source).sort());
        expect(new Set(ids(shuffled)).size).toBe(source.length);
    });

    test('repeats exactly for the same seed', () => {
        expect(ids(R.seededShuffle(articles(), 'seed-a')))
            .toEqual(ids(R.seededShuffle(articles(), 'seed-a')));
    });

    test('differs for a different seed', () => {
        expect(ids(R.seededShuffle(articles(), 'seed-a')))
            .not.toEqual(ids(R.seededShuffle(articles(), 'seed-b')));
    });

    test('does not mutate the caller’s array', () => {
        const source = articles(10);
        const before = ids(source);
        R.seededShuffle(source, 'seed');
        expect(ids(source)).toEqual(before);
    });

    test('actually moves things — not a near-identity ordering', () => {
        const source = articles();
        const moved = ids(R.seededShuffle(source, 'seed-a'))
            .filter((id, i) => id !== source[i].id).length;
        expect(moved).toBeGreaterThan(source.length * 0.8);
    });

    test('empty and single-item listings are returned as-is', () => {
        expect(R.seededShuffle([], 'seed')).toEqual([]);
        expect(R.seededShuffle([{ id: 'only' }], 'seed')).toEqual([{ id: 'only' }]);
    });

    test('a seed hashing to zero still shuffles', () => {
        // xorshift is stuck at zero forever; the implementation forces non-zero.
        const empty = R.seededShuffle(articles(20), '');
        expect(ids(empty)).not.toEqual(ids(articles(20)));
        expect(ids(empty).sort()).toEqual(ids(articles(20)).sort());
    });
});

describe('rotateForWindow — what a category page renders', () => {
    const dayOne = new Date('2026-08-01T15:00:00Z');   // 08:00 PDT, 1 August
    const dayTwo = new Date('2026-08-02T15:00:00Z');   // 08:00 PDT, 2 August

    test('every reader on one PST day gets the same order', () => {
        // Midnight PDT and 23:30 PDT the same day — either side of a UTC date
        // boundary, which is exactly where a naive implementation would split.
        const a = R.rotateForWindow(articles(), 'covenant-identity', new Date('2026-08-01T07:00:00Z'));
        const b = R.rotateForWindow(articles(), 'covenant-identity', new Date('2026-08-02T06:30:00Z'));
        expect(ids(a)).toEqual(ids(b));
    });

    test('the order holds through the day and turns over at midnight PST', () => {
        // Morning and late evening of the same PST day are one order...
        expect(ids(R.rotateForWindow(articles(), 'covenant-identity', dayOne)))
            .toEqual(ids(R.rotateForWindow(articles(), 'covenant-identity', new Date('2026-08-02T05:00:00Z'))));
        // ...and the next day is a different one.
        expect(ids(R.rotateForWindow(articles(), 'covenant-identity', dayOne)))
            .not.toEqual(ids(R.rotateForWindow(articles(), 'covenant-identity', dayTwo)));
    });

    test('each category rotates independently', () => {
        const orders = [
            'covenant-identity',
            'teshuvah-restoration',
            'shalom-salvation',
            'celebration-mishpakhah',
            'torah-hebraic-insights',
        ].map((slug) => ids(R.rotateForWindow(articles(), slug, dayOne)).join(','));
        expect(new Set(orders).size).toBe(5);
    });

    test('the category still shows exactly its own articles', () => {
        const source = articles();
        const rotated = R.rotateForWindow(source, 'covenant-identity', dayOne);
        expect(ids(rotated).sort()).toEqual(ids(source).sort());
        for (const a of rotated) expect(a.id.startsWith('covenant-identity__')).toBe(true);
    });

    test('one order per day, and a fresh one on each day of a run', () => {
        // 15:00Z is 08:00 PDT, so each sample is mid-morning on its own PST day.
        const week = Array.from({ length: 7 }, (_, i) =>
            ids(R.rotateForWindow(articles(), 'faith', new Date(Date.UTC(2026, 7, 1 + i, 15)))).join(','));
        expect(new Set(week).size).toBe(7);
    });

    test('the four old six-hour slots now read as one order', () => {
        // 00/06/12/18 PDT on 1 August are 07/13/19Z and 01Z the next day.
        const slots = [
            new Date('2026-08-01T07:00:00Z'),
            new Date('2026-08-01T13:00:00Z'),
            new Date('2026-08-01T19:00:00Z'),
            new Date('2026-08-02T01:00:00Z'),
        ].map((t) => ids(R.rotateForWindow(articles(), 'faith', t)).join(','));
        expect(new Set(slots).size).toBe(1);
    });
});

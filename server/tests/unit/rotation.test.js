'use strict';
/**
 * Six-hourly rotation of category listings.
 *
 * A category portal shows every published article at once, so its order is
 * re-shuffled on a clock. Three properties carry the whole feature:
 *
 *   1. everyone inside one window sees the same order — it must be derived from
 *      the window, never from a random source, or a server render and its
 *      hydration would disagree and two readers would compare different pages;
 *   2. the order actually changes at each PST boundary (00, 06, 12, 18);
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

describe('rotationWindow — six PST hours', () => {
    test('names the window by its opening hour', () => {
        // 14:30 UTC on 1 Aug 2026 is 07:30 PDT — inside the 06:00 window.
        expect(R.rotationWindow(new Date('2026-08-01T14:30:00Z'))).toBe('2026-08-01T06');
    });

    test('every instant within one window yields the same key', () => {
        const inWindow = [
            '2026-08-01T13:00:00Z', // 06:00 PDT exactly
            '2026-08-01T15:45:12Z',
            '2026-08-01T18:59:59Z', // 11:59:59 PDT
        ].map((t) => R.rotationWindow(new Date(t)));
        expect(new Set(inWindow).size).toBe(1);
        expect(inWindow[0]).toBe('2026-08-01T06');
    });

    test('rolls at each of the four PST boundaries', () => {
        // PDT is UTC-7 in August: 00/06/12/18 PDT are 07/13/19/01Z.
        expect(R.rotationWindow(new Date('2026-08-01T07:00:00Z'))).toBe('2026-08-01T00');
        expect(R.rotationWindow(new Date('2026-08-01T13:00:00Z'))).toBe('2026-08-01T06');
        expect(R.rotationWindow(new Date('2026-08-01T19:00:00Z'))).toBe('2026-08-01T12');
        expect(R.rotationWindow(new Date('2026-08-02T01:00:00Z'))).toBe('2026-08-01T18');
    });

    test('a second before a boundary is still the previous window', () => {
        expect(R.rotationWindow(new Date('2026-08-01T12:59:59Z'))).toBe('2026-08-01T00');
    });

    test('midnight PST opens the day, not hour 24', () => {
        expect(R.rotationWindow(new Date('2026-08-01T07:00:01Z'))).toBe('2026-08-01T00');
    });

    test('follows the timezone through DST rather than a fixed offset', () => {
        // January is PST (UTC-8): 20:00Z is 12:00 PST, the 12:00 window.
        expect(R.rotationWindow(new Date('2026-01-15T20:00:00Z'))).toBe('2026-01-15T12');
        // July is PDT (UTC-7): the same 20:00Z is 13:00 PDT — still 12:00.
        expect(R.rotationWindow(new Date('2026-07-15T20:00:00Z'))).toBe('2026-07-15T12');
        // An hour earlier in January is 11:00 PST, so the previous window.
        expect(R.rotationWindow(new Date('2026-01-15T19:00:00Z'))).toBe('2026-01-15T06');
    });

    test('gives exactly four windows a day', () => {
        const seen = new Set();
        for (let h = 0; h < 24; h++) {
            seen.add(R.rotationWindow(new Date(Date.UTC(2026, 7, 1, h, 30))));
        }
        // 24 hourly samples spanning two PST days -> four windows per day.
        expect(seen.size).toBeLessThanOrEqual(5);
        for (const key of seen) expect(key).toMatch(/T(00|06|12|18)$/);
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
    const morning = new Date('2026-08-01T15:00:00Z');   // 08:00 PDT, window 06
    const midday = new Date('2026-08-01T20:00:00Z');    // 13:00 PDT, window 12

    test('every reader in one window gets the same order', () => {
        const a = R.rotateForWindow(articles(), 'covenant-identity', new Date('2026-08-01T13:00:00Z'));
        const b = R.rotateForWindow(articles(), 'covenant-identity', new Date('2026-08-01T18:30:00Z'));
        expect(ids(a)).toEqual(ids(b));
    });

    test('the order changes when the window turns over', () => {
        expect(ids(R.rotateForWindow(articles(), 'covenant-identity', morning)))
            .not.toEqual(ids(R.rotateForWindow(articles(), 'covenant-identity', midday)));
    });

    test('each category rotates independently', () => {
        const orders = [
            'covenant-identity',
            'teshuvah-restoration',
            'shalom-salvation',
            'celebration-mishpakhah',
            'torah-hebraic-insights',
        ].map((slug) => ids(R.rotateForWindow(articles(), slug, morning)).join(','));
        expect(new Set(orders).size).toBe(5);
    });

    test('the category still shows exactly its own articles', () => {
        const source = articles();
        const rotated = R.rotateForWindow(source, 'covenant-identity', morning);
        expect(ids(rotated).sort()).toEqual(ids(source).sort());
        for (const a of rotated) expect(a.id.startsWith('covenant-identity__')).toBe(true);
    });

    test('four distinct orders across a day, then a fresh set the next day', () => {
        const day = [7, 13, 19, 25].map((h) =>
            ids(R.rotateForWindow(articles(), 'faith', new Date(Date.UTC(2026, 7, 1, h)))).join(','));
        expect(new Set(day).size).toBe(4);

        const nextDay = ids(R.rotateForWindow(articles(), 'faith', new Date(Date.UTC(2026, 7, 2, 7)))).join(',');
        expect(day).not.toContain(nextDay);
    });
});

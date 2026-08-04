'use strict';
/**
 * Query-param clamping on the Home page feed route.
 *
 * The feed window is a month deep. Paging is what keeps a request to roughly
 * fifty cards instead of the whole corpus, so the parsing that bounds `offset`
 * and `limit` is load-bearing: without the ceiling, one crafted `?limit=100000`
 * asks the server to serialise every article it has.
 *
 * Loads the real route file and erases its types, the same way the home-feed
 * test loads the mapping module, so this cannot drift from the shipped code.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadIntParam() {
    // In lib/, not the route: a Next route module may only export the HTTP
    // handlers, and exporting a helper from one fails the production build.
    const file = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'homeFeed.ts');
    const src = fs.readFileSync(file, 'utf8');

    const fn = /export function intParam\([\s\S]*?\n}/.exec(src);
    if (!fn) throw new Error('intParam not found in route.ts — did it get renamed?');

    const js = fn[0]
        .replace(/^export\s+/, '')
        .replace(/:\s*string\s*\|\s*null/g, '')
        .replace(/:\s*number/g, '');

    const sandbox = { exports: {} };
    vm.createContext(sandbox);
    vm.runInContext(`${js}\nexports.intParam = intParam;`, sandbox);
    return sandbox.exports.intParam;
}

const intParam = loadIntParam();

const PAGE_SIZE = 50;

describe('offset parsing', () => {
    test('a plain number is taken as given', () => {
        expect(intParam('50', 0, 100000)).toBe(50);
        expect(intParam('0', 0, 100000)).toBe(0);
    });

    test('a missing or blank param falls back', () => {
        // Number(null) and Number('') are both 0, so these have to be caught
        // before the numeric guard or the fallback is silently ignored.
        expect(intParam(null, 0, 100000)).toBe(0);
        expect(intParam('', 0, 100000)).toBe(0);
        expect(intParam('   ', 0, 100000)).toBe(0);
        expect(intParam(null, 7, 100000)).toBe(7);
    });

    test.each(['abc', 'NaN', '1e', '--5', 'null', 'undefined'])(
        'garbage (%s) falls back rather than producing NaN',
        (v) => { expect(intParam(v, 0, 100000)).toBe(0); },
    );

    test('a negative offset falls back instead of slicing from the end', () => {
        // `Array.slice(-10)` would quietly return the OLDEST cards as if they
        // were the newest, which is the one wrong answer that still looks fine.
        expect(intParam('-10', 0, 100000)).toBe(0);
    });

    test('a fractional offset is floored, never left fractional', () => {
        expect(intParam('50.9', 0, 100000)).toBe(50);
    });

    test('an absurd offset is capped rather than trusted', () => {
        expect(intParam('999999999', 0, 100000)).toBe(100000);
    });

    test('Infinity is refused', () => {
        expect(intParam('Infinity', 0, 100000)).toBe(0);
    });
});

describe('limit parsing', () => {
    test('a sensible limit is honoured', () => {
        expect(intParam('25', PAGE_SIZE, 200)).toBe(25);
    });

    test('a missing limit uses the page size', () => {
        expect(intParam(null, PAGE_SIZE, 200)).toBe(PAGE_SIZE);
    });

    test('a huge limit is capped, so one request cannot pull the month', () => {
        expect(intParam('100000', PAGE_SIZE, 200)).toBe(200);
    });

    test('zero is falsy and the route substitutes the page size', () => {
        // Mirrors `intParam(...) || PAGE_SIZE` at the call site: a zero-length
        // page would make hasMore true forever and loop the client.
        const parsed = intParam('0', PAGE_SIZE, 200);
        expect(parsed).toBe(0);
        expect(parsed || PAGE_SIZE).toBe(PAGE_SIZE);
    });
});

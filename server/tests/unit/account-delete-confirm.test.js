'use strict';
/**
 * The Delete Account confirmation gate.
 *
 * Two failure modes this guards against, both of which strand a user who has
 * already decided:
 *
 *   1. A raw string comparison rejects a pasted address carrying a trailing
 *      space, and rejects an iOS-autocapitalised first letter. The destructive
 *      button simply stays dead with no explanation. The confirmation exists to
 *      prove deliberateness, not typing accuracy, and the backend trims and
 *      lowercases before comparing anyway.
 *   2. The degenerate case: if the account email has not loaded yet, an empty
 *      target must not be satisfied by an empty input — that would arm the
 *      button before the page knows whose account it is showing.
 *
 * The module is TypeScript in src/, so the test transpiles the real file rather
 * than restating the predicate. It is deliberately JSX-free for exactly this.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const SRC = path.join(
    __dirname, '..', '..', '..', 'src', 'app', '(site)', 'settings', 'deleteAccount.ts'
);

function loadModule() {
    const { outputText } = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    vm.runInNewContext(outputText, { module, exports: module.exports, require: () => ({}) });
    return module.exports;
}

const { canConfirmDeletion, deleteAccountErrorMessage } = loadModule();

const base = {
    password: 'hunter2',
    typedEmail: 'lauren@example.com',
    accountEmail: 'lauren@example.com',
    deleting: false,
};

describe('canConfirmDeletion', () => {
    test('an exact match with a password enables the button', () => {
        expect(canConfirmDeletion(base)).toBe(true);
    });

    test('an empty password never enables the button', () => {
        expect(canConfirmDeletion({ ...base, password: '' })).toBe(false);
    });

    test('a trailing space on the pasted email still matches', () => {
        expect(canConfirmDeletion({ ...base, typedEmail: 'lauren@example.com ' })).toBe(true);
    });

    test('a leading space still matches', () => {
        expect(canConfirmDeletion({ ...base, typedEmail: '  lauren@example.com' })).toBe(true);
    });

    test('an iOS-autocapitalised first letter still matches', () => {
        expect(canConfirmDeletion({ ...base, typedEmail: 'Lauren@example.com' })).toBe(true);
    });

    test('a fully upper-cased address still matches', () => {
        expect(canConfirmDeletion({ ...base, typedEmail: 'LAUREN@EXAMPLE.COM' })).toBe(true);
    });

    test('a one-character-off address does not match', () => {
        expect(canConfirmDeletion({ ...base, typedEmail: 'lauren@exampl.com' })).toBe(false);
    });

    test('another account holder\'s address does not match', () => {
        expect(canConfirmDeletion({ ...base, typedEmail: 'someone.else@example.com' })).toBe(false);
    });

    test('an empty input does not satisfy an unloaded account email', () => {
        expect(canConfirmDeletion({ ...base, typedEmail: '', accountEmail: '' })).toBe(false);
    });

    test('whitespace-only input does not satisfy an unloaded account email', () => {
        expect(canConfirmDeletion({ ...base, typedEmail: '   ', accountEmail: '   ' })).toBe(false);
    });

    test('the button is disarmed while a deletion is in flight', () => {
        expect(canConfirmDeletion({ ...base, deleting: true })).toBe(false);
    });
});

describe('deleteAccountErrorMessage', () => {
    test.each([
        [401, /password/i],
        [400, /does not match/i],
        [403, /editorial access/i],
        [409, /no password set/i],
        [501, /not available/i],
        [503, /could not confirm/i],
        [500, /nothing was deleted/i],
        [502, /nothing was deleted/i],
    ])('status %i produces an actionable message', (status, pattern) => {
        expect(deleteAccountErrorMessage({ status })).toMatch(pattern);
    });

    test('a thrown non-ApiError falls back to the house string', () => {
        expect(deleteAccountErrorMessage(new Error('boom'))).toBe('Network error');
        expect(deleteAccountErrorMessage(null)).toBe('Network error');
    });

    test('429 prefers the server message, which carries the retry window', () => {
        expect(deleteAccountErrorMessage({ status: 429, message: 'Try again in an hour.' }))
            .toBe('Try again in an hour.');
    });

    test('every non-success message reassures that nothing was deleted', () => {
        // The user's first question after a failed irreversible action is always
        // "did it half-happen?". Any status that does not say so explicitly must
        // at least not imply otherwise — these are the ones that must say it.
        for (const status of [401, 500, 502, 503]) {
            expect(deleteAccountErrorMessage({ status })).toMatch(/nothing (has been|was) deleted/i);
        }
    });
});

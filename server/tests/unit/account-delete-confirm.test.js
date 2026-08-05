'use strict';
/**
 * The Delete Account failure copy.
 *
 * The dialog asks one yes/no question, so there is no longer a confirmation gate
 * to test — the typed-address match that used to live here went with the field it
 * armed. What remains is the harder half: what the user is told when an
 * irreversible action does NOT happen.
 *
 * The rule every case below enforces is that the message answers "did it
 * half-happen?" without being asked. A person who has just pressed "Yes, delete
 * it" and seen an error assumes the worst, and a message that only describes the
 * fault leaves them there. The unmapped-status case matters most: it is the one
 * that fires for a status nobody anticipated, which is exactly when a bare
 * "Network error" would be read as "something happened and I don't know what".
 *
 * The module is TypeScript in src/, so the test transpiles the real file rather
 * than restating the strings. It is deliberately JSX-free for exactly this.
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

const { deleteAccountErrorMessage } = loadModule();

describe('deleteAccountErrorMessage', () => {
    test.each([
        [401, /session has expired/i],
        [403, /editorial access/i],
        [500, /nothing was deleted/i],
        [502, /nothing was deleted/i],
        [503, /nothing has been deleted/i],
    ])('status %i produces an actionable message', (status, pattern) => {
        expect(deleteAccountErrorMessage({ status })).toMatch(pattern);
    });

    test('401 no longer blames a password — there is no password field', () => {
        expect(deleteAccountErrorMessage({ status: 401 })).not.toMatch(/password/i);
    });

    test('a thrown non-ApiError falls back to the house string', () => {
        expect(deleteAccountErrorMessage(new Error('boom'))).toBe('Network error');
        expect(deleteAccountErrorMessage(null)).toBe('Network error');
    });

    test('429 prefers the server message, which carries the retry window', () => {
        expect(deleteAccountErrorMessage({ status: 429, message: 'Try again in an hour.' }))
            .toBe('Try again in an hour.');
    });

    test('429 without a server message still says something useful', () => {
        expect(deleteAccountErrorMessage({ status: 429 })).toMatch(/wait a few minutes/i);
    });

    test('an unmapped status is not left to the network fallback', () => {
        // 400 is unreachable from the dialog now, and that is the point: a status
        // this file does not know about must still answer the only question the
        // user is asking, rather than falling through to 'Network error'.
        for (const status of [400, 409, 418]) {
            const msg = deleteAccountErrorMessage({ status });
            expect(msg).not.toBe('Network error');
            expect(msg).toMatch(/nothing has been deleted/i);
        }
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

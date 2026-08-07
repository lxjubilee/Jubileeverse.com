'use strict';
/**
 * Read Aloud — every language the reader can pick must have a voice to read it.
 *
 * Read Aloud sends the article's language to /api/tts, which resolves it through
 * TTS_VOICE_MAP. That lookup ends in `|| TTS_VOICE_MAP['en-US']`, so a locale
 * missing from the map does not fail — it comes back as an American English
 * voice reading text that is not English. That is exactly the fault the language
 * wiring was added to fix, and it would return silently, with nothing in a log or
 * a response status to show for it.
 *
 * So the picker and the voice table are checked against each other here rather
 * than trusted to stay in step: adding a language to src/lib/languages.ts without
 * a matching voice fails this test instead of shipping.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

/** Language codes offered by the article translate widget. */
function pickerCodes() {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'languages.ts'), 'utf8');
    const body = src.slice(src.indexOf('const RAW'), src.indexOf('export const LANGUAGES'));
    return [...body.matchAll(/^\s*'([A-Za-z-]+)':/gm)].map((m) => m[1]);
}

/** TTS_VOICE_MAP as `{ code: { female, male } }`, read out of server.js. */
function voiceMap() {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
    const start = src.indexOf('const TTS_VOICE_MAP = {');
    const body = src.slice(start, src.indexOf('\n};', start));
    const map = {};
    for (const m of body.matchAll(
        /^\s*'([A-Za-z-]+)':\s*\{\s*female:\s*'([^']+)',\s*male:\s*'([^']+)'\s*\}/gm,
    )) {
        map[m[1]] = { female: m[2], male: m[3] };
    }
    return map;
}

const codes = pickerCodes();
const voices = voiceMap();

describe('the language picker and the neural voice table agree', () => {
    // A parsing slip in either helper would make the coverage test below pass
    // over an empty list and prove nothing.
    test('both sources parsed', () => {
        expect(codes.length).toBeGreaterThan(50);
        expect(Object.keys(voices).length).toBeGreaterThan(100);
        expect(codes).toContain('hi-IN');
        expect(voices['en-US']).toEqual({ female: expect.any(String), male: expect.any(String) });
    });

    test('every language offered to the reader has a voice', () => {
        const missing = codes.filter((c) => !voices[c]);
        expect(missing).toEqual([]);
    });

    test('every language has both voices, so the female/male toggle holds everywhere', () => {
        const incomplete = codes.filter((c) => !voices[c]?.female || !voices[c]?.male);
        expect(incomplete).toEqual([]);
    });

    test('the voice names belong to the locale they are filed under', () => {
        // A copy-paste slip in a 143-row table — 'ta-IN' pointing at a te-IN
        // voice — reads the article in the wrong language just as surely as a
        // missing entry does, and looks correct in every other check.
        const mismatched = codes.filter((c) => {
            const v = voices[c];
            return !v.female.startsWith(`${c}-`) || !v.male.startsWith(`${c}-`);
        });
        expect(mismatched).toEqual([]);
    });
});

'use strict';
/**
 * Read Aloud — the word highlight's timing and word-finding.
 *
 * The backend returns one MP3 per paragraph and no word boundaries, so where the
 * voice is inside a paragraph can only be estimated. These are the rules that
 * estimate it: which words a paragraph has, how long to hold each one, and where
 * to rejoin when the highlight starts against audio already in progress.
 *
 * Driven through the real module, with the DOM half (turning offsets into
 * Ranges) left to the component — everything worth getting wrong is here.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load src/lib/readAloudWords.ts as CommonJS, with types erased. */
function loadWords() {
    const file = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'readAloudWords.ts');
    const src = fs.readFileSync(file, 'utf8')
        .replace(/^export interface[\s\S]*?^}/gm, '')             // WordSpan
        .replace(/\(text:\s*string\)\s*:\s*WordSpan\[\]/, '(text)')
        .replace(/\(text:\s*string,\s*limit:\s*number\)\s*:\s*string\[\]/, '(text, limit)')
        .replace(/const pieces:\s*string\[\]/, 'const pieces')
        .replace(/\(part:\s*string\)/, '(part)')
        .replace(/\(remainingMs:\s*number,\s*wordsLeft:\s*number,\s*rate:\s*number\)\s*:\s*number/, '(remainingMs, wordsLeft, rate)')
        .replace(/\(currentTime:\s*number,\s*duration:\s*number,\s*wordCount:\s*number\)\s*:\s*number/, '(currentTime, duration, wordCount)')
        .replace(/const spans:\s*WordSpan\[\]/, 'const spans')
        .replace(/let m:\s*RegExpExecArray \| null;/, 'let m;')
        .replace(/\bexport\s+/g, '');

    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(
        `${src}\n;__out = { wordOffsets, wordDelayMs, wordIndexAt, sentenceChunks };`,
        sandbox,
    );
    return sandbox.__out;
}

const { wordOffsets, wordDelayMs, wordIndexAt, sentenceChunks } = loadWords();

/** The words a paragraph yields, as text, for readable assertions. */
const words = (text) => wordOffsets(text).map((s) => text.slice(s.start, s.end));

describe('finding the words in a paragraph', () => {
    test('an English sentence splits on its spaces', () => {
        expect(words('The committee will vote.')).toEqual(['The', 'committee', 'will', 'vote.']);
    });

    test('offsets point at the original text, so a range can be built from them', () => {
        const text = 'The committee will vote.';
        expect(wordOffsets(text)[1]).toEqual({ start: 4, end: 13 });
        expect(text.slice(4, 13)).toBe('committee');
    });

    test('newlines and runs of spaces are not words', () => {
        expect(words('  one\n\n two   three \n')).toEqual(['one', 'two', 'three']);
    });

    test('an empty or blank paragraph yields nothing to highlight', () => {
        expect(wordOffsets('')).toEqual([]);
        expect(wordOffsets('   \n  ')).toEqual([]);
    });

    test('Devanagari splits on its spaces like any other spaced script', () => {
        // The article that prompted the language work reads in Hindi, so the
        // highlight has to advance through it word by word too.
        expect(words('सीनेट होमलैंड सिक्योरिटी')).toEqual(['सीनेट', 'होमलैंड', 'सिक्योरिटी']);
    });

    test('punctuation stays attached rather than becoming its own step', () => {
        expect(words('"Yes," he said — plainly.')).toEqual(['"Yes,"', 'he', 'said', '—', 'plainly.']);
    });
});

describe('cutting a paragraph into what gets synthesized', () => {
    // This replaced a truncation: a segment over the cap was sliced and the rest
    // silently dropped, so a long paragraph was read up to a point and no
    // further. Nothing may be lost now.
    const sentences = (n) =>
        Array.from({ length: n }, (_, i) => `This is sentence number ${i} of the paragraph.`).join(' ');

    test('a paragraph within the limit is left as one piece', () => {
        expect(sentenceChunks('One sentence. And a second.', 1800))
            .toEqual(['One sentence. And a second.']);
    });

    test('a long paragraph is split rather than cut short', () => {
        const long = sentences(120);
        expect(long.length).toBeGreaterThan(1800);
        const pieces = sentenceChunks(long, 1800);

        expect(pieces.length).toBeGreaterThan(1);
        // Every word survives — this is the whole point of the change.
        expect(pieces.join(' ')).toBe(long);
        expect(pieces.every((p) => p.length <= 1800)).toBe(true);
    });

    test('it breaks between sentences, not mid-sentence', () => {
        const pieces = sentenceChunks(sentences(120), 1800);
        for (const piece of pieces) {
            expect(piece).toMatch(/[.!?…।。！？]$/);
        }
    });

    test('Hindi breaks on its danda', () => {
        const hindi = Array.from({ length: 60 }, () => 'यह वाक्य संख्या है और यह पर्याप्त लंबा है।').join(' ');
        const pieces = sentenceChunks(hindi, 400);
        expect(pieces.length).toBeGreaterThan(1);
        expect(pieces.join(' ')).toBe(hindi);
        expect(pieces.every((p) => p.endsWith('।'))).toBe(true);
    });

    test('a sentence longer than the whole limit falls back to word breaks', () => {
        const runOn = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
        const pieces = sentenceChunks(runOn, 300);

        expect(pieces.join(' ')).toBe(runOn);
        expect(pieces.every((p) => p.length <= 300)).toBe(true);
        // No word was split down the middle.
        expect(pieces.join(' ').split(/\s+/)).toHaveLength(200);
    });

    test('a single unbroken run longer than the limit is cut, because it must be', () => {
        const pieces = sentenceChunks('x'.repeat(700), 300);
        expect(pieces).toEqual(['x'.repeat(300), 'x'.repeat(300), 'x'.repeat(100)]);
        expect(pieces.join('')).toHaveLength(700);
    });

    test('empty and blank input produce nothing to say', () => {
        expect(sentenceChunks('', 1800)).toEqual([]);
        expect(sentenceChunks('   \n ', 1800)).toEqual([]);
    });

    test('the word counts of the pieces add up to the paragraph', () => {
        // The word highlight gives each piece a slice of the block's words, so a
        // piece that miscounted would light the wrong words for the rest of the
        // paragraph.
        const long = sentences(120);
        const total = wordOffsets(long).length;
        const summed = sentenceChunks(long, 1800)
            .reduce((n, piece) => n + wordOffsets(piece).length, 0);
        expect(summed).toBe(total);
    });
});

describe('how long each word is held', () => {
    test('the remaining audio is divided among the words still to say', () => {
        // 10 seconds left, 40 words to go: a quarter-second each.
        expect(wordDelayMs(10_000, 40, 1)).toBe(250);
    });

    test('a word that ran long is paid for by the words after it', () => {
        // Same 40 words, but only 4 seconds of audio left — the highlight has
        // fallen behind, and catches up rather than finishing late.
        expect(wordDelayMs(4_000, 40, 1)).toBe(100);
        expect(wordDelayMs(4_000, 40, 1)).toBeLessThan(wordDelayMs(10_000, 40, 1));
    });

    test('playback speed shortens the wait, because it shortens the audio', () => {
        // The audio element reports media time; 10s of it takes 5s to hear at 2x.
        expect(wordDelayMs(10_000, 40, 2)).toBe(125);
        expect(wordDelayMs(10_000, 40, 1.25)).toBe(200);
    });

    test('words never flash past faster than they can be read', () => {
        // A paragraph ending in silence would otherwise run the last words
        // through in a blur.
        expect(wordDelayMs(100, 400, 1)).toBe(80);
        expect(wordDelayMs(10, 400, 2)).toBe(80);
    });

    test('before the duration is known, a steady pace stands in', () => {
        // `audio.duration` is NaN until metadata loads, which is exactly when the
        // first word of a segment is highlighted.
        expect(wordDelayMs(NaN, 40, 1)).toBe(250);
        expect(wordDelayMs(Infinity, 40, 1)).toBe(250);
        expect(wordDelayMs(NaN, 40, 2)).toBe(125);
    });

    test('the last word does not divide by zero', () => {
        expect(wordDelayMs(5_000, 0, 1)).toBe(250);
        expect(Number.isFinite(wordDelayMs(5_000, 0, 1))).toBe(true);
    });

    test('a nonsense rate falls back to real time rather than to NaN', () => {
        expect(wordDelayMs(10_000, 40, 0)).toBe(250);
        expect(wordDelayMs(10_000, 40, NaN)).toBe(250);
    });
});

describe('rejoining audio already in progress', () => {
    // Resuming from a pause, or seeking into the middle of a paragraph: the
    // highlight has to land beside the voice, not at the top of the paragraph.
    test('halfway through the audio is halfway through the words', () => {
        expect(wordIndexAt(5, 10, 40)).toBe(20);
    });

    test('the start of a paragraph is its first word', () => {
        expect(wordIndexAt(0, 10, 40)).toBe(0);
    });

    test('the very end still points at a real word', () => {
        expect(wordIndexAt(10, 10, 40)).toBe(39);
        expect(wordIndexAt(99, 10, 40)).toBe(39);
    });

    test('an unknown duration starts at the beginning instead of guessing', () => {
        expect(wordIndexAt(3, NaN, 40)).toBe(0);
        expect(wordIndexAt(3, 0, 40)).toBe(0);
    });

    test('a paragraph with no words has no index to land on', () => {
        expect(wordIndexAt(5, 10, 0)).toBe(0);
    });
});

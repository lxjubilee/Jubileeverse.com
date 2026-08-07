'use strict';
/**
 * Translation artifacts — the wrapper a model puts around its own answer.
 *
 * The reported fault: a Hindi article opened with a link reading
 * "budget:token_budget" in front of its first sentence. The translator had
 * returned the whole body inside <budget:token_budget>…</budget:token_budget>,
 * the endpoint stored it, and every later reader was served the cached copy.
 *
 * The first test runs the real captured response. The rest fence the strip in:
 * it has to remove debris without touching HTML articles or markdown autolinks,
 * which share the artifact's shape.
 */

const {
    stripTranslationArtifacts,
    stripContentLabel,
    isArtifactTag,
    isImplausiblyShort,
} = require('../../lib/translation-artifacts');

/** The body as it came back from the model, abridged in the middle. */
const REPORTED = [
    '<budget:token_budget>',
    'सीनेट होमलैंड सिक्योरिटी और गवर्नमेंटल अफेयर्स कमेटी गुरुवार को पूर्व शीर्ष स्वास्थ्य अधिकारी डॉ. एंथनी फॉची को कांग्रेस की अवमानना में पकड़ने के लिए एक संकल्प पर वोट देने के लिए निर्धारित है।',
    '',
    'ईसाई पाठकों के लिए, यह एक प्रक्रियात्मक कहानी से अधिक है।',
    '</budget:token_budget>',
].join('\n');

describe('the reported article', () => {
    test('opens on its first sentence, not on the wrapper', () => {
        const cleaned = stripTranslationArtifacts(REPORTED);

        expect(cleaned.startsWith('सीनेट होमलैंड')).toBe(true);
        expect(cleaned).not.toMatch(/budget:token_budget/);
        expect(cleaned).not.toMatch(/[<>]/);
    });

    test('the translation itself is kept whole', () => {
        const cleaned = stripTranslationArtifacts(REPORTED);

        expect(cleaned).toContain('डॉ. एंथनी फॉची');
        expect(cleaned).toContain('ईसाई पाठकों के लिए');
        // Two paragraphs in, two paragraphs out.
        expect(cleaned.split(/\n{2,}/)).toHaveLength(2);
    });

    test('an unclosed wrapper is removed too', () => {
        // The stream can be cut short by max_tokens, which loses the closing tag
        // but not the opening one.
        const cleaned = stripTranslationArtifacts('<budget:token_budget>\nसीनेट होमलैंड सिक्योरिटी');

        expect(cleaned).toBe('सीनेट होमलैंड सिक्योरिटी');
    });

    test('a stray closing tag on its own is removed', () => {
        expect(stripTranslationArtifacts('सीनेट होमलैंड\n</budget:token_budget>')).toBe('सीनेट होमलैंड');
    });
});

describe('a response that is debris rather than a translation', () => {
    // A second cached row was found holding exactly this and nothing else: the
    // model reported a token budget and translated none of the article.
    const DEBRIS = '<budget:token_budget>200000</budget:token_budget>';

    test('the strip alone does not rescue it — 200000 survives', () => {
        // Pinned because it is the reason the endpoint cannot decide on
        // emptiness alone. Debris that unwraps to something is still debris.
        expect(stripTranslationArtifacts(DEBRIS)).toBe('200000');
    });

    test('its length gives it away', () => {
        // The article it claimed to translate: 7,958 characters of English.
        const source = 'x'.repeat(7958);
        expect(isImplausiblyShort(stripTranslationArtifacts(DEBRIS), source)).toBe(true);
    });

    test('the real translation of that article passes', () => {
        // Measured on the same article: 7,958 chars of English came back as
        // 8,219 of Hindi. Devanagari is not shorter than its source, and no
        // language this site offers comes close to the bar.
        expect(isImplausiblyShort('य'.repeat(8219), 'x'.repeat(7958))).toBe(false);
    });

    test('a terse language is still a translation, not debris', () => {
        // Chinese is the compact end of the range — well clear of a tenth.
        expect(isImplausiblyShort('字'.repeat(2400), 'x'.repeat(7958))).toBe(false);
    });

    test('a wrapper with nothing inside strips to empty, and empty never passes', () => {
        expect(stripTranslationArtifacts('<budget:token_budget></budget:token_budget>')).toBe('');
        expect(isImplausiblyShort('', 'x'.repeat(7958))).toBe(true);
    });

    test('an empty original is not used to justify an empty translation', () => {
        expect(isImplausiblyShort('', '')).toBe(true);
        expect(isImplausiblyShort('Hola', '')).toBe(false);
    });
});

describe('wrappers a model might invent instead', () => {
    test.each([
        ['<translation>', '<translation>Hola mundo</translation>'],
        ['<output>', '<output>Hola mundo</output>'],
        ['<result>', '<result>\nHola mundo\n</result>'],
        ['namespaced', '<claude:response>Hola mundo</claude:response>'],
        ['underscored', '<final_answer>Hola mundo</final_answer>'],
    ])('%s is unwrapped', (_label, input) => {
        expect(stripTranslationArtifacts(input)).toBe('Hola mundo');
    });

    test('a doubly wrapped answer is unwrapped to the end', () => {
        expect(stripTranslationArtifacts('<output><translation>Hola mundo</translation></output>'))
            .toBe('Hola mundo');
    });
});

describe('real article content is left alone', () => {
    test('an HTML body is not unwrapped', () => {
        // Stored editorial articles are raw HTML and ArticleReader renders them
        // verbatim. Treating <div> as debris would dismantle the document.
        const html = '<div><p>Hola mundo</p><p>Segundo párrafo</p></div>';
        expect(stripTranslationArtifacts(html)).toBe(html);
    });

    test('block tags throughout a body survive', () => {
        const html = '<h2>Título</h2>\n<p>Uno</p>\n<blockquote>Dos</blockquote>\n<ul><li>Tres</li></ul>';
        expect(stripTranslationArtifacts(html)).toBe(html);
    });

    test('markdown is returned unchanged apart from trimming', () => {
        const md = '## Título\n\nHola mundo, con **énfasis**.\n\n- uno\n- dos';
        expect(stripTranslationArtifacts(`\n${md}\n`)).toBe(md);
    });

    test('an article that happens to discuss 1 < 2 keeps its text', () => {
        const text = 'El presupuesto subió: 1 < 2 y 3 > 2.';
        expect(stripTranslationArtifacts(text)).toBe(text);
    });
});

describe('autolinks are links, not debris', () => {
    // These share the artifact's exact shape — <scheme:rest> — which is why the
    // reported tag rendered as a link in the first place. Deleting them would
    // trade one visible bug for a silently broken reference.
    test.each([
        '<https://example.org/story>',
        '<http://example.org>',
        '<mailto:someone@example.org>',
        '<tel:+15551234567>',
        '<ftp://files.example.org/pub>',
    ])('%s is kept', (link) => {
        expect(stripTranslationArtifacts(`Véase ${link} para más.`)).toBe(`Véase ${link} para más.`);
    });

    test('the classifier separates the two cases', () => {
        expect(isArtifactTag('budget:token_budget')).toBe(true);
        expect(isArtifactTag('final_answer')).toBe(true);
        expect(isArtifactTag('mailto:someone@example.org')).toBe(false);
        expect(isArtifactTag('https://example.org')).toBe(false);
        expect(isArtifactTag('p')).toBe(false);
    });
});

describe('the CONTENT: label', () => {
    // The Arabic translation of the same article opened on the word CONTENT:.
    // The endpoint frames the body it sends with that label and asks only for
    // TITLE:/SOURCE:/CATEGORY: back, so the parser had no reason to expect it —
    // and a model shown the label answers with it.
    const ARABIC = 'لأنه هكذا أحب الله العالم حتى بذل ابنه الوحيد.';

    test('a label on its own line goes, and the body starts on its first sentence', () => {
        const cleaned = stripTranslationArtifacts(`CONTENT:\n${ARABIC}`);

        expect(cleaned).toBe(ARABIC);
        expect(cleaned).not.toMatch(/CONTENT/);
    });

    test('a label run into the first sentence goes', () => {
        expect(stripTranslationArtifacts(`CONTENT: ${ARABIC}`)).toBe(ARABIC);
    });

    test.each([
        ['bolded by a markdown-minded translator', `**CONTENT:**\n${ARABIC}`],
        ['lowercased', `content:\n${ARABIC}`],
        ['spaced before the colon', `CONTENT :\n${ARABIC}`],
        ['with trailing spaces on the line', `CONTENT:   \n${ARABIC}`],
    ])('%s goes too', (_label, raw) => {
        expect(stripTranslationArtifacts(raw)).toBe(ARABIC);
    });

    test('a label inside a wrapper the model invented goes with it', () => {
        const raw = `<final_answer>\nCONTENT:\n${ARABIC}\n</final_answer>`;
        expect(stripTranslationArtifacts(raw)).toBe(ARABIC);
    });

    test('a label in front of a wrapper goes as well', () => {
        const raw = `CONTENT:\n<final_answer>\n${ARABIC}\n</final_answer>`;
        expect(stripTranslationArtifacts(raw)).toBe(ARABIC);
    });

    // Anchored at the start for this reason: the word is only debris where the
    // first sentence belongs.
    test('the word is kept where an article genuinely uses it', () => {
        const text = 'La plataforma advierte: CONTENT: no es un campo válido aquí.';
        expect(stripTranslationArtifacts(text)).toBe(text);
    });

    test('a body that never carried the label is untouched', () => {
        expect(stripContentLabel(ARABIC)).toBe(ARABIC);
        expect(stripTranslationArtifacts(ARABIC)).toBe(ARABIC);
    });
});

describe('inputs that are not text', () => {
    test.each([
        ['empty', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 42],
    ])('%s is passed through rather than thrown on', (_label, value) => {
        expect(stripTranslationArtifacts(value)).toBe(value);
    });
});

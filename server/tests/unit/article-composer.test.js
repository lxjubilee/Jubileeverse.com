'use strict';
/**
 * The compose contract: schema shape, prompt assembly, and the deterministic
 * quality gate.
 *
 * This module had no test at all, which mattered the moment the image-prompt
 * field came out of the schema — there was nothing to catch the prompt-cache
 * breakpoint being orphaned along with it, and nothing to notice if a required
 * field went missing. Pure only: no network, no credentials.
 */

const C = require('../../lib/article-composer');

/** A composition that passes every rule, as the baseline to break. */
const good = (over = {}) => ({
    title: 'Federal Court Rules on Church Zoning',
    slug: 'federal-court-rules-on-church-zoning',
    introduction: 'A ruling landed on Tuesday. '.repeat(12),
    body: `## What happened\n\n${'The court issued its decision and the congregation responded. '.repeat(120)}`,
    marketing_summary: 'A federal court sided with the congregation on Tuesday.',
    faith_relevance_analysis: `${'The passage speaks to patience under pressure. '.repeat(30)} Romans 12:12`,
    scripture_refs: ['Romans 12:12'],
    facts_used: [0, 1],
    ...over,
});

const sheet = (over = {}) => ({
    headline: 'Federal court rules on church zoning',
    source_name: 'Example News',
    source_url: 'https://example.com/a',
    published_at: '2026-07-31',
    byline: '',
    lede: 'A federal court ruled on Tuesday.',
    confidence: 'full',
    key_facts: ['a', 'b', 'c'],
    quotes: [],
    corroborating_sources: [],
    ...over,
});

describe('composeSchema', () => {
    const schema = C.composeSchema();

    test('requires exactly the eight fields the article is built from', () => {
        expect(schema.required).toEqual([
            'title', 'slug', 'introduction', 'body', 'marketing_summary',
            'faith_relevance_analysis', 'scripture_refs', 'facts_used',
        ]);
    });

    test('every required field is actually declared', () => {
        for (const field of schema.required) {
            expect(schema.properties[field]).toBeDefined();
        }
    });

    test('no longer asks for image prompts', () => {
        // The pictures come from the originating outlet now. Asking for three
        // 3-4 sentence prompts per article bought ~300 output tokens of text
        // that nothing reads, and a malformed set cost a whole repair round.
        expect(schema.properties.image_prompts).toBeUndefined();
        expect(schema.required).not.toContain('image_prompts');
    });

    test('refuses fields it did not ask for', () => {
        expect(schema.additionalProperties).toBe(false);
    });
});

describe('buildComposeParams — prompt caching', () => {
    const params = C.buildComposeParams({
        factSheet: sheet(),
        topic: 'church-us',
        writer: 'JubileeVerse Newsroom',
        sourceUrl: 'https://example.com/a',
    });

    test('the house style carries the cache breakpoint', () => {
        // Caching is a prefix match up to the breakpoint. It used to sit on the
        // image-prompt block that followed HOUSE_STYLE; deleting that block
        // without moving the marker would silently uncache the house style and
        // make every article pay full price for it.
        const cached = params.system.filter(b => b.cache_control);
        expect(cached).toHaveLength(1);
        expect(cached[0].text).toBe(C.HOUSE_STYLE);
    });

    test('the breakpoint is on the LAST system block, or it caches nothing useful', () => {
        expect(params.system[params.system.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    });

    test('the volatile half stays out of the cached prefix', () => {
        const systemText = params.system.map(b => b.text).join('\n');
        expect(systemText).not.toContain('https://example.com/a');
        expect(params.messages[0].content).toContain('https://example.com/a');
    });

    test('asks for the schema it declares', () => {
        expect(params.output_config.format.type).toBe('json_schema');
        expect(params.output_config.format.schema.required).toEqual(C.composeSchema().required);
    });
});

describe('buildComposeUserContent', () => {
    test('tells the model not to restate the source URL', () => {
        // A model asked to produce a source URL invents one, and a fabricated
        // source is the worst thing this pipeline could publish.
        const out = C.buildComposeUserContent({
            factSheet: sheet(), topic: 't', writer: 'W', sourceUrl: 'https://example.com/a',
        });
        expect(out).toMatch(/do not restate or alter this/i);
    });

    test('caps the recent-headline list so the prompt cannot grow without bound', () => {
        const titles = Array.from({ length: 60 }, (_, i) => `Headline number ${i}`);
        const out = C.buildComposeUserContent({
            factSheet: sheet(), topic: 't', writer: 'W', sourceUrl: 'u', recentTitles: titles,
        });
        expect(out).toContain('Headline number 24');
        expect(out).not.toContain('Headline number 25');
    });
});

describe('validateComposed', () => {
    test('accepts a well-formed article', () => {
        const out = C.validateComposed(good(), { factSheet: sheet() });
        expect(out.errors).toEqual([]);
        expect(out.ok).toBe(true);
    });

    test('a missing field is reported before anything else runs', () => {
        const out = C.validateComposed(good({ body: '' }), { factSheet: sheet() });
        expect(out.ok).toBe(false);
        expect(out.errors).toEqual(['missing body']);
    });

    test.each([
        ['an em dash', { introduction: 'A ruling — landed. '.repeat(12) }, /em dash/],
        ['"Pastor"', { introduction: 'The Pastor spoke plainly today. '.repeat(10) }, /Pastor/],
        ['an H1 in the body', { body: `# Heading\n\n${'word '.repeat(800)}` }, /H1/],
        ['a hashtag in the summary', { marketing_summary: 'A ruling landed #faith' }, /hashtag/],
    ])('rejects %s', (_label, over, pattern) => {
        const out = C.validateComposed(good(over), { factSheet: sheet() });
        expect(out.ok).toBe(false);
        expect(out.errors.join(' ')).toMatch(pattern);
    });

    test('rejects refusal language wherever it appears', () => {
        const out = C.validateComposed(
            good({ faith_relevance_analysis: `I cannot help with that. ${'text '.repeat(60)} Romans 12:12` }),
            { factSheet: sheet() },
        );
        expect(out.errors.join(' ')).toMatch(/refusal language/);
    });

    test('requires a scripture citation in the faith analysis', () => {
        const out = C.validateComposed(
            good({ faith_relevance_analysis: 'Faithful reflection without a citation. '.repeat(20) }),
            { factSheet: sheet() },
        );
        expect(out.errors.join(' ')).toMatch(/Book Chapter:Verse/);
    });

    test('a full fact sheet with no facts cited is a hard reject', () => {
        // The grounding check this whole module exists for: an article that
        // used none of the facts wrote from the model's own priors.
        const out = C.validateComposed(good({ facts_used: [] }), { factSheet: sheet({ confidence: 'full' }) });
        expect(out.ok).toBe(false);
        expect(out.errors.join(' ')).toMatch(/facts_used is empty/);
    });

    test('a headline-only sheet is allowed to cite nothing', () => {
        const out = C.validateComposed(good({ facts_used: [] }), {
            factSheet: sheet({ confidence: 'headline_only', key_facts: [] }),
        });
        expect(out.ok).toBe(true);
    });

    test('an out-of-range fact index warns rather than rejecting', () => {
        const out = C.validateComposed(good({ facts_used: [0, 99] }), { factSheet: sheet() });
        expect(out.ok).toBe(true);
        expect(out.warnings.join(' ')).toMatch(/out-of-range/);
    });

    test('a short body is rejected, a long one only warned about', () => {
        const short = C.validateComposed(good({ body: 'word '.repeat(50) }), { factSheet: sheet() });
        expect(short.ok).toBe(false);

        const long = C.validateComposed(good({ body: `## H\n\n${'word '.repeat(C.WORD_CEILING + 100)}` }), { factSheet: sheet() });
        expect(long.ok).toBe(true);
        expect(long.warnings.join(' ')).toMatch(/body long/);
    });

    test('image prompts are no longer required for an article to pass', () => {
        const out = C.validateComposed(good(), { factSheet: sheet() });
        expect(out.ok).toBe(true);
        expect(out.errors.join(' ')).not.toMatch(/image prompt/);
    });
});

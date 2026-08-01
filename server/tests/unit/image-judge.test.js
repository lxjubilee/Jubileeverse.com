'use strict';
/**
 * Best-of-N selection, the rubric contract, and the escalating retry.
 *
 * The judge needs a vision model and the renderer needs a GPU, and CI has
 * neither — so `produceImage` takes both as injected dependencies, and these
 * tests drive the real pipeline with a fake renderer and a fake Anthropic
 * client. Everything except the network call is the production path: the
 * structural gate really runs, the ranking arithmetic really runs, and the
 * escalation ladder really advances.
 */

const sharp = require('sharp');
const Judge = require('../../lib/image-judge');

/** A render that passes the structural gate: noise is sharp and high-contrast. */
function usableImage(seed = 1) {
    return sharp({
        create: {
            width: 320, height: 200, channels: 3,
            background: { r: 40, g: 60, b: 80 },
            noise: { type: 'gaussian', mean: 128, sigma: 55 + (seed % 5) },
        },
    }).png().toBuffer();
}

/** A render the structural gate rejects: flat grey has no contrast and no edges. */
function flatImage() {
    return sharp({
        create: { width: 320, height: 200, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).png().toBuffer();
}

/** Marks for one candidate, defaulting to a comfortable pass. */
const rubric = (over = {}) => ({
    anatomy: 8, artifacts: 8, relevance: 8, realism: 8,
    composition: 8, editorial_suitability: 8, publishable: true, notes: '', ...over,
});

/** An Anthropic client stand-in that returns a scripted verdict per call. */
function fakeClient(verdicts) {
    const calls = [];
    const queue = [...verdicts];
    return {
        calls,
        messages: {
            async create(params) {
                calls.push(params);
                const body = queue.length > 1 ? queue.shift() : queue[0];
                return {
                    stop_reason: 'end_turn',
                    content: [{ type: 'text', text: JSON.stringify(body) }],
                    usage: { input_tokens: 10, output_tokens: 5 },
                };
            },
        },
    };
}

const quiet = { log() {}, warn() {} };

describe('rubric weighting', () => {
    test('the weights sum to one, so a mark is a 0-100 score', () => {
        const total = Object.values(Judge.WEIGHTS).reduce((a, b) => a + b, 0);
        expect(total).toBeCloseTo(1, 6);
    });

    test('a perfect card scores 100 and a zero scores 0', () => {
        const perfect = Object.fromEntries(Judge.DIMENSIONS.map(d => [d, 10]));
        const worst = Object.fromEntries(Judge.DIMENSIONS.map(d => [d, 0]));
        expect(Judge.weightedScore(perfect)).toBe(100);
        expect(Judge.weightedScore(worst)).toBe(0);
    });

    test('anatomy moves the score more than any other dimension', () => {
        const others = Judge.DIMENSIONS.filter(d => d !== 'anatomy');
        for (const d of others) {
            expect(Judge.WEIGHTS.anatomy).toBeGreaterThan(Judge.WEIGHTS[d]);
        }
    });

    test('out-of-range and missing marks are clamped rather than trusted', () => {
        expect(Judge.weightedScore({ anatomy: 99, artifacts: -5 })).toBeLessThanOrEqual(100);
        expect(Judge.weightedScore({})).toBe(0);
        expect(Judge.weightedScore({ anatomy: 'nonsense' })).toBe(0);
    });
});

describe('normalising the judge response', () => {
    test('a candidate the model skipped is not treated as a pass', () => {
        const out = Judge.normaliseRubrics({ candidates: [rubric()] }, 3);
        expect(out).toHaveLength(3);
        expect(out[0].publishable).toBe(true);
        expect(out[1].publishable).toBe(false);
        expect(out[1].notes).toMatch(/no verdict/);
    });

    test('publishable defaults to true only when the model actually answered', () => {
        const out = Judge.normaliseRubrics({ candidates: [{ anatomy: 9 }] }, 1);
        expect(out[0].publishable).toBe(true);
        expect(out[0].score).toBe(Math.round(9 * Judge.WEIGHTS.anatomy * 10));
    });
});

describe('selection', () => {
    const candidates = [
        { index: 0, structural: { ok: true, score: 100 } },
        { index: 1, structural: { ok: true, score: 90 } },
        { index: 2, structural: { ok: true, score: 80 } },
    ];

    test('the highest weighted mark wins, not the model’s own pick', () => {
        const judgement = {
            rubrics: [rubric({ anatomy: 4 }), rubric({ anatomy: 10 }), rubric({ anatomy: 6 })]
                .map(r => ({ ...r, score: Judge.weightedScore(r) })),
            best: 1,   // the model prefers candidate 1 (index 0)
        };
        const { winner } = Judge.selectWinner(candidates, judgement);
        expect(winner.index).toBe(1);
    });

    test('an unpublishable candidate never wins, however high it marks', () => {
        const judgement = {
            rubrics: [
                { ...rubric({ publishable: false }), score: 100 },
                { ...rubric(), score: 80 },
            ],
        };
        const { winner } = Judge.selectWinner(candidates.slice(0, 2), judgement);
        expect(winner.index).toBe(1);
    });

    test('everything below the bar produces no winner, which is what triggers a retry', () => {
        const judgement = { rubrics: [{ ...rubric(), score: 40 }, { ...rubric(), score: 55 }] };
        // mode is explicit so this asserts the rule, not the shipped default —
        // which moved from enforce to warn once the evaluation showed nothing
        // reached the bar.
        const { winner, reason } = Judge.selectWinner(
            candidates.slice(0, 2), judgement, { minScore: 70, mode: 'enforce' },
        );
        expect(winner).toBeNull();
        expect(reason).toMatch(/no candidate/);
    });

    test('warn mode ranks but never withholds', () => {
        const judgement = { rubrics: [{ ...rubric(), score: 10 }, { ...rubric(), score: 20 }] };
        const { winner } = Judge.selectWinner(candidates.slice(0, 2), judgement, { mode: 'warn' });
        expect(winner.index).toBe(1);
    });

    test('warn mode still prefers an image the judge would actually run', () => {
        // "Do not withhold" is not "ignore the verdict": a refused candidate
        // must not outrank an accepted one on score alone.
        const judgement = {
            rubrics: [
                { ...rubric({ publishable: false }), score: 95 },
                { ...rubric({ publishable: true }), score: 30 },
            ],
        };
        const { winner } = Judge.selectWinner(candidates.slice(0, 2), judgement, { mode: 'warn' });
        expect(winner.index).toBe(1);
    });

    test('the model breaks a genuine tie, after anatomy', () => {
        const tied = [{ ...rubric(), score: 80 }, { ...rubric(), score: 80 }];
        expect(Judge.selectWinner(candidates.slice(0, 2), { rubrics: tied, best: 2 }).winner.index).toBe(1);
        expect(Judge.selectWinner(candidates.slice(0, 2), { rubrics: tied, best: 1 }).winner.index).toBe(0);
    });

    test('without a judge it falls back to the structural ranking', () => {
        const { winner, reason } = Judge.selectStructuralOnly([
            { index: 0, structural: { ok: true, score: 70 } },
            { index: 1, structural: { ok: true, score: 95 } },
            { index: 2, structural: { ok: false, score: 100 } },  // failed the gate
        ]);
        expect(winner.index).toBe(1);
        expect(reason).toMatch(/judge unavailable/);
    });
});

describe('escalation', () => {
    const base = 'Two volunteers handing out boxes at a community centre.';

    test('round 0 sends the prompt exactly as written', () => {
        expect(Judge.escalatePrompt(base, 0)).toBe(base);
    });

    test('round 1 changes the composition rather than only the seed', () => {
        const r1 = Judge.escalatePrompt(base, 1);
        expect(r1).toContain(base);
        expect(r1).toMatch(/camera angle|composition/i);
        expect(r1).toMatch(/hands/i);
    });

    test('round 2 removes people, the one fix that cannot fail on anatomy', () => {
        const r2 = Judge.escalatePrompt(base, 2);
        expect(r2).toMatch(/NO people/i);
        expect(r2).toMatch(/no faces|no hands/i);
    });
});

describe('the request sent to the judge', () => {
    const candidates = [
        { judgeBuffer: Buffer.from('RIFF0000WEBPxx'), prompt: 'a newsroom at dawn' },
        { judgeBuffer: Buffer.from('RIFF0000WEBPxx') },
    ];
    const params = Judge.buildJudgeParams(candidates, { article: { title: 'Food bank opens', topic: 'community' } });

    test('every candidate is shown, each labelled', () => {
        const images = params.messages[0].content.filter(b => b.type === 'image');
        expect(images).toHaveLength(2);
        const labels = params.messages[0].content.filter(b => b.type === 'text' && /^Candidate \d:/.test(b.text));
        expect(labels).toHaveLength(2);
    });

    test('the story reaches the judge, since relevance is a scored dimension', () => {
        const text = params.messages[0].content.map(b => b.text || '').join('\n');
        expect(text).toContain('Food bank opens');
        expect(text).toContain('community');
    });

    test('the rubric is cached: it is identical for every article of the night', () => {
        expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
        expect(params.system[0].text).toBe(Judge.RUBRIC);
    });

    test('it asks for structured output against the schema', () => {
        expect(params.output_config.format.type).toBe('json_schema');
        expect(params.output_config.format.schema.required).toContain('candidates');
        expect(params.model).toBe(Judge.JUDGE_MODEL);
    });
});

describe('parsing', () => {
    const body = { candidates: [rubric()], best_candidate: 1, reasoning: 'ok' };

    test('reads bare JSON, fenced JSON, and JSON with a preamble', () => {
        expect(Judge.parseJudgeResponse(JSON.stringify(body)).best_candidate).toBe(1);
        expect(Judge.parseJudgeResponse('```json\n' + JSON.stringify(body) + '\n```').best_candidate).toBe(1);
        expect(Judge.parseJudgeResponse('Here you go:\n' + JSON.stringify(body)).best_candidate).toBe(1);
    });

    test('an unparseable response raises rather than returning an empty verdict', () => {
        expect(() => Judge.parseJudgeResponse('no json here')).toThrow(/unparseable/);
        expect(() => Judge.parseJudgeResponse('')).toThrow(/empty/);
    });
});

describe('produceImage — the whole ladder', () => {
    test('picks a winner on the first round and does not escalate', async () => {
        const render = jest.fn(async (prompt, seed) => ({ buffer: await usableImage(seed), lane: null, ms: 1 }));
        const client = fakeClient([{
            candidates: [rubric({ anatomy: 5 }), rubric({ anatomy: 10 }), rubric({ anatomy: 7 })],
            best_candidate: 2,
            reasoning: 'second is cleanest',
        }]);

        const out = await Judge.produceImage({
            prompt: 'a newsroom at dawn', articleId: 'a1', render, client, logger: quiet, candidates: 3,
        });

        expect(out.image).toBeTruthy();
        expect(out.rounds).toHaveLength(1);
        expect(render).toHaveBeenCalledTimes(3);
        expect(client.calls).toHaveLength(1);
        // Round 0 must send the prompt unmodified.
        expect(render.mock.calls.every(([p]) => p === 'a newsroom at dawn')).toBe(true);
    });

    test('escalates when the judge rejects the set, and the prompt changes', async () => {
        const render = jest.fn(async (prompt, seed) => ({ buffer: await usableImage(seed), lane: null, ms: 1 }));
        const client = fakeClient([
            { candidates: [rubric({ anatomy: 1, publishable: false })], best_candidate: 0, reasoning: 'six fingers' },
            { candidates: [rubric()], best_candidate: 1, reasoning: 'clean' },
        ]);

        const out = await Judge.produceImage({
            prompt: 'a newsroom at dawn', articleId: 'a2', render, client, logger: quiet,
            candidates: 1, maxRounds: 3, mode: 'enforce',
        });

        expect(out.image).toBeTruthy();
        expect(out.rounds).toHaveLength(2);
        const prompts = render.mock.calls.map(([p]) => p);
        expect(prompts[0]).toBe('a newsroom at dawn');
        expect(prompts[1]).not.toBe(prompts[0]);
        expect(prompts[1]).toMatch(/camera angle|composition/i);
    });

    test('gives up after the bound, which is what drafts the article', async () => {
        const render = jest.fn(async (prompt, seed) => ({ buffer: await usableImage(seed), lane: null, ms: 1 }));
        const client = fakeClient([
            { candidates: [rubric({ publishable: false })], best_candidate: 0, reasoning: 'no' },
        ]);

        const out = await Judge.produceImage({
            prompt: 'a newsroom at dawn', articleId: 'a3', render, client, logger: quiet,
            candidates: 1, maxRounds: 2, mode: 'enforce',
        });

        expect(out.image).toBeNull();
        expect(out.rounds).toHaveLength(2);
        expect(out.reason).toMatch(/no publishable/);
    });

    test('a candidate that fails the structural gate never reaches the judge', async () => {
        const render = jest.fn(async () => ({ buffer: await flatImage(), lane: null, ms: 1 }));
        const client = fakeClient([{ candidates: [rubric()], best_candidate: 1, reasoning: 'ok' }]);

        const out = await Judge.produceImage({
            prompt: 'a newsroom at dawn', articleId: 'a4', render, client, logger: quiet,
            candidates: 2, maxRounds: 1,
        });

        expect(out.image).toBeNull();
        expect(client.calls).toHaveLength(0);   // no vision call paid for
        expect(out.rounds[0].structuralPassed).toBe(0);
    });

    test('an unreachable judge degrades to the structural ranking, it does not fail the run', async () => {
        const render = jest.fn(async (prompt, seed) => ({ buffer: await usableImage(seed), lane: null, ms: 1 }));
        const client = {
            messages: { create: async () => { throw new Error('ECONNRESET'); } },
        };

        const out = await Judge.produceImage({
            prompt: 'a newsroom at dawn', articleId: 'a5', render, client, logger: quiet,
            candidates: 2, maxRounds: 1,
        });

        expect(out.image).toBeTruthy();
        expect(out.reason).toMatch(/judge/);
    });

    test('a refusal is caught before the content array is read', async () => {
        const client = {
            messages: {
                async create() {
                    return { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] };
                },
            },
        };
        await expect(
            Judge.judgeCandidates([{ buffer: await usableImage(1) }], { client }),
        ).rejects.toThrow(/declined/);
    });

    test('seeds are derived, so a re-run reproduces the same candidates', async () => {
        const seeds = [];
        const render = jest.fn(async (prompt, seed) => {
            seeds.push(seed);
            return { buffer: await usableImage(seed), lane: null, ms: 1 };
        });
        const client = fakeClient([{ candidates: [rubric()], best_candidate: 1, reasoning: 'ok' }]);
        const run = () => Judge.produceImage({
            prompt: 'p', articleId: 'stable', render, client, logger: quiet, candidates: 2, maxRounds: 1,
        });

        await run();
        const first = seeds.splice(0);
        await run();
        expect(seeds).toEqual(first);
    });
});

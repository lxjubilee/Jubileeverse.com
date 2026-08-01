'use strict';
/**
 * lib/image-judge.js — Best-of-N hero selection with a Claude vision judge.
 *
 * Step 4 of docs/IMAGE-QUALITY-PIPELINE.md, plus the escalating retry from
 * Step 5, because both the nightly pipeline and the admin regeneration button
 * must run the identical path (Step 6). Anything that lives only in the
 * publishing script cannot be reached by the admin route, and the two would
 * drift the first time either was tuned.
 *
 * ── Why a judge at all ──────────────────────────────────────────────────────
 *
 * lib/image-score.js is deterministic and cheap, and it is the ruler: it counts
 * heads, hands and faces, and measures focus and contrast. What it cannot do is
 * say whether a photograph of a food bank is a photograph of *this* food-bank
 * story, or tell a candle-lit chapel apart from an underexposed render. Both
 * questions need to know what the scene is supposed to be. That is the judge's
 * job and nothing else is.
 *
 * So the two gates are ordered, not merged: an image must clear the structural
 * gate before a judge is asked about it. A two-headed candidate is not worth a
 * vision call, and paying for one on 60 articles a night adds up.
 *
 * ── Every image is gated; only the hero gets a choice ───────────────────────
 *
 * `produceImage` runs for all three roles, so nothing reaches the CDN without
 * clearing both gates. What differs is how many candidates it is given to
 * choose between: three for the hero, one for the others. The hero appears on
 * the home page, on every card, and at the top of the reader, while supporting
 * and symbolic images appear once, further down, at smaller size — rendering
 * three candidates for all three roles would triple the night's GPU time for a
 * fraction of the visible return.
 *
 * ── Scores are computed here, not taken from the model ──────────────────────
 *
 * The judge returns per-dimension marks. The ranking arithmetic runs in code,
 * so the same rubric always produces the same winner, and a bake-off comparing
 * two checkpoints is comparing the images rather than the judge's mood.
 */

const Comfy = require('./comfy-client');
const Images = require('./news-images');
const Score = require('./image-score');
const {
    imageBlock, createRotator, isAuthError, isRetryableApiError,
} = require('./anthropic-client');

// ── Configuration ────────────────────────────────────────────────────────────

/** The composer's model, so one credential and one rate limit cover both. */
const JUDGE_MODEL = process.env.NEWS_JUDGE_MODEL || 'claude-opus-5';

/**
 * Judging is a bounded visual comparison against a fixed rubric, not open
 * research, and it runs 60+ times a night. `medium` is where that lands.
 */
const JUDGE_EFFORT = process.env.NEWS_JUDGE_EFFORT || 'medium';

/**
 * enforce: an image the judge rejects is never published.
 * warn:    log the verdict and publish the best candidate anyway.
 * off:     skip the vision call; rank on the structural score alone.
 *
 * Defaults to enforce. Unlike the structural thresholds, the rubric here is a
 * judgement rather than a measurement, and the retry ladder below means a
 * rejection costs another render rather than an empty page.
 */
const MODE = (process.env.NEWS_JUDGE_MODE || 'enforce').toLowerCase();

/** Candidates rendered per hero attempt. */
const HERO_CANDIDATES = Number(process.env.NEWS_HERO_CANDIDATES || 3);

/**
 * Escalation rounds after the first. Round 0 is the prompt as written; each
 * later round changes something. Two retries is the plan's bound: a third
 * costs more GPU than the article is worth, and the draft fallback is cheap.
 */
const MAX_ROUNDS = Number(process.env.NEWS_HERO_ROUNDS || 3);

/** Weighted judge score (0-100) at or above which an image may be published. */
const MIN_JUDGE_SCORE = Number(process.env.NEWS_JUDGE_MIN || 70);

/**
 * Rubric weights. Anatomy and artifacts carry the most because they are what
 * makes a render obviously machine-made to a reader; relevance carries nearly
 * as much because an immaculate photograph of the wrong subject is still the
 * wrong photograph. They sum to 1, so the weighted mark is a 0-100 score
 * comparable with the structural gate's.
 */
const WEIGHTS = {
    anatomy: 0.28,
    artifacts: 0.20,
    relevance: 0.20,
    realism: 0.14,
    composition: 0.10,
    editorial_suitability: 0.08,
};

const DIMENSIONS = Object.keys(WEIGHTS);

class JudgeError extends Error {
    constructor(kind, message) {
        super(message);
        this.name = 'JudgeError';
        this.kind = kind;   // no_client | refusal | parse | api
    }
}

// ── Rubric ───────────────────────────────────────────────────────────────────

/**
 * The rubric. Frozen and cached: it is byte-identical for every article of the
 * night, so it sits in `system` behind a cache breakpoint rather than being
 * re-sent as fresh input 60 times.
 */
const RUBRIC = `You are the picture editor for a Christian family news publication. You are shown several candidate photographs generated for one article, and you decide which may be published.

Judge each candidate independently, then compare. Mark every dimension from 0 to 10, where 0 is unusable and 10 is indistinguishable from professional press photography.

- anatomy: hands, fingers, faces, limbs, head count. A hand with the wrong number of fingers, a fused or melted hand, a second head, a duplicated person, or a face with mismatched eyes scores 0-2 no matter how attractive the rest of the frame is. Look closely at every hand.
- artifacts: generation defects other than anatomy. Warped straight lines, nonsense text or signage, objects merging into each other, impossible reflections, garbled patterns, smeared background faces.
- relevance: does this photograph illustrate THIS article? A technically perfect image of an unrelated subject is a failure. A plain, ordinary image that clearly depicts the story is a success.
- realism: does it read as a photograph rather than an illustration or a render? Natural skin tones, plausible light, real depth of field.
- composition: framing, subject placement, and whether the subject is legible at card size. Cropped heads and limbs cut at the frame edge score low.
- editorial_suitability: would a Christian family publication run this? Modest, dignified, no violence or distress imagery, no religious iconography presented as an object of worship, no depiction of God's or Jesus's face, no identifiable public figures.

Set publishable to false for any candidate you would refuse to run, whatever its marks.

Be strict. It is cheaper to reject every candidate and re-render than to publish a defective photograph. If no candidate is publishable, say so — do not promote the least-bad one.

Return only the JSON object described by the schema.`;

/** Structured response contract. */
function rubricSchema(count) {
    const dimension = (description) => ({ type: 'integer', description: `0-10. ${description}` });
    return {
        type: 'object',
        additionalProperties: false,
        required: ['candidates', 'best_candidate', 'reasoning'],
        properties: {
            candidates: {
                type: 'array',
                description: `Exactly ${count} entries, one per candidate, in the order shown.`,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: [...DIMENSIONS, 'publishable', 'notes'],
                    properties: {
                        anatomy: dimension('Hands, fingers, faces, limbs, head count.'),
                        artifacts: dimension('Freedom from non-anatomical generation defects.'),
                        relevance: dimension('Depicts this specific article.'),
                        realism: dimension('Reads as a photograph.'),
                        composition: dimension('Framing and legibility at card size.'),
                        editorial_suitability: dimension('Fit for a Christian family publication.'),
                        publishable: { type: 'boolean', description: 'Would you run this image?' },
                        notes: { type: 'string', description: 'One sentence naming the deciding defect or strength.' },
                    },
                },
            },
            best_candidate: {
                type: 'integer',
                description: 'The 1-based candidate you would run, or 0 if none is publishable.',
            },
            reasoning: { type: 'string', description: 'Two sentences at most.' },
        },
    };
}

/** What the judge is told about the story, kept short and factual. */
function articleContext(article = {}) {
    const parts = [
        `HEADLINE: ${String(article.title || 'Untitled').slice(0, 200)}`,
        article.topic ? `TOPIC: ${article.topic}` : '',
        article.summary || article.marketing_summary
            ? `SUMMARY: ${String(article.summary || article.marketing_summary).slice(0, 400)}`
            : '',
    ];
    return parts.filter(Boolean).join('\n');
}

/**
 * One request carrying every candidate, rather than one request per candidate.
 *
 * Ranking is a comparison, and a judge that has seen all three at once ranks
 * them more consistently than three independent marks stitched together. It is
 * also one call instead of N.
 */
function buildJudgeParams(candidates, { article = {}, model = JUDGE_MODEL, effort = JUDGE_EFFORT } = {}) {
    const content = [
        { type: 'text', text: `${articleContext(article)}\n\nIMAGE PROMPT USED:\n${String(candidates[0]?.prompt || '').slice(0, 900)}` },
    ];
    candidates.forEach((c, i) => {
        content.push({ type: 'text', text: `Candidate ${i + 1}:` });
        content.push(imageBlock(c.judgeBuffer || c.buffer));
    });
    content.push({
        type: 'text',
        text: `Mark all ${candidates.length} candidates against the rubric and name the one you would publish.`,
    });

    return {
        model,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        output_config: {
            effort,
            format: { type: 'json_schema', schema: rubricSchema(candidates.length) },
        },
        system: [{ type: 'text', text: RUBRIC, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
    };
}

// ── Response ─────────────────────────────────────────────────────────────────

/** Structured output is requested but never trusted for correctness. */
function parseJudgeResponse(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new JudgeError('parse', 'empty judge response');
    try {
        return JSON.parse(raw);
    } catch { /* fall through to the fenced and embedded forms */ }

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
        try { return JSON.parse(fenced[1]); } catch { /* keep looking */ }
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* give up below */ }
    }
    throw new JudgeError('parse', `unparseable judge response: ${raw.slice(0, 120)}`);
}

const clamp10 = (n) => Math.max(0, Math.min(10, Number.isFinite(Number(n)) ? Number(n) : 0));

/** Weighted 0-100 mark for one candidate's rubric. */
function weightedScore(rubric) {
    const total = DIMENSIONS.reduce((sum, key) => sum + clamp10(rubric?.[key]) * WEIGHTS[key], 0);
    return Math.round(total * 10);
}

/** Normalise whatever the model returned into one entry per candidate. */
function normaliseRubrics(parsed, count) {
    const list = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    return Array.from({ length: count }, (_, i) => {
        const r = list[i] || {};
        const marks = Object.fromEntries(DIMENSIONS.map(d => [d, clamp10(r[d])]));
        return {
            ...marks,
            // A missing entry must not read as an endorsement.
            publishable: list[i] ? r.publishable !== false : false,
            notes: String(r.notes || (list[i] ? '' : 'no verdict returned')).slice(0, 300),
            score: weightedScore(marks),
        };
    });
}

/**
 * Ask the judge to mark a candidate set.
 *
 * @param {Array<{buffer: Buffer, judgeBuffer?: Buffer, prompt?: string}>} candidates
 * @returns {Promise<{rubrics: object[], best: number, reasoning: string, usage: object}>}
 */
let _rotator = null;
function rotator(logger) {
    if (!_rotator) _rotator = createRotator({ label: 'judge', logger });
    return _rotator;
}

/** One request/response cycle against a given client. */
async function askJudge(anthropic, params, count) {
    const response = await anthropic.messages.create(params);

    // Checked before content is read: a refusal returns HTTP 200 with an empty
    // or partial content array, so indexing straight into it would throw here
    // and read as a parse bug rather than what it is.
    if (response.stop_reason === 'refusal') {
        throw new JudgeError('refusal', `judge declined (${response.stop_details?.category || 'unspecified'})`);
    }

    const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = parseJudgeResponse(text);

    return {
        rubrics: normaliseRubrics(parsed, count),
        best: Number(parsed?.best_candidate) || 0,
        reasoning: String(parsed?.reasoning || '').slice(0, 500),
        usage: response.usage || {},
    };
}

async function judgeCandidates(candidates, {
    article = {}, model = JUDGE_MODEL, effort = JUDGE_EFFORT, client = null, logger = console,
} = {}) {
    // The renderer hands back PNG, which is lossless and about ten times the
    // bytes. Base64 is what the request body pays for, so the judge is shown
    // the same pixels as WebP: three PNG candidates are ~5 MB of base64, the
    // WebP set is well under one.
    const shown = await Promise.all(candidates.map(async c => ({
        ...c,
        judgeBuffer: c.judgeBuffer || await Images.toWebp(c.buffer),
    })));
    const params = buildJudgeParams(shown, { article, model, effort });

    // An explicitly supplied client is used as given — the caller owns it.
    if (client) return askJudge(client, params, candidates.length);

    const pool = rotator(logger);
    let last = null;
    // One pass over the chain: the SDK has already retried transient failures
    // with backoff before the error reaches us, so what is left to try is a
    // different credential.
    for (let attempt = 0; attempt < Math.max(1, pool.size()); attempt++) {
        const anthropic = pool.client();
        if (!anthropic) break;
        try {
            return await askJudge(anthropic, params, candidates.length);
        } catch (e) {
            last = e;
            // A refusal or an unparseable answer is the model's verdict, not a
            // credential problem; another key would return the same thing.
            if (e instanceof JudgeError) throw e;
            if (isAuthError(e)) {
                if (!pool.rotate(`HTTP ${e.status}`, { permanent: true })) break;
                continue;
            }
            if (isRetryableApiError(e)) {
                if (!pool.rotate(`HTTP ${e.status}`)) break;
                continue;
            }
            throw e;
        }
    }

    throw new JudgeError('api', last
        ? `every credential failed: ${last.message}`.slice(0, 200)
        : 'no Anthropic credential configured');
}

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * Pick the winner from marked candidates. Pure, and the model's own
 * `best_candidate` is only a tiebreak — the ranking is arithmetic so that two
 * runs over the same images choose the same image.
 */
function selectWinner(candidates, judgement, { minScore = MIN_JUDGE_SCORE, mode = MODE } = {}) {
    const marked = candidates.map((c, i) => ({ ...c, rubric: judgement?.rubrics?.[i] || null }));

    const eligible = marked.filter((c) => {
        if (!c.rubric) return false;
        if (mode === 'warn') return true;          // rank, but never withhold
        return c.rubric.publishable && c.rubric.score >= minScore;
    });

    if (!eligible.length) {
        return { winner: null, marked, reason: 'no candidate cleared the judge' };
    }

    const preferred = Number(judgement?.best) || 0;
    eligible.sort((a, b) => (
        b.rubric.score - a.rubric.score
        || b.rubric.anatomy - a.rubric.anatomy
        // Only now does the model's own pick break a genuine tie.
        || ((b.index === preferred - 1) - (a.index === preferred - 1))
        || (b.structural?.score || 0) - (a.structural?.score || 0)
    ));

    return { winner: eligible[0], marked, reason: 'selected on weighted rubric' };
}

/** Rank on the structural score alone, for when the judge cannot be reached. */
function selectStructuralOnly(candidates, { reason = 'judge unavailable' } = {}) {
    const usable = candidates.filter(c => c.structural?.ok);
    if (!usable.length) return { winner: null, marked: candidates, reason: `${reason}; none passed the structural gate` };
    usable.sort((a, b) => (b.structural.score - a.structural.score));
    return { winner: usable[0], marked: candidates, reason };
}

// ── Escalation ───────────────────────────────────────────────────────────────

/**
 * Change something real between rounds.
 *
 * Re-rolling the seed alone is the weakest possible retry: if a prompt reliably
 * produces a hand in the foreground, three more seeds produce three more hands.
 * Each round therefore removes more of what tends to break — and the last round
 * removes people altogether, because the cheapest fix for bad anatomy is not
 * rendering anatomy at all.
 */
function escalatePrompt(prompt, round) {
    const base = String(prompt || '').trim();
    if (round <= 0) return base;

    if (round === 1) {
        return `${base} Change the camera angle and composition from the obvious framing: place any people in the middle distance, keep hands relaxed at their sides and away from the foreground, and show no hands closer to the camera than the subject's waist.`;
    }

    // Round 2+: strip the people out and keep the setting.
    return `${base} Depict this scene with NO people visible at all: show only the setting, the building, the objects, and the light. No figures, no faces, no hands, no silhouettes of people.`;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Render one candidate and score it structurally.
 *
 * `render` is injected so the caller owns scheduling. The nightly run submits
 * every article's candidates into one shared lane pool, which keeps both GPUs
 * busy; a one-off regeneration just renders on the first live lane.
 */
async function renderCandidate({ prompt, seed, index, render, lane, logger = console }) {
    try {
        const r = await render(prompt, seed);
        const structural = await Score.scoreBuffer(r.buffer, { lane: lane || r.lane, logger });
        return { index, seed, prompt, buffer: r.buffer, lane: r.lane, ms: r.ms, structural };
    } catch (e) {
        logger.warn(`[judge] candidate ${index + 1} failed: ${e.message.slice(0, 100)}`);
        return { index, seed, prompt, error: e.message, structural: null };
    }
}

/**
 * Produce one publishable hero image, or nothing.
 *
 * The full ladder, and the single entry point both callers use:
 *
 *   for each round      render N candidates on an escalating prompt
 *                       score every candidate structurally
 *                       judge the survivors as a set
 *                       select a winner, or escalate
 *
 * Returning `{ image: null }` is a normal outcome, not an error. The caller
 * publishes the article as a draft rather than shipping a bad photograph.
 *
 * @returns {Promise<{image: object|null, rounds: object[], reason: string}>}
 */
async function produceImage({
    prompt,
    articleId,
    article = {},
    render = null,
    lanes = null,
    n = 1,
    opts = {},
    candidates = HERO_CANDIDATES,
    maxRounds = MAX_ROUNDS,
    minScore = MIN_JUDGE_SCORE,
    mode = MODE,
    saltBase = 0,
    client = null,
    logger = console,
} = {}) {
    let renderOn = render;
    if (!renderOn) {
        const available = lanes || await Comfy.liveLanes();
        if (!available.length) {
            return { image: null, rounds: [], reason: 'no ComfyUI lane reachable' };
        }
        const pool = Comfy.createLanePool(available);
        renderOn = (p, seed) => pool.submit(lane => Comfy.generateImage(p, { lane, seed, opts }));
    }

    const rounds = [];

    for (let round = 0; round < maxRounds; round++) {
        const roundPrompt = escalatePrompt(prompt, round);

        // Seeds are derived, never random: a re-run of a failed night reproduces
        // the same candidates instead of paying for a fresh lottery.
        const attempts = await Promise.all(
            Array.from({ length: candidates }, (_, i) => renderCandidate({
                prompt: roundPrompt,
                // Composed rather than added: `saltBase` is a number in the
                // nightly run and a random hex string for an admin
                // regeneration, and arithmetic on the latter is nonsense.
                seed: Images.seedFor(articleId, n, `${saltBase}:${round}:${i}`),
                index: i,
                render: renderOn,
                logger,
            })),
        );

        const passed = attempts.filter(a => a.buffer && a.structural?.ok);
        const record = {
            round,
            rendered: attempts.filter(a => a.buffer).length,
            structuralPassed: passed.length,
            flags: attempts.flatMap(a => a.structural?.flags || []),
        };

        if (!passed.length) {
            record.reason = 'no candidate cleared the structural gate';
            rounds.push(record);
            logger.log(`[judge] ${articleId} round ${round}: ${record.reason}`);
            continue;
        }

        if (mode === 'off') {
            const picked = selectStructuralOnly(passed, { reason: 'judge disabled' });
            rounds.push({ ...record, reason: picked.reason });
            if (picked.winner) return { image: picked.winner, rounds, reason: picked.reason };
            continue;
        }

        let judgement;
        try {
            judgement = await judgeCandidates(passed, { article, client });
        } catch (e) {
            // A judge that cannot be reached must not empty the site. Fall back
            // to the ruler we still have, and say so in the record.
            logger.warn(`[judge] ${articleId}: ${e.message.slice(0, 120)}`);
            const picked = selectStructuralOnly(passed, { reason: `judge ${e.kind || 'error'}` });
            rounds.push({ ...record, reason: picked.reason, judgeError: e.message });
            if (picked.winner) return { image: picked.winner, rounds, reason: picked.reason };
            continue;
        }

        const picked = selectWinner(passed, judgement, { minScore, mode });
        record.scores = judgement.rubrics.map(r => r.score);
        record.judgeUsage = judgement.usage;
        record.reason = picked.reason;
        rounds.push(record);

        if (picked.winner) {
            logger.log(
                `[judge] ${articleId} round ${round}: picked candidate ${picked.winner.index + 1} `
                + `(judge ${picked.winner.rubric.score}, structural ${picked.winner.structural.score})`,
            );
            return { image: picked.winner, rounds, reason: picked.reason, judgement };
        }
        logger.log(`[judge] ${articleId} round ${round}: ${picked.reason} (${record.scores.join('/')})`);
    }

    return { image: null, rounds, reason: `no publishable hero after ${maxRounds} round(s)` };
}

module.exports = {
    JUDGE_MODEL,
    JUDGE_EFFORT,
    MODE,
    HERO_CANDIDATES,
    MAX_ROUNDS,
    MIN_JUDGE_SCORE,
    WEIGHTS,
    DIMENSIONS,
    RUBRIC,
    JudgeError,
    rubricSchema,
    articleContext,
    buildJudgeParams,
    parseJudgeResponse,
    weightedScore,
    normaliseRubrics,
    judgeCandidates,
    selectWinner,
    selectStructuralOnly,
    escalatePrompt,
    renderCandidate,
    produceImage,
};

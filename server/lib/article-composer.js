'use strict';
/**
 * lib/article-composer.js — Turn one fact sheet into one finished article.
 *
 * A single Claude call produces every field the article needs, including the
 * three image prompts. Splitting this into separate calls would triple the cost
 * and let the imagery drift away from what the article actually says.
 *
 * Two of the nine required fields are deliberately NOT model output:
 *   Writer          — a constant, the newsroom byline
 *   Source News URL — comes from the RSS candidate
 * Both are passed in as given constraints. A model asked to produce a source
 * URL will invent one, and that is the single worst failure this pipeline could
 * ship, so it is never asked.
 */

const { clientFor, credentialChain, describeCredential } = require('./anthropic-client');
const { renderFactSheetBlock } = require('./source-facts');

const DEFAULT_MODEL = process.env.DAILY_NEWS_MODEL || 'claude-opus-5';
const DEFAULT_EFFORT = process.env.DAILY_NEWS_EFFORT || 'medium';

// Thinking is on by default on Opus 5, and max_tokens caps thinking + text
// together. A ~1,200-word article plus seven other fields plus reasoning needs
// real headroom; sizing this tightly truncates the body mid-sentence.
const MAX_TOKENS = 16000;

const WORD_FLOOR = 700;
const WORD_CEILING = 1600;

// ── Prompt ───────────────────────────────────────────────────────────────────

/**
 * Frozen house-style contract. Kept byte-stable so it caches across every call
 * in a run — sixty-odd of them at the default target — because caching is a
 * prefix match, and anything volatile in here would cost a full re-read on
 * every article.
 */
const HOUSE_STYLE = `You write for JubileeVerse, a Christian news publication that covers world events through a faith lens for an American evangelical readership.

Your job: take the verified facts you are given about one real news story and write a complete, publishable news-commentary article.

# Non-negotiable grounding rule

Every factual claim in the Introduction and Article Body must be traceable to a numbered item in the FACT SHEET you are given. You may add Scripture, theology, pastoral application, and reflection freely — that is your contribution. You may NOT add names, numbers, dates, statistics, quotations, locations, organizations, or causal claims that do not appear in the FACT SHEET.

If the fact sheet's confidence is "headline_only" or "partial", do not compensate by inventing detail. Attribute the story to the outlet by name ("According to the BBC...") and build the article around what the event means rather than around specifics you do not have. A shorter, honest article is always correct; an invented detail is never recoverable.

Return the indices of the facts you actually used in facts_used.

# Structure

- Introduction: 90-150 words. Open on the concrete news event, not on a general reflection. State what happened and why a reader should care.
- Article Body: 700-1100 words. Report the substance of the story, then widen into what it means. Use H2 headings (##) for movements within the piece. Never an H1.
- Faith-Based Relevance Analysis: 150-250 words. Why this matters to a Christian reader. Cite at least one specific passage as Book Chapter:Verse. Ground the application in the actual event, not in generalities.
- Marketing summary: one shareable sentence, 280 characters maximum. No hashtags, no emoji, no clickbait question.

# Style rules

- NEVER use an em dash (—). Use a comma, a semicolon, or a full stop. This is an automatic fail.
- Say "Shepherd", never "Pastor", when referring to a church leader generically. If the fact sheet names someone's actual title, keep their real title.
- Write at roughly an eighth-grade reading level. Short sentences. Concrete nouns.
- Express any score or proportion as a percentage, never as stars or a rating out of five.
- Do not print the words "Call to Action" as a heading or label.
- Close with hope. Never end on fear, condemnation, or an unresolved threat. This is not optional and it is not the same as ignoring hard facts: report the hard thing plainly, then point to where hope legitimately lies.
- No song-lyric formatting: no verse/chorus structure, no repeated refrains, no line-broken stanzas.
- No children's-story register: no "once upon a time", no talking animals, no simplified fable framing.
- Do not refuse, hedge about your own limitations, or mention that you are an AI. If the story is genuinely unsuitable, write the article about what is verifiable and keep the tone measured.
- Quote Scripture in a blockquote (>) with the reference beneath it.

# Voice

Warm, direct, and unsentimental. You are writing for adults who follow the news and hold their faith seriously. Respect both. Avoid sermon cadence, avoid triumphalism, avoid political partisanship. Report on people of every position with the same dignity.`;

/**
 * Frozen image-prompt contract. Also cached. The rules here exist because
 * generated imagery for a family publication fails in predictable ways.
 */
const IMAGE_CONTRACT = `# Image prompts

Write exactly three image prompts for this article. They will be rendered by a photorealistic image model and published alongside the article, so they must be safe, specific, and clearly connected to the story.

Each prompt gets a role:
- hero: the human moment at the centre of the story. A person or people, mid-action, in a real setting.
- supporting: the environment or context. The building, the street, the landscape, the room. May include people at a distance.
- symbolic: the theological metaphor from your Faith-Based Relevance Analysis, rendered as a concrete scene. No faces, no recognizable individuals.

Every prompt must:
- Be 3 to 4 sentences of concrete visual description. Name the subject, the setting, the lighting, the camera framing, and the mood.
- Differ from the other two in subject, environment, camera angle, and colour palette. Three variations of one composition is a failure.
- Describe ordinary, recognisable American or international settings that a Christian family would find unremarkable: homes, churches, offices, streets, schools, farmland, hospitals, courtrooms.
- Show people with natural, relaxed hands, clearly visible and correctly formed with five fingers, when hands appear at all.
- End with the exact sentence: "Photorealistic, cinematic lighting, natural skin tones, 16:9."

Never include:
- Real identifiable public figures, or any attempt at a specific living person's likeness.
- Text, logos, watermarks, signage with readable words, or user-interface elements.
- Weapons in use, injury, blood, bodies, distress imagery, or anything depicting violence.
- Revealing clothing, romantic or suggestive framing, or children in any state of undress.
- Religious iconography presented as an object of worship, or depictions of God or Jesus's face.
- Overused stock clichés: glowing light beams from clouds, silhouetted figures on hilltops with arms raised, open Bibles on wooden tables in shafts of light, praying hands in close-up, generic diverse-team-around-a-laptop compositions.`;

/** JSON Schema for the structured response. */
function composeSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'title', 'slug', 'introduction', 'body', 'marketing_summary',
            'faith_relevance_analysis', 'scripture_refs', 'facts_used', 'image_prompts',
        ],
        properties: {
            title: { type: 'string', description: 'Headline, under 90 characters, no colon-subtitle pattern.' },
            slug: { type: 'string', description: 'Lowercase hyphenated, under 70 characters, derived from the title.' },
            introduction: { type: 'string', description: '90-150 words. Markdown. No heading.' },
            body: { type: 'string', description: '700-1100 words. Markdown with ## headings. No H1.' },
            marketing_summary: { type: 'string', description: 'One shareable sentence, max 280 characters.' },
            faith_relevance_analysis: { type: 'string', description: '150-250 words with at least one Book Chapter:Verse citation.' },
            scripture_refs: {
                type: 'array',
                items: { type: 'string' },
                description: 'Every passage cited, as "Book Chapter:Verse".',
            },
            facts_used: {
                type: 'array',
                items: { type: 'integer' },
                description: 'Indices from the numbered FACT SHEET that this article actually relies on.',
            },
            image_prompts: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['role', 'prompt'],
                    properties: {
                        role: { type: 'string', enum: ['hero', 'supporting', 'symbolic'] },
                        prompt: { type: 'string' },
                    },
                },
                description: 'Exactly three, one per role, in the order hero, supporting, symbolic.',
            },
        },
    };
}

/** The volatile half of the prompt: this story's facts. */
function buildComposeUserContent({ factSheet, topic, writer, sourceUrl, recentTitles = [] }) {
    const parts = [
        renderFactSheetBlock(factSheet),
        '',
        'ARTICLE CONSTRAINTS',
        `Topic channel: ${topic}`,
        `Writer (use verbatim, do not invent a byline): ${writer}`,
        `Source URL (do not restate or alter this; it is recorded separately): ${sourceUrl}`,
    ];

    if (recentTitles.length) {
        parts.push(
            '',
            'Headlines already published today. Yours must not duplicate their angle or phrasing:',
            ...recentTitles.slice(0, 25).map(t => `  - ${t}`),
        );
    }

    parts.push(
        '',
        'Write the article now. Return only the JSON object described by the schema.',
    );
    return parts.join('\n');
}

/** Params object shared by the real-time and batch paths. */
function buildComposeParams(input, { model = DEFAULT_MODEL, effort = DEFAULT_EFFORT } = {}) {
    return {
        model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: {
            effort,
            format: { type: 'json_schema', schema: composeSchema() },
        },
        system: [
            { type: 'text', text: HOUSE_STYLE },
            { type: 'text', text: IMAGE_CONTRACT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: buildComposeUserContent(input) }],
    };
}

// ── Response handling ────────────────────────────────────────────────────────

class ComposeError extends Error {
    constructor(kind, message, meta = {}) {
        super(message);
        this.name = 'ComposeError';
        this.kind = kind;      // refusal | parse | validation | api
        this.meta = meta;
    }
}

/**
 * JSON parse ladder: structured output is requested, but never relied on for
 * correctness. Direct parse, then a fenced block, then the first balanced
 * object in the text.
 */
function parseComposeResponse(rawText) {
    const text = String(rawText || '').trim();
    if (!text) throw new ComposeError('parse', 'Empty response');

    try { return JSON.parse(text); } catch { /* fall through */ }

    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fenced) {
        try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ }
    }

    const start = text.indexOf('{');
    if (start !== -1) {
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) {
                try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
            }
        }
    }

    throw new ComposeError('parse', 'Response was not valid JSON', { sample: text.slice(0, 300) });
}

function countWords(text) {
    return String(text || '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`~>[\]()]/g, '')
        .split(/\s+/)
        .filter(Boolean).length;
}

const REFUSAL_MARKERS = [
    "i can't", 'i cannot', 'i am unable', "i'm unable", 'i apologize',
    'as an ai', 'i am an ai', 'i do not feel comfortable', "i won't be able",
];

/**
 * Deterministic quality gate. Everything here is a hard style rule from the
 * house standard or a grounding requirement, so a violation is a reject rather
 * than a warning.
 */
function validateComposed(obj, { factSheet, minWords = WORD_FLOOR, maxWords = WORD_CEILING } = {}) {
    const errors = [];
    const warnings = [];

    for (const field of ['title', 'slug', 'introduction', 'body', 'marketing_summary', 'faith_relevance_analysis']) {
        if (!obj?.[field] || !String(obj[field]).trim()) errors.push(`missing ${field}`);
    }
    if (errors.length) return { ok: false, errors, warnings };

    const prose = `${obj.introduction}\n${obj.body}\n${obj.faith_relevance_analysis}`;

    const words = countWords(obj.body);
    if (words < minWords) errors.push(`body too short: ${words} words (floor ${minWords})`);
    if (words > maxWords) warnings.push(`body long: ${words} words (ceiling ${maxWords})`);

    if (/—/.test(prose)) errors.push('contains an em dash');
    if (/\bPastor\b/.test(prose)) errors.push('uses "Pastor" instead of "Shepherd"');
    if (/^#\s/m.test(obj.body)) errors.push('body contains an H1');
    if (/call to action/i.test(prose)) errors.push('prints a "Call to Action" label');

    const lower = prose.toLowerCase();
    const refusal = REFUSAL_MARKERS.find(m => lower.includes(m));
    if (refusal) errors.push(`refusal language: "${refusal}"`);

    if (obj.marketing_summary.length > 280) errors.push(`marketing_summary is ${obj.marketing_summary.length} chars`);
    if (/#\w/.test(obj.marketing_summary)) errors.push('marketing_summary contains a hashtag');

    if (!/\b[1-3]?\s?[A-Z][a-z]+\.?\s+\d+:\d+/.test(obj.faith_relevance_analysis)) {
        errors.push('faith analysis has no Book Chapter:Verse citation');
    }

    const prompts = Array.isArray(obj.image_prompts) ? obj.image_prompts : [];
    if (prompts.length !== 3) {
        errors.push(`expected 3 image prompts, got ${prompts.length}`);
    } else {
        const roles = prompts.map(p => p.role);
        if (new Set(roles).size !== 3) errors.push(`image prompt roles not distinct: ${roles.join(', ')}`);
        prompts.forEach((p, i) => {
            if (!p.prompt || p.prompt.length < 80) errors.push(`image prompt ${i} is too thin`);
        });
    }

    // Grounding: a "full" fact sheet that the article claims not to have used
    // means the model wrote from its own priors, which is the failure this
    // whole module exists to prevent.
    const used = Array.isArray(obj.facts_used) ? obj.facts_used : [];
    if (factSheet && factSheet.confidence === 'full' && used.length === 0) {
        errors.push('facts_used is empty on a full fact sheet');
    }
    const maxIndex = (factSheet?.key_facts?.length ?? 0) - 1;
    if (used.some(i => !Number.isInteger(i) || i < 0 || i > maxIndex)) {
        warnings.push('facts_used contains an out-of-range index');
    }

    return { ok: errors.length === 0, errors, warnings };
}

// ── Client ───────────────────────────────────────────────────────────────────

/**
 * Credential rotation.
 *
 * The chain usually holds an OAuth token plus one or two API keys, and they
 * carry independent rate limits. A 429 on the first credential should move the
 * run to the next one, not end it: thirty articles a night will exhaust a
 * single small quota, and a half-published day is worse than a slow one.
 */
let _chain = null;
let _index = 0;
const _clients = new Map();

function chain() {
    if (!_chain) {
        _chain = credentialChain();
        if (!_chain.length) throw new ComposeError('api', 'No Anthropic credential found');
    }
    return _chain;
}

/** Credentials proven dead (401/403). Never tried again this run. */
const _dead = new Set();

function usableChain() {
    return chain().filter(c => !_dead.has(c));
}

function client() {
    const usable = usableChain();
    if (!usable.length) throw new ComposeError('api', 'every Anthropic credential failed authentication');
    if (_index >= usable.length) _index = 0;
    const credential = usable[_index];
    if (!_clients.has(credential)) {
        _clients.set(credential, clientFor(credential));
        console.log(`[compose] using credential ${_index + 1}/${usable.length} — ${describeCredential(credential)}`);
    }
    return _clients.get(credential);
}

/**
 * Advance past the current credential.
 *
 * Rate limits are transient, so a throttled credential stays in the pool and
 * comes round again. An authentication failure is permanent for this run, so
 * that credential is retired outright — otherwise a single bad key in the
 * middle of the chain fails every remaining article, which is exactly what a
 * live run hit.
 */
function rotateCredential(reason, { permanent = false } = {}) {
    const before = usableChain();
    const current = before[Math.min(_index, before.length - 1)];

    if (permanent && current) {
        _dead.add(current);
        _clients.delete(current);
        console.warn(`[compose] ${reason} — retiring credential ${describeCredential(current)}`);
        if (_index >= usableChain().length) _index = 0;
        return usableChain().length > 0;
    }

    if (before.length <= 1) return false;
    _index = (_index + 1) % before.length;
    console.warn(`[compose] ${reason} — rotating to credential ${_index + 1}/${before.length}`);
    return true;
}

function isAuthError(e) {
    const status = e?.status ?? e?.$metadata?.httpStatusCode;
    return status === 401 || status === 403;
}

function isRetryableApiError(e) {
    const status = e?.status ?? e?.$metadata?.httpStatusCode;
    return status === 429 || status === 529 || (status >= 500 && status < 600);
}

/** Reset rotation state. Test seam. */
function resetCredentials() {
    _chain = null;
    _index = 0;
    _clients.clear();
    _dead.clear();
}

function textOf(response) {
    return (response?.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
}

/**
 * Compose one article in real time.
 *
 * Retries are narrow on purpose: transport errors are worth retrying, a refusal
 * never is (the same prompt produces the same refusal), and a parse or
 * validation failure gets exactly one targeted repair naming the violation.
 */
async function composeArticle(input, { model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, maxRepairs = 1 } = {}) {
    const params = buildComposeParams(input, { model, effort });
    let attempts = 0;
    let repairNote = null;

    for (let repair = 0; repair <= maxRepairs; repair++) {
        const send = repairNote
            ? { ...params, messages: [...params.messages, { role: 'assistant', content: 'Understood.' }, { role: 'user', content: repairNote }] }
            : params;

        let response;
        let transportTries = 0;
        for (;;) {
            try {
                attempts++;
                response = await client().messages.create(send);
                break;
            } catch (e) {
                // A bad key is bad for the whole run: retire it and try another
                // rather than letting it consume every remaining article.
                if (isAuthError(e)) {
                    if (rotateCredential(`HTTP ${e.status}`, { permanent: true })) continue;
                    throw new ComposeError('api', `all credentials failed authentication: ${e.message}`, { status: e.status });
                }
                if (!isRetryableApiError(e)) {
                    throw new ComposeError('api', e.message, { status: e.status });
                }
                // Rate limits are transient. Walk the pool once, then back off
                // and let the whole pool recover before giving up.
                transportTries++;
                if (transportTries > usableChain().length + 1) {
                    throw new ComposeError('api', `all credentials rate limited: ${e.message}`, { status: e.status });
                }
                if (!rotateCredential(`HTTP ${e.status}`) || transportTries >= usableChain().length) {
                    await new Promise(r => setTimeout(r, 20000));
                }
            }
        }

        if (response.stop_reason === 'refusal') {
            // No retry: the same prompt yields the same refusal, and paying for
            // that twice buys nothing.
            throw new ComposeError('refusal', 'Model declined this story', {
                category: response.stop_details?.category,
            });
        }

        let parsed;
        try {
            parsed = parseComposeResponse(textOf(response));
        } catch (e) {
            repairNote = 'Your previous response was not valid JSON. Return only the JSON object described by the schema, with no prose and no code fence.';
            if (repair === maxRepairs) throw e;
            continue;
        }

        const check = validateComposed(parsed, { factSheet: input.factSheet });
        if (check.ok) {
            return {
                fields: parsed,
                usage: response.usage,
                model: response.model,
                attempts,
                warnings: check.warnings,
            };
        }

        if (repair === maxRepairs) {
            throw new ComposeError('validation', check.errors.join('; '), { errors: check.errors });
        }
        repairNote = `Your previous article violated these rules: ${check.errors.join('; ')}. `
            + 'Rewrite it completely, fixing every violation. Return only the JSON object.';
    }

    throw new ComposeError('validation', 'Exhausted repair attempts');
}

/**
 * Compose many articles through the Message Batches API at half price.
 *
 * This is a scheduled overnight job with no latency requirement, which is
 * exactly the workload batching exists for. Results come back in arbitrary
 * order, so everything is keyed by custom_id and never by position.
 *
 * @param {Array<{customId: string, input: object}>} requests
 * @returns {Promise<Map<string, {fields}|{error}>>}
 */
async function composeBatch(requests, {
    model = DEFAULT_MODEL,
    effort = DEFAULT_EFFORT,
    pollMs = 30000,
    maxWaitMs = 6 * 60 * 60 * 1000,
    logger = console,
} = {}) {
    const api = client();
    const byId = new Map(requests.map(r => [r.customId, r.input]));

    const batch = await api.messages.batches.create({
        requests: requests.map(r => ({
            custom_id: r.customId,
            params: buildComposeParams(r.input, { model, effort }),
        })),
    });
    logger.log(`[compose] batch ${batch.id} submitted with ${requests.length} requests`);

    const deadline = Date.now() + maxWaitMs;
    let status = batch;
    while (status.processing_status !== 'ended') {
        if (Date.now() > deadline) throw new ComposeError('api', `Batch ${batch.id} did not finish within the deadline`);
        await new Promise(r => setTimeout(r, pollMs));
        status = await api.messages.batches.retrieve(batch.id);
        logger.log(`[compose] batch ${batch.id}: ${status.processing_status} ${JSON.stringify(status.request_counts)}`);
    }

    const out = new Map();
    for await (const result of await api.messages.batches.results(batch.id)) {
        const input = byId.get(result.custom_id);
        if (result.result.type !== 'succeeded') {
            out.set(result.custom_id, { error: new ComposeError('api', `batch result ${result.result.type}`) });
            continue;
        }
        const message = result.result.message;
        if (message.stop_reason === 'refusal') {
            out.set(result.custom_id, { error: new ComposeError('refusal', 'Model declined this story') });
            continue;
        }
        try {
            const parsed = parseComposeResponse(textOf(message));
            const check = validateComposed(parsed, { factSheet: input?.factSheet });
            if (!check.ok) {
                out.set(result.custom_id, { error: new ComposeError('validation', check.errors.join('; '), { errors: check.errors }) });
                continue;
            }
            out.set(result.custom_id, { fields: parsed, usage: message.usage, model: message.model, warnings: check.warnings });
        } catch (e) {
            out.set(result.custom_id, { error: e });
        }
    }
    return out;
}

module.exports = {
    DEFAULT_MODEL,
    HOUSE_STYLE,
    IMAGE_CONTRACT,
    WORD_FLOOR,
    WORD_CEILING,
    ComposeError,
    composeSchema,
    buildComposeUserContent,
    buildComposeParams,
    parseComposeResponse,
    validateComposed,
    countWords,
    composeArticle,
    composeBatch,
    resetCredentials,
};

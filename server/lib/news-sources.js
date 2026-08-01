'use strict';
/**
 * lib/news-sources.js — Candidate harvest, dedupe, and quota allocation.
 *
 * Pure selection logic plus feed IO. No LLM calls, no uploads — which is what
 * lets `publish-daily-news.js --dry-run` tune scoring and quotas at zero cost.
 *
 * The output is an ordered list of the stories worth writing about today, as
 * many as the caller's target asks for.
 */

const crypto = require('crypto');
const { TOPIC_FEEDS, fetchRssFeed, parseRssFeed, scoreTopicRelevance } = require('./rss-feeds');

/**
 * Per-topic share of the daily target, weighted toward the four faith topics
 * where the site's identity actually lives.
 *
 * These are **weights, not counts**: `allocateQuota` scales them to whatever
 * target it is given, so the mix is identical at 30 articles a day and at 60.
 * They happen to sum to 30, which is what makes each number readable as "this
 * topic's share of a thirty-article day".
 */
const DEFAULT_QUOTAS = {
    'church-us':          4,
    'church-global':      4,
    'faith':              4,
    'christian-watch-us': 4,
    'social':             4,
    'finance':            3,
    'technology':         3,
    'health':             2,
    'entertainment':      2,
};

/** The weights above, as a total — the target a bare quota table describes. */
const QUOTA_BASELINE = Object.values(DEFAULT_QUOTAS).reduce((a, b) => a + b, 0);

/** No single outlet may supply more than this many articles in a 30-article day. */
const DEFAULT_PER_SOURCE_CAP = 4;

/**
 * Articles selected per slot an outlet is allowed.
 *
 * 36 selected (a 30-article day plus its 20% reserve) over a cap of 4 — the
 * ratio this pipeline has always run at, stated as a constant so the cap can
 * follow the target without anyone having to re-derive it.
 */
const ARTICLES_PER_SOURCE_SLOT = 9;

/**
 * The per-outlet cap for a selection of `size` stories.
 *
 * The cap is a diversity rule — no outlet may be more than roughly an eighth of
 * the day — so it has to move with the target. Holding it at 4 while the target
 * doubles would quietly turn a diversity rule into a shortfall: 60 articles
 * would then need at least fifteen healthy outlets every morning, and a few
 * dead feeds would leave the day short.
 *
 * The floor keeps small runs unchanged, and the ratio is anchored so a
 * 30-article day still computes to exactly 4.
 */
function perSourceCapFor(size, baseCap = DEFAULT_PER_SOURCE_CAP) {
    return Math.max(baseCap, Math.round(size / ARTICLES_PER_SOURCE_SLOT));
}

/** Words carrying no signal for near-duplicate detection. */
const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
    'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it',
    'its', 'this', 'that', 'these', 'those', 'has', 'have', 'had', 'will',
    'would', 'can', 'could', 'says', 'say', 'said', 'after', 'over', 'new',
    'amid', 'into', 'about', 'more', 'than', 'his', 'her', 'their',
]);

// ── Identity and similarity ──────────────────────────────────────────────────

/**
 * Story identity hash.
 *
 * Byte-for-byte the same computation as ingestTopicStories() in server.js, so
 * the two pipelines share a dedupe namespace and cannot both claim one story.
 * Do not "improve" this — matching the legacy value is the whole point.
 */
function contentHashFor(title, link) {
    return crypto.createHash('sha256')
        .update((title || '') + (link || ''))
        .digest('hex')
        .slice(0, 64);
}

/** Significant lowercase tokens from a headline. */
function normalizeTitle(title) {
    return new Set(
        String(title || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOPWORDS.has(w))
    );
}

/** Jaccard overlap of two headline token sets, 0..1. */
function titleSimilarity(a, b) {
    const setA = a instanceof Set ? a : normalizeTitle(a);
    const setB = b instanceof Set ? b : normalizeTitle(b);
    if (!setA.size || !setB.size) return 0;
    let shared = 0;
    for (const token of setA) if (setB.has(token)) shared++;
    return shared / (setA.size + setB.size - shared);
}

/** Strip tracking params and trailing slashes so the same story matches itself. */
function normalizeUrl(url) {
    try {
        const u = new URL(url);
        for (const key of [...u.searchParams.keys()]) {
            if (/^(utm_|fbclid|gclid|mc_|ref|cmpid|ito|at_)/i.test(key)) u.searchParams.delete(key);
        }
        u.hash = '';
        const path = u.pathname.replace(/\/+$/, '');
        return `${u.hostname.replace(/^www\./, '')}${path}${u.search}`.toLowerCase();
    } catch {
        return String(url || '').toLowerCase();
    }
}

/** Readable outlet name from a feed or article URL. */
function sourceNameFor(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return String(url || '');
    }
}

// ── Harvest ──────────────────────────────────────────────────────────────────

/**
 * Fetch every feed for every topic, score, and keep the strongest candidates.
 *
 * `perTopicCap` is deliberately above the quota: candidates are free once the
 * fetch has happened, and the approval/compose funnel rejects some of them.
 *
 * A dead feed is logged and skipped. One outlet going down must never fail a
 * run — that is the single most common failure mode here.
 *
 * @returns {Promise<{byTopic: Map<string, Array>, feedErrors: Array}>}
 */
async function harvestCandidates(topics, { perTopicCap = 12, logger = console } = {}) {
    const list = topics && topics.length ? topics : Object.keys(TOPIC_FEEDS);
    const byTopic = new Map();
    const feedErrors = [];

    for (const topic of list) {
        const feeds = TOPIC_FEEDS[topic];
        if (!feeds) {
            logger.warn(`[harvest] unknown topic "${topic}" — skipping`);
            continue;
        }

        const settled = await Promise.all(feeds.map(async (feedUrl) => {
            try {
                const xml = await fetchRssFeed(feedUrl);
                const sourceName = sourceNameFor(feedUrl);
                return parseRssFeed(xml, sourceName).map(a => ({
                    ...a,
                    sourceName,
                    feedUrl,
                    topic,
                }));
            } catch (e) {
                feedErrors.push({ topic, feedUrl, error: e.message });
                logger.warn(`[harvest] ${topic} ${sourceNameFor(feedUrl)}: ${e.message}`);
                return [];
            }
        }));

        // Within one topic the same story can arrive from several feeds; keep
        // the first sighting so the per-topic pool is genuinely `perTopicCap`
        // distinct stories rather than one story repeated.
        const seen = new Set();
        const scored = [];
        for (const article of settled.flat()) {
            const hash = contentHashFor(article.title, article.link);
            if (seen.has(hash)) continue;
            seen.add(hash);
            scored.push({
                ...article,
                contentHash: hash,
                normalizedUrl: normalizeUrl(article.link),
                titleTokens: normalizeTitle(article.title),
                score: scoreTopicRelevance(article, topic),
            });
        }

        scored.sort((a, b) => b.score.total - a.score.total);
        byTopic.set(topic, scored.slice(0, perTopicCap));
        logger.log(`[harvest] ${topic}: ${scored.length} unique candidates, keeping ${Math.min(scored.length, perTopicCap)}`);
    }

    return { byTopic, feedErrors };
}

// ── Dedupe against what is already published ─────────────────────────────────

/**
 * Drop candidates already covered in `published`.
 *
 * Three layers, cheapest first:
 *   1. exact content hash        — catches a literal re-run
 *   2. normalized source URL     — catches the same story with tracking params
 *   3. headline token overlap    — catches CNN and Fox covering one event, and
 *                                  syndicated re-posts with a tweaked headline
 *
 * Layer 3 is the one that earns its keep. Hashing alone would happily publish
 * six versions of the same story from six outlets on the same morning.
 *
 * @param {Array} candidates
 * @param {Array<{content_hash?, source_url?, title?}>} published  recent manifest entries
 */
function filterAlreadyPublished(candidates, published, { simThreshold = 0.6 } = {}) {
    const hashes = new Set();
    const urls = new Set();
    const titleSets = [];

    for (const entry of published || []) {
        if (entry.content_hash) hashes.add(entry.content_hash);
        if (entry.source_url) urls.add(normalizeUrl(entry.source_url));
        if (entry.title) titleSets.push(normalizeTitle(entry.title));
    }

    const fresh = [];
    const rejected = [];

    for (const c of candidates) {
        if (hashes.has(c.contentHash)) {
            rejected.push({ candidate: c, reason: 'duplicate-hash' });
            continue;
        }
        if (urls.has(c.normalizedUrl)) {
            rejected.push({ candidate: c, reason: 'duplicate-url' });
            continue;
        }
        const near = titleSets.find(t => titleSimilarity(c.titleTokens, t) >= simThreshold);
        if (near) {
            rejected.push({ candidate: c, reason: 'near-duplicate-title' });
            continue;
        }
        fresh.push(c);
    }

    return { fresh, rejected };
}

/**
 * Collapse candidates that cover the same event as each other within this run,
 * keeping the highest-scoring version. Runs after `filterAlreadyPublished`, and
 * is what stops one news event from consuming three of the day's slots.
 */
function collapseWithinRun(candidates, { simThreshold = 0.6 } = {}) {
    const kept = [];
    const dropped = [];
    for (const c of [...candidates].sort((a, b) => b.score.total - a.score.total)) {
        const twin = kept.find(k => titleSimilarity(c.titleTokens, k.titleTokens) >= simThreshold);
        if (twin) {
            dropped.push({ candidate: c, reason: 'same-event-as', slug: twin.title });
            // The loser is still useful: it corroborates the winner's facts.
            (twin.corroborators = twin.corroborators || []).push({
                name: c.sourceName, url: c.link, headline: c.title, description: c.description,
            });
            continue;
        }
        kept.push(c);
    }
    return { kept, dropped };
}

// ── Quota allocation ─────────────────────────────────────────────────────────

/**
 * Choose exactly `target` stories across the topics.
 *
 * Each topic fills its quota in descending score order. Whatever a thin topic
 * cannot fill spills into a global pool ranked by score across every remaining
 * candidate — so a dead entertainment feed silently becomes two extra `social`
 * articles instead of a shortfall.
 *
 * @returns {{selected: Array, overflow: Array, shortfall: number, perTopic: object}}
 */
function allocateQuota(byTopic, {
    target = QUOTA_BASELINE,
    quotas = DEFAULT_QUOTAS,
    perSourceCap = perSourceCapFor(target),
} = {}) {
    const selected = [];
    const remaining = [];
    const sourceCounts = new Map();
    const perTopic = {};

    const canTake = (c) => (sourceCounts.get(c.sourceName) || 0) < perSourceCap;
    const take = (c) => {
        selected.push(c);
        sourceCounts.set(c.sourceName, (sourceCounts.get(c.sourceName) || 0) + 1);
    };

    // Scale the configured quotas to the requested target so `--target 10`
    // still spreads across topics rather than exhausting the first few.
    const quotaTotal = Object.values(quotas).reduce((a, b) => a + b, 0) || 1;
    const scale = target / quotaTotal;

    // Pass 1 — each topic takes its share.
    for (const [topic, pool] of byTopic) {
        const want = Math.max(1, Math.round((quotas[topic] || 1) * scale));
        let got = 0;
        for (const c of pool) {
            if (got >= want) { remaining.push(c); continue; }
            if (!canTake(c)) { remaining.push(c); continue; }
            take(c);
            got++;
        }
        perTopic[topic] = got;
    }

    // Pass 2 — spill: fill any gap from the global leftovers, best score first.
    remaining.sort((a, b) => b.score.total - a.score.total);
    const overflow = [];
    for (const c of remaining) {
        if (selected.length >= target) { overflow.push(c); continue; }
        if (!canTake(c)) { overflow.push(c); continue; }
        take(c);
        perTopic[c.topic] = (perTopic[c.topic] || 0) + 1;
    }

    // Trim if rounding overshot, dropping the weakest.
    if (selected.length > target) {
        selected.sort((a, b) => b.score.total - a.score.total);
        overflow.push(...selected.splice(target));
    }

    selected.sort((a, b) => b.score.total - a.score.total);
    selected.forEach((c, i) => { c.order = i; });

    return {
        selected,
        overflow,
        shortfall: Math.max(0, target - selected.length),
        perTopic,
    };
}

module.exports = {
    DEFAULT_QUOTAS,
    DEFAULT_PER_SOURCE_CAP,
    ARTICLES_PER_SOURCE_SLOT,
    QUOTA_BASELINE,
    perSourceCapFor,
    contentHashFor,
    normalizeTitle,
    titleSimilarity,
    normalizeUrl,
    sourceNameFor,
    harvestCandidates,
    filterAlreadyPublished,
    collapseWithinRun,
    allocateQuota,
};

'use strict';
/**
 * lib/source-facts.js — Build a grounded fact sheet for one news story.
 *
 * The RSS item gives a headline, a link, and one or two sentences. That is not
 * enough to write a thousand words from, and asking a model to try is exactly
 * how fabricated quotes and invented statistics appear. So we fetch the source
 * page and extract what it actually says, then hand the model a numbered list
 * of facts it is allowed to use.
 *
 * Extraction is a confidence ladder, never a hard requirement:
 *
 *   full          the article body (JSON-LD articleBody, or >=1200 chars of <p>)
 *   partial       meta description plus some paragraphs
 *   headline_only the RSS item alone — fetch failed, blocked, or paywalled
 *
 * A fetch failure downgrades confidence and moves on. It must never fail the
 * article: the site loses far more from a missing story than from a thinner one.
 */

const https = require('https');
const http = require('http');
const { decodeHtmlEntities, stripHtmlTags } = require('./rss-feeds');

/**
 * Hosts that reliably 403 or paywall. Skipping them outright saves ~10s per
 * candidate that would otherwise be spent waiting for a refusal.
 */
const SCRAPE_BLOCKLIST = new Set([
    // Paywalled
    'nytimes.com', 'wsj.com', 'ft.com', 'bloomberg.com', 'economist.com',
    'washingtonpost.com', 'thetimes.co.uk', 'telegraph.co.uk',
    // Bot-protected: returns 403 to every header combination we can send.
    // Their RSS ledes run ~200 chars, which is enough for attributed
    // commentary, so these stories are still usable — just not deeply grounded.
    'christianpost.com',
]);

/**
 * An RSS lede at least this long is a real, quotable summary rather than a
 * truncated headline, and is enough to write attributed commentary from.
 */
const USABLE_LEDE_CHARS = 150;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MAX_BYTES = 400 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const MAX_BODY_CHARS = 6000;

/** Per-run memo so corroborator lookups never re-fetch a page. */
const _pageCache = new Map();

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function isBlocked(url) {
    const host = hostOf(url);
    return [...SCRAPE_BLOCKLIST].some(b => host === b || host.endsWith(`.${b}`));
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetch an article page as HTML, or null.
 *
 * Same request shape already proven against these outlets by the og:image
 * scraper: browser UA, follows redirects, hard byte cap so a stray multi-MB
 * page cannot stall the run.
 */
function fetchSourcePage(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_BYTES, _redirects = 0 } = {}) {
    if (_pageCache.has(url)) return Promise.resolve(_pageCache.get(url));

    return new Promise((resolve) => {
        if (_redirects > 4 || !/^https?:\/\//i.test(url || '')) return resolve(null);

        const protocol = url.startsWith('https') ? https : http;
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            if (_redirects === 0) _pageCache.set(url, value);
            resolve(value);
        };

        const req = protocol.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: timeoutMs,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const next = (() => {
                    try { return new URL(res.headers.location, url).toString(); } catch { return null; }
                })();
                if (!next) return done(null);
                return fetchSourcePage(next, { timeoutMs, maxBytes, _redirects: _redirects + 1 }).then(done);
            }
            if (res.statusCode !== 200 || !/text\/html|application\/xhtml/i.test(res.headers['content-type'] || '')) {
                res.resume();
                return done(null);
            }

            let html = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                html += chunk;
                if (html.length >= maxBytes) { html = html.slice(0, maxBytes); req.destroy(); done(html); }
            });
            res.on('end', () => done(html));
            res.on('error', () => done(null));
        });

        req.on('error', () => done(null));
        req.on('timeout', () => { req.destroy(); done(null); });
    });
}

// ── Extraction ───────────────────────────────────────────────────────────────

/**
 * Pull the schema.org NewsArticle block.
 *
 * Tried first because it is both the richest and the most stable source: CNN,
 * BBC, Fox, Jerusalem Post, Times of Israel, Al Jazeera, Christian Post and
 * essentially every WordPress site emit it, and it needs no per-site selectors.
 */
function extractJsonLdNewsArticle(html) {
    if (!html) return null;
    const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];

    for (const block of blocks) {
        const raw = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            continue;   // malformed LD is common; just move to the next block
        }

        // The payload may be a single object, an array, or an @graph wrapper.
        const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length) {
            const node = queue.shift();
            if (!node || typeof node !== 'object') continue;
            if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);

            const types = [].concat(node['@type'] || []);
            if (!types.some(t => /NewsArticle|ReportageNewsArticle|Article|BlogPosting/i.test(t))) continue;

            const author = (() => {
                const a = node.author;
                if (!a) return '';
                if (typeof a === 'string') return a;
                if (Array.isArray(a)) return a.map(x => x?.name || x).filter(Boolean).join(', ');
                return a.name || '';
            })();

            return {
                headline: cleanText(node.headline || node.name || ''),
                description: cleanText(node.description || ''),
                articleBody: cleanText(node.articleBody || ''),
                datePublished: node.datePublished || node.dateCreated || '',
                author,
                publisher: node.publisher?.name || '',
            };
        }
    }
    return null;
}

/** OpenGraph and standard meta tags — near-universal, cheap, a good fallback. */
function extractMetaFacts(html) {
    if (!html) return null;
    const meta = (prop) => {
        const patterns = [
            new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'),
            new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'),
        ];
        for (const re of patterns) {
            const m = re.exec(html);
            if (m) return cleanText(m[1]);
        }
        return '';
    };

    return {
        title: meta('og:title') || meta('twitter:title') || cleanText((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || ''),
        description: meta('og:description') || meta('description') || meta('twitter:description'),
        publishedTime: meta('article:published_time') || meta('datePublished'),
        siteName: meta('og:site_name'),
        image: meta('og:image') || meta('twitter:image'),
    };
}

/**
 * Crude paragraph extraction: strip the furniture, keep the <p> text.
 * Adequate as a floor when there is no JSON-LD and no useful meta description.
 */
function extractBodyParagraphs(html, { maxChars = MAX_BODY_CHARS } = {}) {
    if (!html) return '';
    const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<(nav|aside|footer|header|form|figure|noscript)[\s\S]*?<\/\1>/gi, ' ');

    const paragraphs = [];
    const re = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi;
    let m;
    let total = 0;
    while ((m = re.exec(stripped)) !== null) {
        const text = cleanText(stripHtmlTags(m[1]));
        // Short fragments are almost always nav labels, bylines, or cookie text.
        if (text.length < 40) continue;
        if (/^(share|advertisement|read more|sign up|subscribe|follow us|copyright|all rights reserved)/i.test(text)) continue;
        paragraphs.push(text);
        total += text.length;
        if (total >= maxChars) break;
    }
    return paragraphs.join('\n\n').slice(0, maxChars);
}

function cleanText(str) {
    return decodeHtmlEntities(String(str ?? ''))
        .replace(/\s+/g, ' ')
        .trim();
}

/** Split prose into fact-sized statements the model can cite by number. */
function toKeyFacts(text, { max = 14 } = {}) {
    if (!text) return [];
    return text
        .split(/(?<=[.!?])\s+(?=[A-Z"“'(])/)
        .map(s => s.trim())
        .filter(s => s.length >= 40 && s.length <= 400)
        .slice(0, max);
}

/** Direct quotations, kept separately so the model can reuse them verbatim. */
function extractQuotes(text, { max = 6 } = {}) {
    if (!text) return [];
    const out = [];
    const re = /[“"]([^”"]{25,300})[”"]/g;
    let m;
    while ((m = re.exec(text)) !== null && out.length < max) {
        out.push({ text: m[1].trim() });
    }
    return out;
}

// ── Corroboration ────────────────────────────────────────────────────────────

/**
 * Other candidates in this run covering the same event.
 *
 * Free: those feeds were already fetched. Gives the model a second independent
 * phrasing of the same facts, and supports a "reported by both X and Y"
 * attribution, which is the cheapest credibility signal available.
 */
function findCorroborators(candidate, allCandidates, { simThreshold = 0.45, maxN = 3 } = {}) {
    const { titleSimilarity } = require('./news-sources');
    return (allCandidates || [])
        .filter(o => o !== candidate && o.contentHash !== candidate.contentHash)
        .filter(o => o.sourceName !== candidate.sourceName)
        .map(o => ({ o, sim: titleSimilarity(candidate.titleTokens || candidate.title, o.titleTokens || o.title) }))
        .filter(x => x.sim >= simThreshold)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, maxN)
        .map(x => ({
            name: x.o.sourceName,
            url: x.o.link,
            headline: x.o.title,
            description: x.o.description || '',
        }));
}

// ── Fact sheet ───────────────────────────────────────────────────────────────

/**
 * Assemble everything known about one story.
 *
 * @returns {Promise<{headline, source_name, source_url, published_at, byline,
 *   lede, key_facts: string[], quotes, corroborating_sources, confidence}>}
 */
async function buildFactSheet(candidate, { allCandidates = [], logger = console } = {}) {
    const url = candidate.link;
    const base = {
        headline: candidate.title || '',
        source_name: candidate.sourceName || hostOf(url),
        source_url: url,
        published_at: candidate.pubDate || '',
        byline: '',
        lede: candidate.description || '',
        key_facts: [],
        quotes: [],
        corroborating_sources: findCorroborators(candidate, allCandidates),
        confidence: 'headline_only',
    };

    // Whatever the source page yields, the RSS lede is itself verified text
    // from the outlet. A substantial one supports attributed commentary, so it
    // counts as `partial` rather than dropping the story to headline-only.
    const fromRssOnly = () => {
        base.key_facts = toKeyFacts(base.lede, { max: 4 });
        if (base.lede.length >= USABLE_LEDE_CHARS && base.key_facts.length) {
            base.confidence = 'partial';
        }
        return base;
    };

    if (isBlocked(url)) {
        logger.log?.(`[facts] ${hostOf(url)} is blocklisted — using the RSS lede`);
        return fromRssOnly();
    }

    let html = null;
    try {
        html = await fetchSourcePage(url);
    } catch (e) {
        logger.warn?.(`[facts] fetch failed for ${url}: ${e.message}`);
    }

    if (!html) return fromRssOnly();

    const ld = extractJsonLdNewsArticle(html);
    const meta = extractMetaFacts(html);
    const paragraphs = extractBodyParagraphs(html);

    const body = (ld?.articleBody && ld.articleBody.length > 200) ? ld.articleBody : paragraphs;
    const lede = ld?.description || meta?.description || candidate.description || '';

    const sheet = {
        ...base,
        headline: ld?.headline || meta?.title || base.headline,
        published_at: ld?.datePublished || meta?.publishedTime || base.published_at,
        byline: ld?.author || '',
        source_name: ld?.publisher || meta?.siteName || base.source_name,
        lede,
        key_facts: toKeyFacts([lede, body].filter(Boolean).join(' ')),
        quotes: extractQuotes(body),
    };

    if ((ld?.articleBody && ld.articleBody.length > 400) || body.length >= 1200) {
        sheet.confidence = 'full';
    } else if (body.length > 0 || lede.length >= USABLE_LEDE_CHARS) {
        sheet.confidence = 'partial';
    }

    // A sheet with no usable facts is no better than the headline. Say so
    // honestly rather than letting the model treat thin input as solid.
    if (sheet.key_facts.length === 0) sheet.confidence = 'headline_only';

    return sheet;
}

/**
 * The fact sheet as the model sees it.
 *
 * Facts are numbered because the model must return `facts_used` — indices back
 * into this list. That turns "did it stay grounded?" into a machine-checkable
 * question instead of a manual read-through.
 */
function renderFactSheetBlock(sheet) {
    const lines = [
        'FACT SHEET',
        `Source: ${sheet.source_name}`,
        `Source URL: ${sheet.source_url}`,
        sheet.published_at ? `Published: ${sheet.published_at}` : null,
        sheet.byline ? `Byline: ${sheet.byline}` : null,
        `Confidence: ${sheet.confidence}`,
        '',
        `Headline: ${sheet.headline}`,
        sheet.lede ? `Lede: ${sheet.lede}` : null,
        '',
        'Numbered facts (cite these by index in facts_used):',
    ].filter(Boolean);

    if (sheet.key_facts.length) {
        sheet.key_facts.forEach((fact, i) => lines.push(`  [${i}] ${fact}`));
    } else {
        lines.push('  (none — only the headline above is verified)');
    }

    if (sheet.quotes.length) {
        lines.push('', 'Direct quotations from the source (safe to reuse verbatim):');
        sheet.quotes.forEach(q => lines.push(`  "${q.text}"`));
    }

    if (sheet.corroborating_sources.length) {
        lines.push('', 'Other outlets reporting the same event:');
        sheet.corroborating_sources.forEach(c => lines.push(`  - ${c.name}: ${c.headline}`));
    }

    return lines.join('\n');
}

/** Drop the per-run page cache. */
function clearPageCache() {
    _pageCache.clear();
}

module.exports = {
    SCRAPE_BLOCKLIST,
    isBlocked,
    fetchSourcePage,
    extractJsonLdNewsArticle,
    extractMetaFacts,
    extractBodyParagraphs,
    toKeyFacts,
    extractQuotes,
    findCorroborators,
    buildFactSheet,
    renderFactSheetBlock,
    clearPageCache,
};

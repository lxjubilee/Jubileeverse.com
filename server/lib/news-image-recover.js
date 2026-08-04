'use strict';
/**
 * lib/news-image-recover.js — Find the original photograph for a story that was
 * published before the pipeline started sourcing them.
 *
 * The live pipeline resolves a picture from HTML it already holds. Recovery has
 * none of that: an article published days ago carries only its headline, its
 * `source_url`, and the date. So this is a ladder of increasingly indirect
 * attempts, each of which can fail without ending the run:
 *
 *   source     the outlet's own page, re-fetched. Nearly always enough.
 *   wayback    the archived copy, for a URL that has since died.
 *   corroborate another outlet that covered the same story.
 *
 * The third rung is the dangerous one and is written defensively throughout.
 * Matching the wrong story does not produce a missing picture — it produces a
 * photograph of the wrong person on a real news article, published under our
 * name. Everything about its thresholds is chosen on that basis.
 */

const https = require('https');
const Facts = require('./source-facts');
const ImageSource = require('./news-image-source');
const { titleSimilarity, normalizeTitle } = require('./news-sources');
const { parseRssFeed, TOPIC_FEEDS } = require('./rss-feeds');

/**
 * Headline similarity required to accept another outlet's picture.
 *
 * 0.7, not the 0.45 used for corroborating sources in source-facts.js. That
 * threshold is tuned for a different consequence: a false positive there adds a
 * slightly-off "also reported by" line. Here it attaches a photograph to a
 * story it does not depict. The same codebase already uses 0.6 to decide two
 * headlines are the same event (news-sources.js), and this needs to be stricter
 * than that, not looser.
 */
const MIN_TITLE_SIMILARITY = 0.7;

/** Days either side of publication a corroborating report may carry. */
const DATE_WINDOW_DAYS = 2;

/** Outlets we will take a picture from — the ones we already syndicate. */
function trustedHosts() {
    const hosts = new Set();
    for (const feeds of Object.values(TOPIC_FEEDS)) {
        for (const feed of feeds) {
            try { hosts.add(new URL(feed).hostname.replace(/^www\./, '')); } catch { /* skip */ }
        }
    }
    return hosts;
}

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function isTrusted(url, hosts) {
    const host = hostOf(url);
    if (!host) return false;
    for (const t of hosts) if (host === t || host.endsWith(`.${t}`)) return true;
    return false;
}

/**
 * Capitalised words in a headline that are not sentence-initial.
 *
 * Used as a second, independent check on a corroborator: Jaccard overlap treats
 * all tokens alike, so two unrelated stories about "senate funding vote" can
 * score well while naming completely different people. Requiring a shared
 * proper noun means the match has to agree on WHO or WHERE, not just about what.
 */
function properNouns(title) {
    return new Set(
        String(title || '')
            .split(/\s+/)
            .slice(1)
            .filter(w => /^[A-Z][a-zA-Z'’-]{2,}$/.test(w))
            .map(w => w.toLowerCase().replace(/[^a-z]/g, '')),
    );
}

function sharesProperNoun(a, b) {
    const nounsA = properNouns(a);
    if (!nounsA.size) return true;   // nothing to check against; other gates stand
    const nounsB = properNouns(b);
    for (const n of nounsA) if (nounsB.has(n)) return true;
    return false;
}

// ── Rung 1: the source page ──────────────────────────────────────────────────

/**
 * Every image URL a page's own markup offers, best first.
 *
 * Both og:image AND the JSON-LD image, not the first of the two: they
 * disagree often enough to matter, and when og:image turns out to be a
 * thumbnail or a share-card template the LD entry is frequently the full
 * frame. The caller validates in order and takes the first that survives.
 */
function imagesFromHtml(html, pageUrl) {
    if (!html) return [];
    const meta = Facts.extractMetaFacts(html);
    const ld = Facts.extractJsonLdNewsArticle(html);

    const out = [];
    const seen = new Set();
    const add = (raw, stage) => {
        const url = Facts.absoluteUrl(raw, pageUrl);
        if (!url || seen.has(url)) return;
        seen.add(url);
        out.push({ url, stage });
    };

    add(meta?.image, 'og');
    add(ld?.image, 'jsonld');
    return out;
}

/** The single best image on a page, or a null URL. */
function imageFromHtml(html, pageUrl) {
    const [first] = imagesFromHtml(html, pageUrl);
    return first ? { url: first.url, stage: first.stage } : { url: null, stage: '' };
}

/** Try each candidate in turn, returning the first that passes validation. */
async function firstUsable(candidates, { onReject } = {}) {
    for (const c of candidates) {
        let prepared;
        try {
            prepared = await prepareRecovered(c.url);
        } catch (e) {
            prepared = { ok: false, reason: e.message.slice(0, 80) };
        }
        if (prepared.ok) return { ...c, prepared };
        onReject?.(c, prepared.reason);
    }
    return null;
}

// ── Rung 2: the Wayback Machine ──────────────────────────────────────────────

/** Fetch JSON over https with a hard timeout. Null on anything unexpected. */
function getJson(url, { timeoutMs = 12000 } = {}) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'JubileeVerse/1.0 (+https://jubileeverse.com)', 'Accept': 'application/json' },
            timeout: timeoutMs,
        }, (res) => {
            if (res.statusCode !== 200) { res.resume(); return resolve(null); }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', c => { body += c; if (body.length > 512 * 1024) { req.destroy(); resolve(null); } });
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
            res.on('error', () => resolve(null));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

/**
 * The archived snapshot of a URL nearest a date, or null.
 *
 * A three-day-old story usually has no snapshot at all, so this rung earns its
 * keep only on the older tail of the corpus. Rate-limited by the caller.
 */
async function waybackSnapshot(url, dateYmd) {
    const stamp = String(dateYmd || '').replace(/-/g, '');
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`
        + (stamp ? `&timestamp=${stamp}` : '');
    const data = await getJson(api);
    const snap = data?.archived_snapshots?.closest;
    return (snap?.available && snap.url) ? snap.url : null;
}

/**
 * Rewrite an archived asset URL to the raw-image form.
 *
 * Wayback serves `/web/<ts>/<original>` as an HTML wrapper page. The `im_`
 * modifier — `/web/<ts>im_/<original>` — returns the stored bytes instead.
 * Without this the "image" downloads as HTML and fails validation with a
 * confusing reason.
 */
function waybackRawImageUrl(archivedUrl) {
    return String(archivedUrl || '').replace(/\/web\/(\d{14})(?:[a-z_]+)?\//, '/web/$1im_/');
}

// ── Rung 3: another outlet's coverage ────────────────────────────────────────

/** Fetch text over https with a hard timeout. */
function getText(url, { timeoutMs = 12000, maxBytes = 1024 * 1024 } = {}) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.8',
            },
            timeout: timeoutMs,
        }, (res) => {
            if (res.statusCode !== 200) { res.resume(); return resolve(''); }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', c => { body += c; if (body.length > maxBytes) { req.destroy(); resolve(body); } });
            res.on('end', () => resolve(body));
            res.on('error', () => resolve(''));
        });
        req.on('error', () => resolve(''));
        req.on('timeout', () => { req.destroy(); resolve(''); });
    });
}

/**
 * Other outlets' reports of the same story, from Google News search.
 *
 * Every candidate must clear four independent gates before its picture is
 * touched: a trusted host, headline similarity, a shared proper noun, and a
 * publication date near ours. Any one of them alone is too weak — together they
 * are what stands between this rung and a wrong photograph.
 */
async function findCorroboratingImage(entry, { hosts, logger = console } = {}) {
    const query = encodeURIComponent(entry.title || '');
    if (!query) return { url: null, stage: '', reason: 'no headline to search on' };

    const xml = await getText(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`);
    if (!xml) return { url: null, stage: '', reason: 'news search returned nothing' };

    let items;
    try {
        items = parseRssFeed(xml, 'google-news');
    } catch {
        return { url: null, stage: '', reason: 'news search was unparseable' };
    }

    const ourTokens = normalizeTitle(entry.title);
    const published = entry.date_published ? Date.parse(`${entry.date_published}T12:00:00Z`) : NaN;
    const windowMs = DATE_WINDOW_DAYS * 86400000;
    const ourHost = hostOf(entry.source_url);

    const ranked = items
        .map(item => ({ item, sim: titleSimilarity(ourTokens, item.title) }))
        .filter(({ sim }) => sim >= MIN_TITLE_SIMILARITY)
        .sort((a, b) => b.sim - a.sim);

    for (const { item, sim } of ranked.slice(0, 6)) {
        // Google wraps every link in a news.google.com redirector, and the
        // wrapper cannot be trusted to be the outlet. Resolve it by fetching,
        // and judge the page we actually land on.
        const link = item.link;
        if (!link) continue;
        if (hostOf(link) === ourHost) continue;              // the dead original
        if (!sharesProperNoun(entry.title, item.title)) continue;

        if (Number.isFinite(published) && item.pubDate) {
            const when = Date.parse(item.pubDate);
            if (Number.isFinite(when) && Math.abs(when - published) > windowMs) continue;
        }

        const html = await Facts.fetchSourcePage(link);
        if (!html) continue;

        // The host is checked AFTER the fetch because Google's redirector hides
        // it; whatever we ended up on has to be an outlet we already syndicate.
        const landed = imageFromHtml(html, link);
        if (!landed.url) continue;
        if (!isTrusted(link, hosts)) {
            logger.log?.(`      skipping ${hostOf(link)} — not a syndicated outlet`);
            continue;
        }

        return {
            url: landed.url,
            stage: 'corroborated',
            via: link,
            via_title: item.title,
            similarity: Number(sim.toFixed(3)),
        };
    }

    return { url: null, stage: '', reason: `no corroborating report cleared ${MIN_TITLE_SIMILARITY} similarity` };
}

// ── The ladder ───────────────────────────────────────────────────────────────

/**
 * Find a publishable original photograph for one already-published article.
 *
 * Validates as it goes rather than returning the first URL it sees. A page can
 * offer an og:image that turns out to be a 150x150 thumbnail or the outlet's
 * house card, and treating "found a URL" as "found a picture" would report a
 * recovery that the apply step then cannot honour — the plan has to be a
 * promise the run can keep.
 *
 * The validated bytes come back with the result, so nothing is downloaded twice.
 *
 * @returns {Promise<{url: string|null, stage: string, prepared?: object,
 *   attempts: object[], via?: string}>}
 */
async function recoverImage(entry, { hosts = trustedHosts(), logger = console, useWayback = true, useCorroboration = true } = {}) {
    const attempts = [];
    const note = (rung) => (c, reason) => attempts.push({ rung, ok: false, url: c.url, reason });

    // 1. The outlet's own page.
    if (entry.source_url) {
        const html = await Facts.fetchSourcePage(entry.source_url);
        if (html) {
            const candidates = imagesFromHtml(html, entry.source_url);
            if (candidates.length) {
                const win = await firstUsable(candidates, { onReject: note('source') });
                if (win) return { url: win.url, stage: win.stage, prepared: win.prepared, attempts };
            } else {
                attempts.push({ rung: 'source', ok: false, reason: 'page has no og:image or JSON-LD image' });
            }
        } else {
            attempts.push({ rung: 'source', ok: false, reason: 'page unreachable' });
        }
    } else {
        attempts.push({ rung: 'source', ok: false, reason: 'no source_url recorded' });
    }

    // 2. The archived copy.
    if (useWayback && entry.source_url) {
        const snapshot = await waybackSnapshot(entry.source_url, entry.date_published);
        if (snapshot) {
            const html = await Facts.fetchSourcePage(snapshot);
            const candidates = imagesFromHtml(html, snapshot)
                .map(c => ({ ...c, url: waybackRawImageUrl(c.url), stage: 'wayback' }));
            if (candidates.length) {
                const win = await firstUsable(candidates, { onReject: note('wayback') });
                if (win) return { url: win.url, stage: 'wayback', prepared: win.prepared, via: snapshot, attempts };
            } else {
                attempts.push({ rung: 'wayback', ok: false, reason: 'snapshot has no image' });
            }
        } else {
            attempts.push({ rung: 'wayback', ok: false, reason: 'no snapshot' });
        }
    }

    // 3. Another outlet covering the same story.
    if (useCorroboration) {
        const found = await findCorroboratingImage(entry, { hosts, logger });
        if (found.url) {
            const win = await firstUsable([found], { onReject: note('corroborate') });
            if (win) return { ...found, prepared: win.prepared, attempts };
        } else {
            attempts.push({ rung: 'corroborate', ok: false, reason: found.reason });
        }
    }

    return { url: null, stage: 'none', attempts };
}

/**
 * Fetch, validate and normalise a recovered URL.
 *
 * Exactly the same gates the live pipeline applies. Recovery must not be a
 * quieter path to a lower bar — a house logo recovered from an archive is no
 * more publishable than one resolved live.
 */
async function prepareRecovered(url) {
    const { buffer, contentType } = await ImageSource.fetchImage(url);
    const verdict = await ImageSource.validateSourcedImage(buffer, { contentType, url });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    return {
        ok: true,
        webp: await ImageSource.normalizeSourcedImage(buffer),
        phash: await ImageSource.imageHash(buffer),
        meta: verdict.meta,
    };
}

module.exports = {
    MIN_TITLE_SIMILARITY,
    DATE_WINDOW_DAYS,
    trustedHosts,
    isTrusted,
    properNouns,
    sharesProperNoun,
    imageFromHtml,
    imagesFromHtml,
    firstUsable,
    waybackSnapshot,
    waybackRawImageUrl,
    findCorroboratingImage,
    recoverImage,
    prepareRecovered,
};

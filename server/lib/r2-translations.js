'use strict';
/**
 * lib/r2-translations.js — translated articles, stored beside the English ones.
 *
 * Every non-English reader who opened an article used to pay for a fresh model
 * call on the whole body. A PostgreSQL cache existed, but it is per-environment:
 * dev, UAT and production each held their own, a database reset lost all of it,
 * and none of it could be looked at. The articles themselves already live in R2
 * and are read from the CDN by every environment, so the translations belong
 * there too.
 *
 * Key layout — the language code is a folder segment, and it sits *between* the
 * date and the slug:
 *
 *   news/2026/08/09/<slug>/article.md            English
 *   news/2026/08/09/hi-IN/<slug>/article.md      Hindi
 *
 *   articles/<category>/<slug>.md                English
 *   articles/<category>/hi-IN/<slug>.md          Hindi
 *
 * That placement is not cosmetic. `news/<Y>/<M>/<D>/<slug>/` is a published
 * contract — src/lib/news.ts reads it, and repairManifest in
 * scripts/publish-daily-news.js walks each `<slug>/` as one article — so putting
 * the language *inside* the article folder would make a `hi-IN/` directory
 * appear where that scan expects images, and appending it to the slug would make
 * the slug ambiguous against news/slugs.json. One segment earlier, a translation
 * is invisible to both.
 *
 * There is deliberately no `en-US` folder. English is the stored article; a copy
 * of it under a language key could only drift from the original.
 *
 * Nothing in this module throws into a request path. A cache that is unavailable
 * must never block a translation — the same rule the PostgreSQL caches in
 * server.js already follow.
 */

const {
    putObject, getObjectText, headObject, cdnUrl, isConfigured,
    pstDateString, dateFromPstString,
} = require('./r2-client');
const { newsDayPrefix, fmValue } = require('./r2-news');
const { canonicalLang, isTranslatable, LANG_CODE_RE } = require('./languages');

const ARTICLES_PREFIX = 'articles';
const TRANSLATION_SCHEMA = 'jv.translation/1';

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';
/** Matches CACHE_ARTICLE in r2-news.js — a translation is an article. */
const CACHE_TRANSLATION = 'public, max-age=300';

/**
 * Every segment interpolated into a key is checked against one of these first.
 * Anchored on purpose, not for tidiness: this is what stops `..`, a leading
 * slash, or an embedded one from walking out of the prefix a key belongs to.
 */
const SLUG_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_SEGMENT  = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Route slug -> published folder, mirroring FOLDER_BY_ROUTE in
 * src/lib/articles.ts. The nav links to "torah-hebraic-insights" but the bundle
 * is published as "torah-hebraic", and an unmapped route would send translations
 * to a folder no English article lives in: the write succeeds, and every later
 * read misses forever. tests/unit/translation-languages-sync.test.js holds this
 * against the TypeScript original.
 */
const FOLDER_BY_ROUTE = Object.freeze({
    'torah-hebraic-insights': 'torah-hebraic',
});

/** How long the read on the cheap path may take before it is abandoned. */
const READ_DEADLINE_MS = 3000;

// ── Keys ─────────────────────────────────────────────────────────────────────

/** The catalogue's spelling of `lang`, or throw. */
function requireLang(lang) {
    const canonical = canonicalLang(lang);
    if (!isTranslatable(canonical)) throw new Error(`Not a translation language: "${lang}"`);
    // Belt and braces: the allowlist decides *which* languages, this decides what
    // a language may look like at all, and the second is what the no-collision
    // property with article slugs rests on.
    if (!LANG_CODE_RE.test(canonical)) throw new Error(`Malformed language code: "${canonical}"`);
    return canonical;
}

function requireSegment(value, pattern, what) {
    const str = String(value ?? '').trim();
    if (!pattern.test(str)) throw new Error(`Invalid ${what}: "${value}"`);
    return str;
}

/**
 * 'YYYY-MM-DD' -> 'news/YYYY/MM/DD/'.
 *
 * The round trip through dateFromPstString is the actual validation. The pattern
 * alone accepts 2026-13-45, which Date would roll forward into 2027/01/14 — a
 * perfectly well-formed key for a day that was never asked for.
 */
function newsDayPrefixFor(date) {
    const day = requireSegment(date, DAY_SEGMENT, 'date');
    const parsed = dateFromPstString(day);
    if (pstDateString(parsed) !== day) throw new Error(`Invalid date: "${date}"`);
    return newsDayPrefix(parsed);
}

/** 'news/2026/08/09/hi-IN/<slug>/article.md' */
function buildNewsTranslationKey({ date, slug, lang }) {
    const prefix = newsDayPrefixFor(date);
    return `${prefix}${requireLang(lang)}/${requireSegment(slug, SLUG_SEGMENT, 'slug')}/article.md`;
}

/** 'news/2026/08/09/<slug>/article.md' — the English article a translation came from. */
function buildNewsSourceKey({ date, slug }) {
    return `${newsDayPrefixFor(date)}${requireSegment(slug, SLUG_SEGMENT, 'slug')}/article.md`;
}

/** 'articles/torah-hebraic/hi-IN/<slug>.md' */
function buildArticleTranslationKey({ category, slug, lang }) {
    const folder = requireSegment(folderForRoute(category), SLUG_SEGMENT, 'category');
    return `${ARTICLES_PREFIX}/${folder}/${requireLang(lang)}/${requireSegment(slug, SLUG_SEGMENT, 'slug')}.md`;
}

/** 'articles/torah-hebraic/<slug>.md' */
function buildArticleSourceKey({ category, slug }) {
    const folder = requireSegment(folderForRoute(category), SLUG_SEGMENT, 'category');
    return `${ARTICLES_PREFIX}/${folder}/${requireSegment(slug, SLUG_SEGMENT, 'slug')}.md`;
}

/** The published folder backing a route slug. */
function folderForRoute(routeSlug) {
    const slug = String(routeSlug ?? '').trim();
    return FOLDER_BY_ROUTE[slug] || slug;
}

/**
 * Where one (article, language) is stored, or null when it has no CDN home.
 *
 * Both translation endpoints call this and nothing else. Two copies of the
 * derivation is how the lookup and the write end up naming different keys and
 * the cache never hits once.
 *
 * News coordinates have to be passed in: a news article reaches the endpoints as
 * reactionIdForSlug(slug), a one-way hash, so the server cannot recover the day
 * or the slug from it. A published bundle needs nothing — its id already *is*
 * `<category>__<slug>`.
 *
 * Everything else — a backend serial, a UUID — resolves to null. Those articles
 * live in the database, not on the CDN, and stay on the PostgreSQL cache.
 *
 * Never throws. A caller sending junk gets no CDN leg, not a 500.
 */
function resolveTranslationTarget({ id, lang, newsDate, newsSlug } = {}) {
    try {
        const canonical = canonicalLang(lang);
        if (!isTranslatable(canonical)) return null;

        if (newsDate && newsSlug) {
            return {
                kind: 'news',
                lang: canonical,
                key: buildNewsTranslationKey({ date: newsDate, slug: newsSlug, lang: canonical }),
                sourceKey: buildNewsSourceKey({ date: newsDate, slug: newsSlug }),
            };
        }

        const parts = String(id ?? '').split('__');
        if (parts.length === 2 && SLUG_SEGMENT.test(parts[0]) && SLUG_SEGMENT.test(parts[1])) {
            const [category, slug] = parts;
            return {
                kind: 'article',
                lang: canonical,
                key: buildArticleTranslationKey({ category, slug, lang: canonical }),
                sourceKey: buildArticleSourceKey({ category, slug }),
            };
        }

        return null;
    } catch {
        return null;
    }
}

// ── Stored format ────────────────────────────────────────────────────────────

/**
 * One translation as Markdown with frontmatter.
 *
 * Markdown rather than JSON for the reason r2-news.js gives: the object sits in
 * the same tree as the article it translates, and is readable straight off the
 * CDN by anyone auditing what a reader was served.
 *
 * Values go through r2-news.js's own fmValue, so the single-line rule every
 * frontmatter parser in this codebase depends on holds here too.
 */
function renderTranslationMarkdown({
    lang, kind, sourceKey, sourceHash, sourceObject,
    title, sourceBadge, category, isRtl, model, content, translatedAt,
}) {
    const fm = [
        '---',
        `schema: ${TRANSLATION_SCHEMA}`,
        `lang: ${lang}`,
        `source_kind: ${kind || ''}`,
        `source_key: ${sourceKey || ''}`,
        `source_hash: ${sourceHash || ''}`,
        `source_object: ${sourceObject || ''}`,
        `title: ${fmValue(title || '')}`,
        `source_badge: ${fmValue(sourceBadge || '')}`,
        `category: ${fmValue(category || '')}`,
        `is_rtl: ${isRtl ? 'true' : 'false'}`,
        `model: ${model || ''}`,
        `translated_at: ${translatedAt || new Date().toISOString()}`,
        '---',
        '',
    ];
    return `${fm.join('\n')}\n${String(content || '').trim()}\n`;
}

/**
 * Frontmatter and body, or null when this is not a translation object.
 *
 * Returning null for a missing block or an empty body is what makes a truncated
 * or hand-mangled object read as a cache miss: the reader gets a fresh
 * translation rather than a blank article. The same rule the GET endpoint
 * already applies to a PostgreSQL row that holds nothing once cleaned.
 */
function parseTranslationMarkdown(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!match) return null;

    const fm = {};
    for (const line of match[1].split(/\r?\n/)) {
        const pair = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
        if (!pair) continue;
        let value = pair[2].trim();
        // Structured values are skipped rather than half-parsed, matching every
        // other frontmatter reader here — fmValue guarantees none are written.
        if (value.startsWith('[') || value.startsWith('{')) continue;
        if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
            // One pass, so fmValue's \\ and \" both round-trip. The copy of this
            // parser in publish-daily-news.js handles only \", which turns a
            // backslash in a headline into an escape for whatever followed it.
            value = value.slice(1, -1).replace(/\\(.)/g, '$1');
        }
        fm[pair[1]] = value;
    }

    const content = text.slice(match[0].length).trim();
    if (!content) return null;
    // '"false"' is truthy, and an article that renders right-to-left because of
    // it is unreadable rather than merely wrong.
    return { fm, isRtl: fm.is_rtl === 'true', content };
}

// ── Read / write ─────────────────────────────────────────────────────────────

/**
 * Abandon a promise that takes too long, rather than waiting on it.
 *
 * The read below sits on the *cheap* path, and GET /api/articles/:id/translation
 * is on the shared 30 s request timeout (LONG_RUNNING_PATHS lists /translate,
 * not this route). A wedged R2 would therefore turn the fast path into a 503 —
 * strictly worse than the model call it was there to avoid.
 */
function withDeadline(promise, ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            () => { clearTimeout(timer); resolve(null); },
        );
    });
}

/**
 * The English object's identity, for detecting that it has been re-published.
 *
 * putObject writes a sha256 of every body it uploads, so anything this pipeline
 * published has one; an ETag covers whatever else may have put the file there.
 * Null when the object is absent or unreadable.
 */
async function sourceFingerprint(sourceKey) {
    if (!isConfigured() || !sourceKey) return null;
    const head = await withDeadline(headObject(sourceKey), READ_DEADLINE_MS);
    if (!head) return null;
    if (head.metadata && head.metadata.sha256) return `sha256:${head.metadata.sha256}`;
    return head.etag ? `etag:${String(head.etag).replace(/"/g, '')}` : null;
}

/**
 * The stored translation for `target`, or null.
 *
 * Null covers every reason a caller should translate instead: no credentials, no
 * object, an unreadable one, a slow one — and a stale one. Staleness is decided
 * by whichever witness the caller has:
 *
 *   - `sourceHash`, the hash of the very text about to be translated. Exact, and
 *     only the POST path holds it.
 *   - `sourceObject`, the English object's fingerprint at the time the
 *     translation was written. All the GET path can know, and it costs one HEAD.
 *
 * A witness the stored object does not carry is not evidence of staleness —
 * objects written before a field existed must not all invalidate at once.
 */
async function readTranslation(target, { sourceHash, sourceObject } = {}) {
    if (!target || !isConfigured()) return null;
    try {
        const raw = await withDeadline(getObjectText(target.key), READ_DEADLINE_MS);
        const parsed = parseTranslationMarkdown(raw);
        if (!parsed) return null;

        if (sourceHash && parsed.fm.source_hash && parsed.fm.source_hash !== sourceHash) return null;
        if (sourceObject && parsed.fm.source_object && parsed.fm.source_object !== sourceObject) return null;

        return {
            title: parsed.fm.title || '',
            content: parsed.content,
            isRtl: parsed.isRtl,
            sourceBadge: parsed.fm.source_badge || '',
            category: parsed.fm.category || '',
            sourceHash: parsed.fm.source_hash || '',
            sourceObject: parsed.fm.source_object || '',
            key: target.key,
        };
    } catch (e) {
        console.warn(`[Translation] CDN read failed for ${target.key}: ${e.message}`);
        return null;
    }
}

/**
 * Store one translation.
 *
 * A blind PUT of a self-contained object, with no locking, and that is a
 * decision rather than an oversight: two readers who pick the same language at
 * the same moment both translate and both write here. A PUT is atomic, so
 * neither ever serves a partial object, and both bodies are valid translations
 * of the same source — last write wins and the loser cost one model call.
 * Deliberately unlike upsertNewsDayIndex, which needs care because it is a
 * read-modify-write.
 */
async function writeTranslation(target, payload) {
    if (!target) throw new Error('No translation target');
    if (!isConfigured()) throw new Error('R2 credentials not configured');

    const body = renderTranslationMarkdown({
        ...payload,
        lang: target.lang,
        kind: target.kind,
        sourceKey: target.sourceKey,
    });

    return putObject({
        key: target.key,
        body,
        contentType: MARKDOWN_CONTENT_TYPE,
        cacheControl: CACHE_TRANSLATION,
        metadata: { lang: target.lang, source_kind: target.kind },
    });
}

/** Public URL of a stored translation, for logs and manual inspection. */
const translationUrl = (target) => cdnUrl(target.key);

module.exports = {
    ARTICLES_PREFIX,
    TRANSLATION_SCHEMA,
    FOLDER_BY_ROUTE,
    SLUG_SEGMENT,
    DAY_SEGMENT,
    READ_DEADLINE_MS,
    folderForRoute,
    buildNewsTranslationKey,
    buildNewsSourceKey,
    buildArticleTranslationKey,
    buildArticleSourceKey,
    resolveTranslationTarget,
    renderTranslationMarkdown,
    parseTranslationMarkdown,
    sourceFingerprint,
    readTranslation,
    writeTranslation,
    translationUrl,
};

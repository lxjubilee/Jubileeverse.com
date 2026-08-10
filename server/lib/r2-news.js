'use strict';
/**
 * lib/r2-news.js — Publish daily faith-based news articles to Cloudflare R2.
 *
 * Key convention (date-partitioned in PST, one folder per article):
 *
 *   news/{YYYY}/{MM}/{DD}/{slug}/article.md
 *   news/{YYYY}/{MM}/{DD}/{slug}/images/{12-char-id}.webp
 *   news/{YYYY}/{MM}/{DD}/index.json      day manifest — authoritative
 *   news/latest.json                       rolling pointer to recent days
 *
 * Public URL:
 *   https://cdn.jubileeverse.com/news/2026/07/31/church-zoning-ruling/article.md
 *
 * Image filenames are opaque 12-char alphanumeric ids, not 01/02/03 ordinals —
 * display order lives in the manifest's `n` field. Ids are derived from the
 * article id (see news-images.mintImageId), not random, so a re-run produces
 * the same keys and can skip work that already landed.
 *
 * R2 is the store of record for this pipeline. The manifest is authoritative:
 * an article.md that no index.json lists is unreachable by the site, which is
 * what lets us upload bytes first and make them visible last.
 */

const {
    putObject, headObject, getObjectJson, listPrefix, deleteObjects,
    pstDateParts, pstDateString, cdnUrl, isConfigured,
} = require('./r2-client');

const NEWS_PREFIX      = 'news';
const NEWS_LATEST_KEY  = `${NEWS_PREFIX}/latest.json`;
const NEWS_STATUS_KEY  = `${NEWS_PREFIX}/status.json`;
const NEWS_SLUGS_KEY   = `${NEWS_PREFIX}/slugs.json`;
const DAY_SCHEMA       = 'jv.news.day/1';
const LATEST_SCHEMA    = 'jv.news.latest/1';
const STATUS_SCHEMA    = 'jv.news.status/1';
const SLUGS_SCHEMA     = 'jv.news.slugs/1';
const ARTICLE_SCHEMA   = 'jv.news.article/1';

// Published image format. WebP is ~10x smaller than the source JPEG most
// outlets serve. Legacy .png objects still resolve because keys are read from
// the manifest, never rebuilt from an assumed extension.
const IMAGE_EXT          = 'webp';
const IMAGE_CONTENT_TYPE = 'image/webp';
const DEFAULT_WRITER   = 'JubileeVerse Newsroom';

/**
 * Images a complete article carries.
 *
 * One: the photograph the originating outlet ran with the story. It was three
 * while the pipeline rendered its own illustrations, but the reader only ever
 * saw the first — `toReaderBody` in src/lib/news.ts strips every image out of
 * the body — so the other two were GPU time spent on files nobody opened.
 *
 * This is what `image_status: generated` means, so it has to be a constant
 * rather than a literal 3 repeated in three places: left at 3, every article
 * would report `partial` forever and the run status would never read `ok`.
 */
const EXPECTED_IMAGES = 1;

/**
 * Floor for "this object is a real image rather than a truncated upload".
 *
 * Deliberately low. The previous 10KB floor was calibrated against 1344x768
 * photographic renders, and a real photograph that happens to compress well
 * lands under it — at which point the image uploads, the manifest filters it
 * out, and the article silently drops to draft with nothing logged.
 */
const MIN_IMAGE_BYTES = 2 * 1024;

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';
const JSON_CONTENT_TYPE     = 'application/json; charset=utf-8';

const CACHE_ARTICLE = 'public, max-age=300';
// Not immutable: a regenerated image must be able to land within the week.
const CACHE_IMAGE   = 'public, max-age=604800';
const CACHE_INDEX   = 'public, max-age=60';

// ── Keys ─────────────────────────────────────────────────────────────────────

/** 'news/2026/07/31/' */
function newsDayPrefix(date = new Date()) {
    const { yyyy, mm, dd } = pstDateParts(date);
    return `${NEWS_PREFIX}/${yyyy}/${mm}/${dd}/`;
}

/** 'news/2026/07/31/<slug>/' */
function newsArticlePrefix(article, date = new Date()) {
    return `${newsDayPrefix(date)}${requireSlug(article)}/`;
}

function buildNewsArticleKey(article, date = new Date()) {
    return `${newsArticlePrefix(article, date)}article.md`;
}

function buildNewsImageKey(article, imageId, date = new Date(), ext = IMAGE_EXT) {
    if (!/^[0-9A-Za-z]{12}$/.test(String(imageId || ''))) {
        throw new Error(`Image id must match ^[0-9A-Za-z]{12}$, got "${imageId}"`);
    }
    return `${newsArticlePrefix(article, date)}images/${imageId}.${ext}`;
}

function buildNewsDayIndexKey(date = new Date()) {
    return `${newsDayPrefix(date)}index.json`;
}

/** Stable single-segment id for routing: '2026-07-31__church-zoning-ruling'. */
function buildNewsArticleId(article, date = new Date()) {
    return `${pstDateString(date)}__${requireSlug(article)}`;
}

function requireSlug(article) {
    const slug = String(article?.slug || '').trim();
    if (!slug) throw new Error('Article has no slug');
    return slug;
}

/** Words not worth spending slug length on. Dropped only when trimming. */
const SLUG_STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
    'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
    'it', 'its', 'this', 'that', 'has', 'have', 'had', 'will', 'would',
]);

const SLUG_MAX = 70;

/**
 * SEO-friendly slug from a headline.
 *
 * Differs from r2-client's slugify in three ways that matter for readability,
 * and is kept separate so the live current-events keys are not disturbed:
 *
 *   - Apostrophes are removed rather than turned into separators, so
 *     "Seoul's Chip Stocks" reads "seouls-chip-stocks", not "seoul-s-chip-...".
 *   - Truncation lands on a word boundary. Cutting at a fixed character count
 *     produced "...keep-the-lights-on-until-decem", which is a worse URL than
 *     one word shorter.
 *   - If the headline is still too long once whole words are kept, leading
 *     stopwords are dropped before content words are.
 */
function newsSlugify(headline, maxLen = SLUG_MAX) {
    const words = String(headline || '')
        .toLowerCase()
        .replace(/[‘’']/g, '')      // possessives and contractions
        .replace(/&/g, ' and ')
        .replace(/%/g, ' percent ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (!words.length) return 'article';

    const fit = (list) => {
        const out = [];
        let length = 0;
        for (const word of list) {
            const next = length ? length + 1 + word.length : word.length;
            if (next > maxLen) break;
            out.push(word);
            length = next;
        }
        return out;
    };

    let kept = fit(words);
    // Everything fit, or we lost more than a third of the headline: try again
    // without the leading filler words so the slug keeps its meaning.
    if (kept.length < words.length && kept.length < Math.ceil(words.length * 0.66)) {
        const trimmed = words.filter((w, i) => !(i > 0 && SLUG_STOPWORDS.has(w)));
        const alt = fit(trimmed);
        if (alt.length > kept.length) kept = alt;
    }
    if (!kept.length) kept = [words[0].slice(0, maxLen)];

    return kept.join('-').replace(/^-+|-+$/g, '') || 'article';
}

/**
 * Claim the slug for one story within a day.
 *
 * The identity of a story is its content hash, never its headline. Re-composing
 * the same story produces a slightly different headline every time, so keying
 * folders off the title made a re-run mint a second folder for a story that was
 * already published, leaving the first one orphaned. Checking the hash first is
 * what makes a re-run update in place.
 *
 * @param {string} headline
 * @param {string} contentHash        stable per-story id
 * @param {object} claims
 * @param {Map<string,string>} claims.byHash  contentHash -> slug already published
 * @param {Map<string,string>} claims.bySlug  slug -> contentHash that owns it
 * @returns {string} a slug unique within the day
 */
function claimNewsSlug(headline, contentHash, { byHash = new Map(), bySlug = new Map() } = {}) {
    const hash = String(contentHash || '');

    // 1. This story already owns a folder today. Reuse it, whatever the new
    //    headline says.
    const existing = byHash.get(hash);
    if (existing) return existing;

    const base = newsSlugify(headline);

    // 2. Free, or already ours.
    const owner = bySlug.get(base);
    if (!owner || owner === hash) return base;

    // 3. A different story wants the same words. Disambiguate deterministically
    //    so a re-run of THIS story picks the same suffix again.
    const suffix = require('crypto').createHash('sha256').update(hash).digest('hex').slice(0, 6);
    let candidate = `${newsSlugify(headline, SLUG_MAX - 7)}-${suffix}`;

    // 4. Vanishingly unlikely, but never return a slug someone else owns.
    let n = 2;
    while (bySlug.has(candidate) && bySlug.get(candidate) !== hash) {
        candidate = `${newsSlugify(headline, SLUG_MAX - 9)}-${suffix}-${n++}`;
    }
    return candidate;
}

/**
 * Slug claims, from a day manifest or a flat list of entries.
 *
 * Callers should pass the WHOLE retention window, not just today: article URLs
 * are the bare slug, so a slug reused on a later day would make that URL
 * ambiguous. Claiming across the window forces the second story onto a suffixed
 * slug instead.
 *
 * `byHash` is still keyed to today only by the caller, since reusing a folder
 * is a same-day concern; `bySlug` is what needs the wider view.
 */
function readSlugClaims(manifestOrEntries) {
    const entries = Array.isArray(manifestOrEntries)
        ? manifestOrEntries
        : (manifestOrEntries?.articles || []);

    const byHash = new Map();
    const bySlug = new Map();
    for (const entry of entries) {
        if (!entry?.slug) continue;
        const hash = entry.content_hash || entry.slug;
        bySlug.set(entry.slug, hash);
        if (entry.content_hash) byHash.set(entry.content_hash, entry.slug);
    }
    return { byHash, bySlug };
}

/** @deprecated use claimNewsSlug — kept so older callers keep working. */
function newsSlug(headline, upstreamId, taken = new Map()) {
    return claimNewsSlug(headline, upstreamId, { bySlug: taken });
}

// ── Markdown ─────────────────────────────────────────────────────────────────

/**
 * Quote a frontmatter scalar.
 *
 * Hard constraint: the parsers that read these files (src/lib/articles.ts and
 * scripts/rebuild-article-manifests.js) are single-line and skip any value
 * starting with '[' or '{'. So every value must be one line, and anything
 * structured belongs in index.json instead.
 */
function fmValue(value) {
    const flat = String(value ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Render one news article as Markdown.
 *
 * Image references are absolute CDN URLs. Relative paths do not resolve for
 * anything reading the file off cdn.jubileeverse.com, which is the defect this
 * avoids repeating from r2-content.js's cached_image_path handling.
 *
 * Only images present in `images` are referenced — never emit a link to a file
 * whose upload was not confirmed.
 *
 * @param {object} article
 * @param {Array<{n:number, url:string, role?:string}>} [options.images]
 */
function buildNewsMarkdown(article, { images = [], date = new Date() } = {}) {
    const ordered = [...images].filter(i => i && i.url).sort((a, b) => a.n - b.n);
    const hero = ordered.find(i => i.n === 1) || ordered[0] || null;
    const rest = ordered.filter(i => i !== hero);
    const slug = requireSlug(article);
    const articlePrefix = newsArticlePrefix(article, date);
    const title = article.title || '';

    const fm = [
        '---',
        `schema: ${ARTICLE_SCHEMA}`,
        `id: ${buildNewsArticleId(article, date)}`,
        `slug: ${slug}`,
        `title: ${fmValue(title)}`,
        `writer: ${fmValue(article.writer || DEFAULT_WRITER)}`,
        `topic: ${article.topic || ''}`,
        `category: ${fmValue(article.category || '')}`,
        `date_published: ${article.date_published || pstDateString(date)}`,
        `date_updated: ${article.date_updated || new Date().toISOString()}`,
        `source_name: ${fmValue(article.source_name || '')}`,
        `source_url: ${article.source_url || ''}`,
        // The story's identity, carried in the article itself so a manifest
        // rebuilt from storage keeps its dedupe and slug-reuse keys.
        `content_hash: ${article.content_hash || ''}`,
        `fact_confidence: ${article.fact_confidence || 'headline_only'}`,
        `image_set_id: ${article.image_set_id || ''}`,
        `image_status: ${article.image_status || 'pending'}`,
        `image_file: ${hero ? `images/${hero.url.split('/').pop()}` : ''}`,
        // Whose photograph this is and where it came from. In the article
        // itself as well as the manifest, so a corpus rebuilt from storage
        // alone still knows its own provenance.
        `image_credit: ${fmValue(hero?.credit || article.image_credit || '')}`,
        `image_source_url: ${hero?.source_url || ''}`,
        `image_stage: ${hero?.stage || ''}`,
        `summary: ${fmValue(article.summary || '')}`,
        `marketing_summary: ${fmValue(article.marketing_summary || '')}`,
        `status: ${article.status || 'draft'}`,
        '---',
        '',
    ];

    const parts = [
        ...fm,
        `**Article Title:** ${title}`, '',
        `**Writer:** ${article.writer || DEFAULT_WRITER}`, '',
        `**Article Slug:** ${slug}`, '',
        `**Source News URL:** ${article.source_url || ''}`, '',
        `**Published:** ${article.date_published || pstDateString(date)}`, '',
        '---', '',
    ];

    if (hero) parts.push(`![${title}](${hero.url})`, '');

    parts.push('## Introduction', '', (article.introduction || '').trim(), '');

    if (rest[0]) parts.push(`![${title}](${rest[0].url})`, '');

    parts.push('## Article Body', '', (article.body || '').trim(), '');

    if (rest[1]) parts.push(`![${title}](${rest[1].url})`, '');

    if (article.faith_relevance_analysis && article.faith_relevance_analysis.trim()) {
        parts.push('## Faith-Based Relevance Analysis', '', article.faith_relevance_analysis.trim(), '');
    }

    if (article.marketing_summary && article.marketing_summary.trim()) {
        parts.push('## Social Summary', '', article.marketing_summary.trim(), '');
    }

    parts.push(
        '---', '',
        `**Source:** [${article.source_name || 'Original article'}](${article.source_url || ''})`,
        '',
        `_Reported from published sources and written with AI assistance for ${DEFAULT_WRITER}._`,
        '',
    );

    return { markdown: parts.join('\n'), prefix: articlePrefix };
}

// ── Uploads ──────────────────────────────────────────────────────────────────

/**
 * Upload one article image. Skips the PUT when a plausible object is already
 * present, which is what makes a re-run after a crash nearly free.
 */
async function publishNewsImage(article, { imageId, buffer, n, date = new Date(), force = false }) {
    const key = buildNewsImageKey(article, imageId, date);

    if (!force) {
        const existing = await headObject(key);
        if (existing && existing.size > MIN_IMAGE_BYTES) {
            return { key, url: cdnUrl(key), bytes: existing.size, skipped: true };
        }
    }

    const res = await putObject({
        key,
        body: buffer,
        contentType: IMAGE_CONTENT_TYPE,
        cacheControl: CACHE_IMAGE,
        metadata: { article_slug: article.slug, image_n: String(n ?? '') },
    });
    return { ...res, skipped: false };
}

/**
 * Render and upload an article's Markdown. Skips the PUT when the body is
 * byte-identical to what is already there (compared via the sha256 metadata
 * putObject always writes).
 */
async function publishNewsArticle(article, { images = [], date = new Date(), force = false } = {}) {
    if (!isConfigured()) throw new Error('R2 credentials not configured');

    const key = buildNewsArticleKey(article, date);
    const { markdown } = buildNewsMarkdown(article, { images, date });
    const body = Buffer.from(markdown, 'utf8');
    const checksum = require('crypto').createHash('sha256').update(body).digest('hex');

    if (!force) {
        const existing = await headObject(key);
        if (existing && existing.metadata && existing.metadata.sha256 === checksum) {
            return { key, url: cdnUrl(key), bytes: existing.size, checksum, skipped: true };
        }
    }

    const res = await putObject({
        key,
        body,
        contentType: MARKDOWN_CONTENT_TYPE,
        cacheControl: CACHE_ARTICLE,
        metadata: { article_slug: article.slug, topic: article.topic || '' },
    });
    return { ...res, skipped: false };
}

// ── Day manifest ─────────────────────────────────────────────────────────────

/**
 * Manifest entry for one article. Carries both `image_file` (singular hero, so
 * anything written against the one-image model still works) and the additive
 * `images[]` array. Paths are relative to the day prefix.
 */
function buildIndexEntry(article, { images = [], date = new Date() } = {}) {
    const ordered = [...images].filter(i => i && i.url).sort((a, b) => a.n - b.n);
    const hero = ordered.find(i => i.n === 1) || ordered[0] || null;
    const slug = requireSlug(article);
    const rel = (url) => `${slug}/images/${url.split('/').pop()}`;

    let imageStatus = 'pending';
    if (ordered.length >= EXPECTED_IMAGES) imageStatus = 'generated';
    else if (ordered.length > 0) imageStatus = 'partial';

    return {
        id: buildNewsArticleId(article, date),
        slug,
        title: article.title || '',
        writer: article.writer || DEFAULT_WRITER,
        topic: article.topic || '',
        category: article.category || '',
        summary: article.summary || '',
        marketing_summary: article.marketing_summary || '',
        source_name: article.source_name || '',
        source_url: article.source_url || '',
        content_hash: article.content_hash || '',
        fact_confidence: article.fact_confidence || 'headline_only',
        date_published: article.date_published || pstDateString(date),
        date_updated: article.date_updated || new Date().toISOString(),
        // An article with no confirmed image stays a draft: the site's hard rule
        // is that imageless stories never occupy a slot.
        status: hero ? (article.status || 'published') : 'draft',
        file: `${slug}/article.md`,
        image_set_id: article.image_set_id || '',
        image_status: imageStatus,
        image_file: hero ? rel(hero.url) : '',
        // Provenance for the hero, at the top level so a consumer does not have
        // to walk `images[]` to answer "whose photograph is this?".
        //
        // Stored, not rendered. The front end reads image_file, images[].n and
        // status and nothing else, so adding these changes no pixel — but a
        // republished press photograph needs an auditable trail back to the
        // outlet it came from, and a takedown needs to be answerable without
        // re-scraping. Rendering a visible credit line is a UI decision.
        image_credit: hero?.credit || article.image_credit || '',
        image_source_url: hero?.source_url || '',
        image_stage: hero?.stage || '',
        image_phash: hero?.phash || '',
        images: ordered.map(i => ({
            n: i.n,
            role: i.role || '',
            // Accept either extension: legacy days still hold .png objects.
            id: i.url.split('/').pop().replace(/\.(webp|png)$/, ''),
            file: rel(i.url),
            safety: i.safety || 'unknown',
            ...(i.source_url ? { image_source_url: i.source_url } : {}),
            ...(i.stage ? { image_stage: i.stage } : {}),
            ...(i.credit ? { image_credit: i.credit } : {}),
            ...(i.phash ? { image_phash: i.phash } : {}),
        })),
    };
}

async function readNewsDayIndex(date = new Date()) {
    return getObjectJson(buildNewsDayIndexKey(date));
}

/**
 * Every key belonging to one article on one day: the English folder, and the
 * translated copy of it in each language a reader has asked for.
 *
 * Translations are stored one segment earlier than the article they translate —
 * `news/Y/M/D/hi-IN/<slug>/article.md` beside `news/Y/M/D/<slug>/article.md`
 * (see lib/r2-translations.js) — so a delete scoped to `<slug>/` leaves every
 * one of them behind. Nothing links to an orphan, so it is not a correctness
 * bug; it is a storage bill that grows with the number of languages and never
 * stops.
 *
 * The optional language group is why this cannot sweep a neighbour by accident,
 * and it holds because an article slug can never look like a language code: a
 * slug out of newsSlugify is always lowercase, and every code carries an
 * uppercase region.
 */
function newsArticleKeyPattern(slug, date = new Date()) {
    const prefix = newsDayPrefix(date).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const safeSlug = String(slug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${prefix}(?:[a-z]{2,3}-[A-Z]{2}/)?${safeSlug}/`);
}

/**
 * Remove one article's folder — markdown, images, translations, everything.
 *
 * Scoped to a single slug on a single day on purpose. Deletion here is not
 * recoverable, so the caller names exactly what goes.
 *
 * One LIST of the whole day rather than one per slug: with translations to
 * collect this would otherwise be a LIST per language, and a day-wide listing is
 * fewer round trips than even the original per-slug call when several articles
 * are being removed at once.
 */
async function deleteNewsArticle(slug, date = new Date()) {
    const keys = await listNewsArticleKeys(slug, date);
    if (!keys.length) return { slug, keys: [], deleted: [], errors: [] };
    const { deleted, errors } = await deleteObjects(keys);
    return { slug, keys, deleted, errors };
}

/** Keys for one article, English and translated, from a day-wide listing. */
async function listNewsArticleKeys(slug, date = new Date(), dayKeys = null) {
    const pattern = newsArticleKeyPattern(slug, date);
    const present = dayKeys || (await listPrefix(newsDayPrefix(date)));
    return [...present.keys()].filter(key => pattern.test(key));
}

function emptyDayIndex(date) {
    return {
        schema: DAY_SCHEMA,
        date: pstDateString(date),
        timezone: 'America/Los_Angeles',
        generated_at: new Date().toISOString(),
        count: 0,
        articles: [],
    };
}

async function writeDayIndex(manifest, date) {
    manifest.articles.sort((a, b) => (b.date_updated || '').localeCompare(a.date_updated || ''));
    manifest.count = manifest.articles.length;
    manifest.generated_at = new Date().toISOString();
    return putObject({
        key: buildNewsDayIndexKey(date),
        body: JSON.stringify(manifest, null, 2),
        contentType: JSON_CONTENT_TYPE,
        cacheControl: CACHE_INDEX,
    });
}

/**
 * Read-modify-write the day manifest, replacing entries by slug.
 *
 * Replace, never append — an article re-published in a later wave (once its
 * second and third images land) must update its entry, not add a duplicate.
 * Call this once per wave rather than once per article: it collapses ~90 round
 * trips into 3 and shrinks the window in which a concurrent run could clobber.
 */
async function upsertNewsDayIndex(entries, { date = new Date() } = {}) {
    const list = Array.isArray(entries) ? entries : [entries];
    if (!list.length) return null;

    const manifest = (await readNewsDayIndex(date)) || emptyDayIndex(date);
    if (!Array.isArray(manifest.articles)) manifest.articles = [];

    const incoming = new Map(list.map(e => [e.slug, e]));
    manifest.articles = manifest.articles.filter(a => !incoming.has(a.slug)).concat(list);

    return writeDayIndex(manifest, date);
}

/**
 * Rebuild the day manifest from what is actually in R2, discarding whatever the
 * previous index claimed. Run at end of a job: it repairs a manifest damaged by
 * a crash or a concurrent writer, and is what makes the batched upserts above
 * safe to treat as an optimisation rather than a correctness requirement.
 */
async function rewriteNewsDayIndex(entries, { date = new Date() } = {}) {
    const prefix = newsDayPrefix(date);
    const present = await listPrefix(prefix);

    const kept = [];
    for (const entry of entries) {
        const mdKey = `${prefix}${entry.file}`;
        if (!present.has(mdKey)) {
            console.warn(`[r2-news] dropping ${entry.slug} from index — ${mdKey} is not in R2`);
            continue;
        }
        // Re-derive image state from storage, never from the entry's claim. A
        // filename that does not exist silently removes an article from the
        // image queue forever.
        const images = (entry.images || []).filter(img => {
            const key = `${prefix}${img.file}`;
            return present.has(key) && present.get(key) > MIN_IMAGE_BYTES;
        });
        const hero = images.find(i => i.n === 1) || images[0] || null;
        kept.push({
            ...entry,
            images,
            image_file: hero ? hero.file : '',
            image_status: images.length >= EXPECTED_IMAGES ? 'generated'
                : images.length ? 'partial' : 'pending',
            status: hero ? (entry.status === 'draft' ? 'draft' : 'published') : 'draft',
        });
    }

    const manifest = emptyDayIndex(date);
    manifest.articles = kept;
    return writeDayIndex(manifest, date);
}

/**
 * Publish the slug -> date index to `news/slugs.json`.
 *
 * Article URLs are the bare slug at the site root
 * (`/seouls-chip-stocks-jump-18-percent`),
 * but the storage layout is date-partitioned, so a reader needs to know which
 * day a slug lives in. Without this index every lookup would have to scan day
 * manifests backwards until it found a hit.
 *
 * Slugs are claimed against the whole retention window, so an entry here is
 * unambiguous.
 */
async function upsertNewsSlugIndex(entries, { date = new Date(), keepDays = 60 } = {}) {
    const day = pstDateString(date);
    const current = (await getObjectJson(NEWS_SLUGS_KEY)) || { schema: SLUGS_SCHEMA, slugs: {} };
    const slugs = (current && typeof current.slugs === 'object') ? { ...current.slugs } : {};

    // Drop this day's previous claims before re-adding, so a pruned article
    // stops resolving instead of pointing at a folder that no longer exists.
    for (const [slug, d] of Object.entries(slugs)) {
        if (d === day) delete slugs[slug];
    }
    for (const entry of entries) {
        if (entry?.slug && entry.status === 'published') slugs[entry.slug] = day;
    }

    // Age out anything past the retention window.
    const cutoff = pstDateString(new Date(Date.now() - keepDays * 86400000));
    for (const [slug, d] of Object.entries(slugs)) {
        if (d < cutoff) delete slugs[slug];
    }

    return putObject({
        key: NEWS_SLUGS_KEY,
        body: JSON.stringify({
            schema: SLUGS_SCHEMA,
            updated: new Date().toISOString(),
            count: Object.keys(slugs).length,
            slugs,
        }, null, 2),
        contentType: JSON_CONTENT_TYPE,
        cacheControl: CACHE_INDEX,
    });
}

/**
 * Publish the outcome of a run to `news/status.json`.
 *
 * Written to R2 rather than only to a local log so the pipeline is monitorable
 * from anywhere — the VPSes, a dashboard, a phone — without shell access to the
 * GPU host. Keeps a short history so an intermittent failure is visible as a
 * pattern rather than a single bad night.
 */
async function publishRunStatus(summary, { keep = 14 } = {}) {
    const current = (await getObjectJson(NEWS_STATUS_KEY)) || { schema: STATUS_SCHEMA, runs: [] };
    const runs = [summary, ...(Array.isArray(current.runs) ? current.runs : [])].slice(0, keep);

    return putObject({
        key: NEWS_STATUS_KEY,
        body: JSON.stringify({
            schema: STATUS_SCHEMA,
            updated: new Date().toISOString(),
            last_status: summary.status,
            last_run_at: summary.finished_at,
            runs,
        }, null, 2),
        contentType: JSON_CONTENT_TYPE,
        cacheControl: 'public, max-age=30',
    });
}

/** Rolling pointer so the site can find recent days without guessing. */
async function upsertNewsLatest({ date = new Date(), count = 0, keep = 30 } = {}) {
    const day = pstDateString(date);
    const current = (await getObjectJson(NEWS_LATEST_KEY)) || {
        schema: LATEST_SCHEMA, updated: null, days: [],
    };
    const days = (Array.isArray(current.days) ? current.days : []).filter(d => d.date !== day);
    days.unshift({ date: day, prefix: newsDayPrefix(date), count });
    days.sort((a, b) => b.date.localeCompare(a.date));

    return putObject({
        key: NEWS_LATEST_KEY,
        body: JSON.stringify({
            schema: LATEST_SCHEMA,
            updated: new Date().toISOString(),
            days: days.slice(0, keep),
        }, null, 2),
        contentType: JSON_CONTENT_TYPE,
        cacheControl: CACHE_INDEX,
    });
}

module.exports = {
    NEWS_PREFIX,
    // Exported so r2-translations.js quotes frontmatter by the same rule rather
    // than keeping a second copy of it. Two copies of a quoting rule is how the
    // writer and the reader of a file end up disagreeing about it.
    fmValue,
    NEWS_LATEST_KEY,
    NEWS_STATUS_KEY,
    NEWS_SLUGS_KEY,
    IMAGE_EXT,
    IMAGE_CONTENT_TYPE,
    EXPECTED_IMAGES,
    MIN_IMAGE_BYTES,
    DEFAULT_WRITER,
    newsDayPrefix,
    newsArticlePrefix,
    newsSlugify,
    claimNewsSlug,
    readSlugClaims,
    newsSlug,
    buildNewsArticleKey,
    buildNewsImageKey,
    buildNewsDayIndexKey,
    buildNewsArticleId,
    buildNewsMarkdown,
    buildIndexEntry,
    publishNewsImage,
    publishNewsArticle,
    readNewsDayIndex,
    newsArticleKeyPattern,
    listNewsArticleKeys,
    deleteNewsArticle,
    upsertNewsDayIndex,
    rewriteNewsDayIndex,
    upsertNewsLatest,
    upsertNewsSlugIndex,
    publishRunStatus,
};

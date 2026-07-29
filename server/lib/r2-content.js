'use strict';
/**
 * lib/r2-content.js — Publish generated current-events articles to Cloudflare R2.
 *
 * Key convention (date-partitioned, mirrors the existing current-events image
 * convention /images/JubileeVerse.com/current_events/YYYY/MM/DD/{id}.jpg):
 *
 *   articles/current-events/{YYYY}/{MM}/{DD}/{id}-{slug}.md
 *
 * Public URL:
 *   https://cdn.jubileeverse.com/articles/current-events/2026/07/29/1234-headline-slug.md
 *
 * The date is the PST calendar date, matching getPstDateString() in server.js.
 * That matters: the portal's day boundary is America/Los_Angeles, so
 * partitioning on server-local time would drop articles ingested late in the
 * evening into a different folder than the portal day they belong to.
 *
 * PHASE A (current): dual-write. Postgres remains the store of record and the
 * homepage still reads from it, so an R2 failure logs loudly but does NOT fail
 * ingestion — losing the mirror is better than losing the article. When the
 * feed is rebuilt to read from R2 and the INSERT is removed, this must become
 * fail-loud: at that point a failed upload means the article is gone.
 *
 * Environment (server/.env):
 *   R2_ACCOUNT_ID          Cloudflare account id (builds the S3 endpoint)
 *   R2_BUCKET              bucket name (default jubileeverse-cdn)
 *   R2_ACCESS_KEY_ID       R2 token access key id (32 hex chars)
 *   R2_SECRET_ACCESS_KEY   R2 token secret (64 hex chars)
 *   CDN_BASE_URL           public origin (default https://cdn.jubileeverse.com)
 *
 * The R2_AVATARS_* names are accepted as fallbacks — that is the token
 * currently issued for this bucket.
 */

const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

// ── Config ───────────────────────────────────────────────────────────────────

function r2Config() {
    const accountId = process.env.R2_ACCOUNT_ID || process.env.R2_AVATARS_ACCOUNT_ID || '';
    return {
        endpoint: process.env.R2_ENDPOINT
            || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ''),
        bucket:    process.env.R2_BUCKET            || process.env.R2_AVATARS_BUCKET            || 'jubileeverse-cdn',
        accessKey: process.env.R2_ACCESS_KEY_ID     || process.env.R2_AVATARS_ACCESS_KEY_ID     || '',
        secretKey: process.env.R2_SECRET_ACCESS_KEY || process.env.R2_AVATARS_SECRET_ACCESS_KEY || '',
        cdnBase:  (process.env.CDN_BASE_URL || 'https://cdn.jubileeverse.com').replace(/\/+$/, ''),
    };
}

/** True when enough config is present to attempt an upload. */
function isConfigured() {
    const c = r2Config();
    return Boolean(c.endpoint && c.bucket && c.accessKey && c.secretKey);
}

let _client = null;
function client(cfg) {
    if (!_client) {
        _client = new S3Client({
            region: 'auto',                  // R2 ignores region; 'auto' is documented
            endpoint: cfg.endpoint,
            forcePathStyle: true,
            credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
        });
    }
    return _client;
}

// ── Key building ─────────────────────────────────────────────────────────────

/** Y/M/D parts in PST, matching the portal's day boundary. */
function pstDateParts(date = new Date()) {
    // en-CA yields YYYY-MM-DD, already zero-padded.
    const [yyyy, mm, dd] = date
        .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
        .split('-');
    return { yyyy, mm, dd };
}

/** URL-safe slug from a headline, capped so keys stay a sane length. */
function slugify(text, maxLen = 70) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLen)
        .replace(/-+$/, '') || 'article';
}

/**
 * Date-partitioned R2 key for a current-events article.
 * @param {{id: number|string, headline?: string}} article
 * @param {Date} [date] defaults to now (PST)
 */
function buildArticleKey(article, date = new Date()) {
    const { yyyy, mm, dd } = pstDateParts(date);
    return `articles/current-events/${yyyy}/${mm}/${dd}/${article.id}-${slugify(article.headline)}.md`;
}

// ── Markdown rendering ───────────────────────────────────────────────────────

/**
 * Render a current_events row as Markdown in the house format used by the
 * articles already published under articles/ — bold field labels in the header,
 * then Introduction / Article Body / Faith Commentary sections.
 */
function buildArticleMarkdown(article) {
    const image = article.cached_image_path || article.image_url || '(none)';
    const published = article.pub_date
        ? new Date(article.pub_date).toISOString().slice(0, 10)
        : Object.values(pstDateParts()).join('-');

    const parts = [
        `**Article Title:** ${article.headline || ''}`, ``,
        `**Writer:** JubileeVerse`, ``,
        `**Topic:** ${article.topic || ''}`, ``,
        `**Published:** ${published}`, ``,
        `**Source:** ${article.source_name || ''}`, ``,
        `**Source URL:** ${article.source_url || ''}`, ``,
        `**image01:** ${image}`, ``,
        `---`, ``,
        `## Introduction`, ``, (article.excerpt || '').trim(), ``,
        `## Article Body`, ``, (article.full_article || '').trim(),
    ];

    if (article.faith_reflection && article.faith_reflection.trim()) {
        parts.push(``, `## Faith Commentary`, ``, article.faith_reflection.trim());
    }

    parts.push(
        ``, `---`, ``,
        `**Source:** [${article.source_name || 'Original article'}](${article.source_url || ''})`,
        ``,
    );
    return parts.join('\n');
}

// ── Publish ──────────────────────────────────────────────────────────────────

/**
 * Render and upload one current_events article to R2 under the date-partitioned
 * key. Object storage has no real directories — the slashes in the key produce
 * the YYYY/MM/DD folder view, so nothing needs to be created in advance.
 *
 * @returns {Promise<{key: string, url: string, bytes: number, checksum: string}>}
 * @throws when R2 is unconfigured or the upload fails (callers in phase A catch)
 */
async function publishCurrentEventArticle(article, { date = new Date() } = {}) {
    const cfg = r2Config();
    if (!isConfigured()) throw new Error('R2 credentials not configured');

    const key      = buildArticleKey(article, date);
    const body     = Buffer.from(buildArticleMarkdown(article), 'utf8');
    const checksum = crypto.createHash('sha256').update(body).digest('hex');

    await client(cfg).send(new PutObjectCommand({
        Bucket:       cfg.bucket,
        Key:          key,
        Body:         body,
        ContentType:  MARKDOWN_CONTENT_TYPE,
        CacheControl: 'public, max-age=300',
        Metadata: {
            sha256:     checksum,
            article_id: String(article.id || ''),
            topic:      String(article.topic || ''),
        },
    }));

    return { key, url: `${cfg.cdnBase}/${key}`, bytes: body.length, checksum };
}

module.exports = {
    buildArticleKey,
    buildArticleMarkdown,
    publishCurrentEventArticle,
    isConfigured,
    slugify,
    pstDateParts,
};

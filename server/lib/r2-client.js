'use strict';
/**
 * lib/r2-client.js — Shared Cloudflare R2 transport.
 *
 * Extracted from r2-content.js so the news pipeline can reuse the config,
 * client, and date/slug helpers without widening that module's contract.
 * r2-content.js publishes current-events articles and is live; it keeps its own
 * copy for now and can be refitted onto this in a follow-up.
 *
 * Beyond the PutObject that r2-content.js needed, this adds head/get/list —
 * verified available on the issued token, and load-bearing for the news
 * pipeline's skip-if-present and day-manifest upsert.
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
const {
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

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

/** True when enough config is present to attempt a request. */
function isConfigured() {
    const c = r2Config();
    return Boolean(c.endpoint && c.bucket && c.accessKey && c.secretKey);
}

let _client = null;
function s3() {
    if (!_client) {
        const cfg = r2Config();
        if (!isConfigured()) throw new Error('R2 credentials not configured');
        _client = new S3Client({
            region: 'auto',                  // R2 ignores region; 'auto' is documented
            endpoint: cfg.endpoint,
            forcePathStyle: true,
            credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
        });
    }
    return _client;
}

// ── Naming helpers ───────────────────────────────────────────────────────────

/** Y/M/D parts in PST, matching the portal's day boundary. */
function pstDateParts(date = new Date()) {
    // en-CA yields YYYY-MM-DD, already zero-padded.
    const [yyyy, mm, dd] = date
        .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
        .split('-');
    return { yyyy, mm, dd };
}

/** 'YYYY-MM-DD' in PST. */
function pstDateString(date = new Date()) {
    const { yyyy, mm, dd } = pstDateParts(date);
    return `${yyyy}-${mm}-${dd}`;
}

/** Parse 'YYYY-MM-DD' into a Date at PST noon, safe from DST edge rollover. */
function dateFromPstString(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
    if (!m) throw new Error(`Expected YYYY-MM-DD, got "${str}"`);
    // Noon UTC lands on the same calendar day in PST (UTC-7/-8) year-round.
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
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

/** Public CDN URL for an object key. */
function cdnUrl(key) {
    return `${r2Config().cdnBase}/${String(key).replace(/^\/+/, '')}`;
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Upload one object.
 * @returns {Promise<{key, url, bytes, checksum, etag}>}
 */
async function putObject({ key, body, contentType, cacheControl, metadata }) {
    const cfg = r2Config();
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const checksum = crypto.createHash('sha256').update(buf).digest('hex');

    const res = await s3().send(new PutObjectCommand({
        Bucket:       cfg.bucket,
        Key:          key,
        Body:         buf,
        ContentType:  contentType,
        CacheControl: cacheControl,
        // R2 metadata values must be ASCII; drop empties so headers stay clean.
        Metadata: Object.fromEntries(
            Object.entries({ sha256: checksum, ...(metadata || {}) })
                .filter(([, v]) => v !== undefined && v !== null && v !== '')
                .map(([k, v]) => [k, String(v).replace(/[^\x20-\x7E]/g, '')])
        ),
    }));

    return { key, url: cdnUrl(key), bytes: buf.length, checksum, etag: res.ETag };
}

/**
 * Object metadata, or null when the key does not exist.
 * A missing key is an expected outcome here (skip-if-present), not an error.
 */
async function headObject(key) {
    try {
        const r = await s3().send(new HeadObjectCommand({ Bucket: r2Config().bucket, Key: key }));
        return { size: r.ContentLength, etag: r.ETag, metadata: r.Metadata || {} };
    } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
    }
}

/** Object body as a string, or null when the key does not exist. */
async function getObjectText(key) {
    try {
        const r = await s3().send(new GetObjectCommand({ Bucket: r2Config().bucket, Key: key }));
        return await r.Body.transformToString();
    } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
    }
}

/**
 * Object body as raw bytes, or null when the key does not exist.
 * Use this for images — getObjectText would decode them as UTF-8 and corrupt
 * every byte above 0x7F.
 */
async function getObjectBuffer(key) {
    try {
        const r = await s3().send(new GetObjectCommand({ Bucket: r2Config().bucket, Key: key }));
        return Buffer.from(await r.Body.transformToByteArray());
    } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
    }
}

/** Object body parsed as JSON, or null when missing or unparseable. */
async function getObjectJson(key) {
    const text = await getObjectText(key);
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        console.warn(`[r2] ${key} is not valid JSON: ${e.message}`);
        return null;
    }
}

/**
 * Every key under a prefix, paginated to completion.
 * @returns {Promise<Map<string, number>>} key -> size in bytes
 */
async function listPrefix(prefix) {
    const bucket = r2Config().bucket;
    const out = new Map();
    let token;
    do {
        const r = await s3().send(new ListObjectsV2Command({
            Bucket: bucket, Prefix: prefix, ContinuationToken: token,
        }));
        for (const o of r.Contents || []) out.set(o.Key, o.Size);
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
}

/**
 * Delete objects by key, in batches of 1000 (the S3 API ceiling).
 *
 * Deliberately takes an explicit key list rather than a prefix: a prefix-delete
 * helper is one typo away from removing a day, or the whole news tree.
 *
 * @returns {Promise<{deleted: string[], errors: {key: string, message: string}[]}>}
 */
async function deleteObjects(keys) {
    const list = [...new Set(keys)].filter(Boolean);
    const deleted = [];
    const errors = [];
    if (!list.length) return { deleted, errors };

    const bucket = r2Config().bucket;
    for (let i = 0; i < list.length; i += 1000) {
        const chunk = list.slice(i, i + 1000);
        const res = await s3().send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: false },
        }));
        for (const d of res.Deleted || []) deleted.push(d.Key);
        for (const e of res.Errors || []) errors.push({ key: e.Key, message: e.Message });
    }
    return { deleted, errors };
}

function isNotFound(err) {
    return err
        && (err.name === 'NotFound'
            || err.name === 'NoSuchKey'
            || err.$metadata?.httpStatusCode === 404);
}

module.exports = {
    r2Config,
    isConfigured,
    s3,
    pstDateParts,
    pstDateString,
    dateFromPstString,
    slugify,
    cdnUrl,
    putObject,
    headObject,
    getObjectText,
    getObjectBuffer,
    getObjectJson,
    listPrefix,
    deleteObjects,
};

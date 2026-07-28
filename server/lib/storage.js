'use strict';
/**
 * lib/storage.js — PubOS Object Storage Integration (Phase 3)
 *
 * S3-compatible upload layer using @aws-sdk/client-s3 and
 * @aws-sdk/s3-request-presigner. Supports AWS S3 and MinIO (via
 * AWS_S3_ENDPOINT override for local development).
 *
 * S3 key convention:
 *   {NODE_ENV}/assets/{object_type}/{YYYY}/{MM}/{uuid}.{ext}
 *
 * Required environment variables:
 *   AWS_S3_BUCKET         — bucket name
 *   AWS_S3_REGION         — e.g. us-east-1
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *
 * Optional environment variables:
 *   AWS_S3_ENDPOINT       — override for MinIO (e.g. http://localhost:9000)
 *   CDN_BASE_URL          — CloudFront origin prefix; if set, replaces the
 *                           S3 public URL with CDN URL for serving assets
 */

const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

// ── S3 client singleton ───────────────────────────────────────────────────────

function getS3Client() {
    const config = {
        region: process.env.AWS_S3_REGION || 'us-east-1',
        credentials: {
            accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || '',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
    };
    if (process.env.AWS_S3_ENDPOINT) {
        config.endpoint       = process.env.AWS_S3_ENDPOINT;
        config.forcePathStyle = true; // MinIO requires path-style URLs
    }
    return new S3Client(config);
}

// Lazily initialized so the server can start without valid AWS credentials
// (credentials are only needed when an upload endpoint is actually hit).
let _s3Client = null;
function s3() {
    if (!_s3Client) _s3Client = getS3Client();
    return _s3Client;
}

// ── Key builder ───────────────────────────────────────────────────────────────

/**
 * Build a storage key from parts.
 *
 * @param {string} objectType — e.g. 'image', 'asset', 'audio'
 * @param {string} uuid       — UUID for the asset
 * @param {string} ext        — file extension without dot (e.g. 'jpg', 'mp3')
 * @returns {string}
 */
function buildKey(objectType, uuid, ext) {
    const env  = process.env.NODE_ENV || 'development';
    const now  = new Date();
    const yyyy = now.getFullYear();
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    return `${env}/assets/${objectType}/${yyyy}/${mm}/${uuid}.${ext}`;
}

// ── Public URL ────────────────────────────────────────────────────────────────

/**
 * Return the public URL for a stored key.
 * Uses CDN_BASE_URL when set; falls back to direct S3 URL.
 *
 * @param {string} key
 * @returns {string}
 */
function getPublicUrl(key) {
    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_S3_REGION || 'us-east-1';
    const cdn    = process.env.CDN_BASE_URL;
    if (cdn) return `${cdn.replace(/\/$/, '')}/${key}`;
    if (process.env.AWS_S3_ENDPOINT) {
        return `${process.env.AWS_S3_ENDPOINT.replace(/\/$/, '')}/${bucket}/${key}`;
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

// ── Presigned upload URL ──────────────────────────────────────────────────────

/**
 * Generate a presigned PUT URL for direct client-to-S3 upload.
 *
 * @param {{
 *   key:         string,
 *   contentType: string,
 *   expiresIn?:  number,  — seconds until URL expires (default 300)
 * }} opts
 * @returns {Promise<{ uploadUrl: string, publicUrl: string }>}
 */
async function getPresignedUploadUrl({ key, contentType, expiresIn = 300 }) {
    const bucket  = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET environment variable not set');

    const command = new PutObjectCommand({
        Bucket:      bucket,
        Key:         key,
        ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3(), command, { expiresIn });
    const publicUrl = getPublicUrl(key);
    return { uploadUrl, publicUrl };
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete an object from S3.
 *
 * @param {string} key
 * @returns {Promise<void>}
 */
async function deleteObject(key) {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error('AWS_S3_BUCKET environment variable not set');

    await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

module.exports = {
    buildKey,
    getPublicUrl,
    getPresignedUploadUrl,
    deleteObject,
};

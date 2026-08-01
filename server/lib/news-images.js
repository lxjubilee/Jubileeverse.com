'use strict';
/**
 * lib/news-images.js — Render, screen, and name the three images per article.
 *
 * Two rules shape this module:
 *
 * 1. Image ids are DERIVED, not random. A random id makes a re-run produce a
 *    different key for the same image, orphaning yesterday's object and
 *    defeating the skip-if-present check that makes crash recovery cheap.
 *
 * 2. An article never fails to publish because of an image. Missing prompts get
 *    a family-safe fallback; a dead GPU downgrades image_status and the next run
 *    retries. What we never do is invent a filename or upload a placeholder,
 *    because either makes an article look finished and removes it from the
 *    queue forever.
 */

const crypto = require('crypto');
const { generateImage, liveLanes } = require('./comfy-client');

/**
 * WebP quality for published article images.
 *
 * These are photographic AI renders at 1344x768, where 82 is visually
 * indistinguishable from the PNG source and lands around a tenth of the bytes.
 * Going higher buys nothing a reader can see; going lower starts to show on
 * skin tones and gradients.
 */
const WEBP_QUALITY = Number(process.env.NEWS_WEBP_QUALITY || 82);

/** Published image format. Kept in one place so key builders agree. */
const IMAGE_EXT = 'webp';
const IMAGE_CONTENT_TYPE = 'image/webp';

/**
 * Encode a rendered image as WebP.
 *
 * ComfyUI returns PNG, which is lossless and enormous — a 1344x768 render runs
 * 1 to 2 MB. At 60 articles x 3 images that is ~360 MB a day pushed through the
 * CDN for no visible benefit. WebP cuts it by roughly 90%.
 *
 * Conversion happens AFTER the safety scan: the classifier reads the staged
 * PNGs, so re-encoding first would hand it a format it has never been exercised
 * against, for no gain.
 */
async function toWebp(buffer, { quality = WEBP_QUALITY } = {}) {
    const sharp = require('sharp');
    return sharp(buffer)
        .webp({ quality, effort: 5 })
        .toBuffer();
}

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const IMAGES_PER_ARTICLE = 3;
const ROLES = ['hero', 'supporting', 'symbolic'];

/** Base62 encoding of a hex digest, left-padded to `length`. */
function base62FromHex(hex, length) {
    let n = BigInt(`0x${hex}`);
    const base = BigInt(62);
    let out = '';
    while (n > 0n && out.length < length) {
        out = BASE62[Number(n % base)] + out;
        n /= base;
    }
    return out.padStart(length, '0');
}

/**
 * Deterministic 12-char alphanumeric id for one image of one article.
 * Matches ^[0-9A-Za-z]{12}$ — the published filename contract.
 *
 * `salt` is for re-renders that must not reuse the published URL: image URLs
 * are served immutable, so an admin-triggered regeneration writing the same key
 * would leave the cached defect on the page. Omitting it — as the pipeline does
 * — yields exactly the id it always has, so no published filename moves.
 */
function mintImageId(articleId, n, salt = '') {
    const material = salt ? `${articleId}:${n}:${salt}` : `${articleId}:${n}`;
    return base62FromHex(crypto.createHash('sha256').update(material).digest('hex'), 12);
}

/** Deterministic id grouping an article's images. Metadata only, not a key. */
function mintImageSetId(articleId) {
    return base62FromHex(crypto.createHash('sha256').update(String(articleId)).digest('hex'), 12);
}

/** Stable per-image seed, so a regenerated image reproduces rather than drifts. */
function seedFor(articleId, n, salt = 0) {
    const hex = crypto.createHash('sha256').update(`${articleId}:${n}:${salt}`).digest('hex');
    return Number(BigInt(`0x${hex.slice(0, 8)}`) % 2147483647n) + 1;
}

/**
 * Family-safe fallback prompts, used only when the compose step returned fewer
 * than three. Deliberately generic: a plain, safe image beats no article.
 */
function deriveImagePrompts(article) {
    const subject = (article.title || 'a community news story').replace(/["\n]/g, ' ').slice(0, 120);
    const settings = [
        'A person reading a newspaper at a kitchen table in soft morning light, seen from a low three-quarter angle. Warm neutral tones, quiet and thoughtful mood.',
        'A wide establishing view of an ordinary small-town main street on an overcast weekday, low traffic, brick storefronts. Muted grey and slate palette, documentary framing.',
        'An empty wooden chapel interior at dusk with rows of simple pews and warm lamplight from the side windows. Amber and deep brown palette, still and hopeful, no people.',
    ];
    return ROLES.map((role, i) => ({
        role,
        prompt: `${settings[i]} The scene relates to a news story about ${subject}. `
            + 'Photorealistic, cinematic lighting, natural skin tones, 16:9.',
    }));
}

/**
 * Recover image prompts from a rendered article body, if they happen to be
 * there. Returns null rather than throwing: the pipeline already has the
 * prompts in hand, so this is a defensive fallback and must never be fatal.
 */
function extractPromptsFromMarkdown(md) {
    if (!md || typeof md !== 'string') return null;
    const found = [];
    const re = /\*\*image-?prompt\s*0?([123])\s*:?\*\*\s*([\s\S]*?)(?=\n\s*\n|\*\*image-?prompt|$)/gi;
    let m;
    while ((m = re.exec(md)) !== null) {
        const text = m[2].trim();
        if (text) found.push({ n: Number(m[1]), prompt: text });
    }
    if (found.length !== IMAGES_PER_ARTICLE) return null;
    found.sort((a, b) => a.n - b.n);
    return found.map((f, i) => ({ role: ROLES[i], prompt: f.prompt }));
}

/** Ensure exactly three well-formed prompts, filling gaps from the fallback. */
function normalizePrompts(prompts, article) {
    const fallback = deriveImagePrompts(article);
    const usable = (Array.isArray(prompts) ? prompts : [])
        .filter(p => p && typeof p.prompt === 'string' && p.prompt.trim().length >= 40);

    return ROLES.map((role, i) => {
        const byRole = usable.find(p => p.role === role);
        const byIndex = usable[i];
        const chosen = byRole || byIndex;
        return { role, prompt: chosen ? chosen.prompt.trim() : fallback[i].prompt };
    });
}

/**
 * Render an article's three images across the available lanes.
 *
 * Callers normally drive a flat, cross-article job list so that every article's
 * first image renders before any article's second, which is what lets an
 * article go live with a hero image while later images are still queued. This
 * function is the single-article path used for retries and one-off runs.
 *
 * @returns {Promise<Array<{n, role, prompt, buffer?, imageId, seed, error?}>>}
 */
async function generateArticleImageSet(prompts, {
    articleId,
    article = {},
    lanes = null,
    opts = {},
    onImage = null,
    logger = console,
} = {}) {
    const wanted = normalizePrompts(prompts, article);
    const available = lanes || await liveLanes();

    if (!available.length) {
        logger.warn('[images] no ComfyUI lane reachable — deferring this article to the next run');
        return wanted.map((p, i) => ({
            ...p, n: i + 1, imageId: mintImageId(articleId, i + 1),
            seed: seedFor(articleId, i + 1), error: 'no lane available',
        }));
    }

    const jobs = wanted.map((p, i) => ({ ...p, n: i + 1 }));
    const results = [];

    // One in-flight job per lane. Each ComfyUI instance owns a GPU and queues
    // internally; over-submitting causes VRAM thrash rather than parallelism.
    let cursor = 0;
    await Promise.all(available.map(async (lane) => {
        for (;;) {
            const job = jobs[cursor++];
            if (!job) return;
            const imageId = mintImageId(articleId, job.n);
            const seed = seedFor(articleId, job.n);
            try {
                const r = await generateImage(job.prompt, { lane, seed, opts });
                const record = { ...job, imageId, seed, buffer: r.buffer, lane, ms: r.ms };
                results.push(record);
                if (onImage) await onImage(record);
            } catch (e) {
                logger.warn(`[images] ${articleId} #${job.n} failed on ${lane}: ${e.message}`);
                results.push({ ...job, imageId, seed, error: e.message });
            }
        }
    }));

    return results.sort((a, b) => a.n - b.n);
}

/**
 * Re-render one image with a different seed, appending any flagged classes to
 * the negative prompt. Used once after a safety rejection; a second failure
 * abandons the slot rather than burning more GPU time.
 */
async function regenerateSafely(job, { articleId, lane, flags = [], opts = {}, logger = console } = {}) {
    const { NEGATIVE } = require('./comfy-client');
    const negative = flags.length ? `${NEGATIVE}, ${flags.join(', ')}` : NEGATIVE;
    const seed = seedFor(articleId, job.n, 1);
    try {
        const r = await generateImage(job.prompt, { lane, seed, opts: { ...opts, negative } });
        return { ...job, seed, buffer: r.buffer, lane, ms: r.ms };
    } catch (e) {
        logger.warn(`[images] ${articleId} #${job.n} regeneration failed: ${e.message}`);
        return { ...job, seed, error: e.message };
    }
}

module.exports = {
    IMAGES_PER_ARTICLE,
    IMAGE_EXT,
    IMAGE_CONTENT_TYPE,
    WEBP_QUALITY,
    toWebp,
    ROLES,
    mintImageId,
    mintImageSetId,
    seedFor,
    deriveImagePrompts,
    extractPromptsFromMarkdown,
    normalizePrompts,
    generateArticleImageSet,
    regenerateSafely,
};

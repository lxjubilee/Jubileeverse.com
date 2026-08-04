'use strict';
/**
 * lib/news-image-source.js — Get the picture the outlet ran with the story.
 *
 * This replaces three FLUX renders per article. The photograph a newsroom chose
 * for its own front page is, for a news article, better than anything we can
 * generate: it shows the actual place, the actual people, and it cannot invent
 * a sixth finger or a building that was never there.
 *
 * The work splits into four steps, kept separate so all but one are pure and
 * can be tested without a network:
 *
 *   resolve    pick a URL out of what we already fetched   (pure)
 *   fetch      download it, capped and bounded             (network)
 *   validate   is this a usable news photograph?           (pure)
 *   normalize  1600x900 WebP                               (pure)
 *
 * The validate step carries most of the weight. An `og:image` is whatever the
 * publisher put there, which routinely means a house logo, a 1x1 tracking
 * pixel, a share-card template, or an HTML error page served with a 200. None
 * of those are photographs, and all of them would publish silently.
 */

const https = require('https');
const http = require('http');

// ── Contract ─────────────────────────────────────────────────────────────────

/**
 * Published dimensions. Every sourced image is resized to exactly this.
 *
 * Not cosmetic — it is what keeps the front end untouched. The article hero in
 * ArticleReader.module.css is `width:100%; height:auto`, so the box takes the
 * image's own aspect ratio. Rendered images were always 1344x768, so that rule
 * has never been exercised against anything else; a square og:image would
 * produce a hero filling the entire first screen before a word of text. 16:9
 * keeps every existing CSS rule behaving exactly as it does today.
 */
const TARGET_WIDTH  = 1600;
const TARGET_HEIGHT = 900;

/**
 * Hard ceiling on a download.
 *
 * Generous on purpose. A large original is a GOOD sign for a news photograph —
 * it is the uncropped frame off the wire — and everything is downscaled to
 * 1600x900 anyway. A 12MB cap turned out to reject real pictures during the
 * migration; this only exists to stop a pathological response eating memory.
 */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/** Below this there is no photograph worth upscaling to a full-bleed hero. */
const MIN_SOURCE_WIDTH  = 640;
const MIN_SOURCE_HEIGHT = 360;

/** Outside this, it is a banner strip or a phone-shaped crop, not a news photo. */
const MIN_ASPECT = 0.5;
const MAX_ASPECT = 4.0;

const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 4;

/**
 * Formats we will republish.
 *
 * `image/svg+xml` is excluded deliberately rather than by omission: sharp
 * renders SVG through librsvg, which resolves external entities and remote
 * references in the document. Handing it an arbitrary file from an arbitrary
 * publisher is a server-side request forgery primitive, and a vector logo is
 * never the photograph we came for anyway.
 */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/**
 * Filenames that name themselves as furniture.
 *
 * Cheap and surprisingly effective: an outlet's fallback card is nearly always
 * called something like `facebook-default-wide.jpg`.
 *
 * Matched against the FILENAME, never the whole path. Image CDNs put their
 * transform instructions in path segments, and several of those words collide
 * with these — Brightspot serves every NPR photograph from
 * `/dims3/default/strip/false/crop/4382x2465/...`, where `default` is the
 * transform preset. Matching the path threw away real 4382x2465 press
 * photographs while the actual house card, `facebook-default-wide.jpg`, is
 * caught either way.
 */
const HOUSE_IMAGE_RE = /(^|[/_-])(logo|logos|default|defaults|placeholder|fallback|share|sharing|og-?image|social[-_]?card|social[-_]?share|no-?image|noimage|generic|avatar|icon|icons|sprite|banner|masthead|watermark)([/_.-]|$)/i;

// ── 1. Resolve ───────────────────────────────────────────────────────────────

/**
 * Every image URL known for a story, best first.
 *
 * A LIST rather than one pick, because the first choice is often the wrong
 * size. Plenty of feeds put a 240x135 thumbnail in `media:thumbnail` where
 * others put the full frame, and the first live run lost five of thirty-two
 * stories to exactly that — a thumbnail was resolved, failed the dimension
 * gate, and the article was drafted even though the source page was serving a
 * perfectly good 1200x630 og:image the whole time.
 *
 * So the caller walks this list and stops at the first URL that survives
 * validation. Order still puts the feed first: the outlet attached that image
 * to this specific item, which makes it the least likely to be a house card.
 *
 * Every entry is free — the RSS item was parsed during harvest and the source
 * page was fetched to build the fact sheet. Nothing here touches the network.
 *
 * @param {object} candidate  harvested RSS candidate (may carry `imageUrl`)
 * @param {object} sheet      fact sheet (may carry `image` / `image_stage`)
 * @returns {Array<{url: string, stage: string}>}
 */
function resolveImageCandidates(candidate = {}, sheet = {}) {
    const pageUrl = sheet.source_url || candidate.link || '';
    const out = [];
    const seen = new Set();

    const add = (raw, stage) => {
        const url = normalizeCandidateUrl(raw, pageUrl);
        if (!url || seen.has(url)) return;
        seen.add(url);
        out.push({ url, stage });
    };

    add(candidate.imageUrl, 'rss');
    add(sheet.image, sheet.image_stage || 'og');
    return out;
}

/**
 * The single best image URL for a story — the head of the candidate list.
 *
 * Kept for the dry run and for callers that only need to know whether a story
 * is illustratable at all. Anything actually publishing should walk
 * `resolveImageCandidates`, so a bad first choice does not cost the article.
 *
 * @returns {{url: string|null, stage: string, reason?: string}}
 */
function resolveImageUrl(candidate = {}, sheet = {}) {
    const [first] = resolveImageCandidates(candidate, sheet);
    return first
        ? { url: first.url, stage: first.stage }
        : { url: null, stage: 'none', reason: 'no image url on the feed item or the source page' };
}

/** Absolute http(s) URL, or ''. Rejects data: and javascript: outright. */
function normalizeCandidateUrl(src, pageUrl) {
    const raw = String(src ?? '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw, pageUrl || undefined);
        if (!/^https?:$/.test(url.protocol)) return '';
        return url.toString();
    } catch {
        return '';
    }
}

/** Does this URL name itself as a logo or a share-card template? */
function looksLikeHouseImage(url) {
    let pathname;
    try {
        pathname = new URL(url).pathname;
    } catch {
        pathname = String(url || '').split('?')[0];
    }
    // The last non-empty segment. A trailing slash — common on CDN transform
    // URLs — would otherwise leave nothing to test.
    const filename = pathname.split('/').filter(Boolean).pop() || '';
    return HOUSE_IMAGE_RE.test(filename);
}

// ── 2. Fetch ─────────────────────────────────────────────────────────────────

/**
 * Download an image, bounded in every direction.
 *
 * Deliberately not the copy in server.js: that one has no byte cap and counts
 * no redirects, so a redirect loop or a 40MB TIFF takes the process with it.
 * That is survivable in a request handler; in an unattended scheduled job it is
 * a run that never finishes and a task that never fires again.
 *
 * @returns {Promise<{buffer: Buffer, contentType: string, url: string}>}
 */
function fetchImage(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_IMAGE_BYTES, _redirects = 0 } = {}) {
    return new Promise((resolve, reject) => {
        if (!/^https?:\/\//i.test(url || '')) return reject(new Error('not an http url'));
        if (_redirects > MAX_REDIRECTS) return reject(new Error('too many redirects'));

        const protocol = url.startsWith('https') ? https : http;
        let settled = false;
        const fail = (e) => { if (!settled) { settled = true; reject(e); } };
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };

        const req = protocol.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: timeoutMs,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                let next;
                try { next = new URL(res.headers.location, url).toString(); } catch { return fail(new Error('bad redirect target')); }
                return fetchImage(next, { timeoutMs, maxBytes, _redirects: _redirects + 1 }).then(done, fail);
            }
            if (res.statusCode !== 200) { res.resume(); return fail(new Error(`HTTP ${res.statusCode}`)); }

            const contentType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

            // Refuse before reading a byte when the declared length is absurd.
            const declared = Number(res.headers['content-length'] || 0);
            if (declared && declared > maxBytes) {
                res.destroy();
                return fail(new Error(`too large (${Math.round(declared / 1024)}KB declared)`));
            }

            const chunks = [];
            let total = 0;
            res.on('data', (chunk) => {
                total += chunk.length;
                if (total > maxBytes) {
                    res.destroy();
                    req.destroy();
                    return fail(new Error('too large'));
                }
                chunks.push(chunk);
            });
            res.on('end', () => done({ buffer: Buffer.concat(chunks), contentType, url }));
            res.on('error', fail);
        });

        req.on('error', fail);
        req.on('timeout', () => { req.destroy(); fail(new Error('timeout')); });
    });
}

// ── 3. Validate ──────────────────────────────────────────────────────────────

/**
 * Magic-byte sniff.
 *
 * Checked independently of Content-Type because the header is frequently a
 * lie — the common case being a paywall or consent interstitial served as
 * text/html with a 200 at an image URL. Sniffing turns that into a clear
 * rejection instead of an opaque sharp exception.
 */
function sniffFormat(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
    if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buffer.slice(0, 3).toString('latin1') === 'GIF') return 'gif';
    if (buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
    // ISO-BMFF: AVIF and HEIF both carry an `ftyp` box at offset 4.
    if (buffer.slice(4, 8).toString('latin1') === 'ftyp') return 'avif';
    return '';
}

/**
 * Decide whether a downloaded object is a publishable news photograph.
 *
 * Ordered cheapest-first, and every rejection carries a reason string so the
 * run log says why a story lost its picture rather than just that it did.
 *
 * @returns {Promise<{ok: boolean, reason?: string, meta?: object}>}
 */
async function validateSourcedImage(buffer, { contentType = '', url = '' } = {}) {
    const sharp = require('sharp');

    if (!Buffer.isBuffer(buffer) || !buffer.length) return { ok: false, reason: 'empty response' };

    if (contentType === 'image/svg+xml') return { ok: false, reason: 'svg is not republishable' };
    if (contentType && !ALLOWED_TYPES.has(contentType)) {
        return { ok: false, reason: `content-type ${contentType}` };
    }

    const sniffed = sniffFormat(buffer);
    if (!sniffed) return { ok: false, reason: 'not an image (magic bytes)' };

    let meta;
    try {
        meta = await sharp(buffer, { pages: 1 }).metadata();
    } catch (e) {
        return { ok: false, reason: `undecodable: ${e.message.slice(0, 60)}` };
    }

    const width = meta.width || 0;
    const height = meta.height || 0;
    if (!width || !height) return { ok: false, reason: 'no dimensions' };

    // A 1x1 beacon, a spacer, or a favicon. Also the floor below which
    // upscaling to a full-bleed hero looks like what it is.
    if (width < MIN_SOURCE_WIDTH || height < MIN_SOURCE_HEIGHT) {
        return { ok: false, reason: `too small (${width}x${height})`, meta };
    }

    const aspect = width / height;
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
        return { ok: false, reason: `aspect ${aspect.toFixed(2)} outside ${MIN_ASPECT}-${MAX_ASPECT}`, meta };
    }

    // Photographs are not transparent. A PNG with an alpha channel is a logo,
    // a badge, or a UI asset with overwhelming probability.
    if (meta.format === 'png' && meta.hasAlpha) {
        return { ok: false, reason: 'transparent png (logo)', meta };
    }

    if (looksLikeHouseImage(url)) {
        return { ok: false, reason: 'url names a house/share image', meta };
    }

    return {
        ok: true,
        meta: {
            format: meta.format,
            width,
            height,
            pages: meta.pages || 1,
            bytes: buffer.length,
        },
    };
}

/**
 * Shannon entropy of the image, as a flatness signal.
 *
 * Reported, never enforced. A house logo on a flat background scores far below
 * a photograph, but so does a legitimate photograph of snow, fog, or a night
 * sky, and no threshold has been measured against this corpus yet. Logging it
 * is what makes choosing one possible later; enforcing it now would silently
 * drop real pictures to catch a handful of logos the URL check already gets.
 */
async function imageEntropy(buffer) {
    try {
        const sharp = require('sharp');
        const { entropy } = await sharp(buffer, { pages: 1 }).stats();
        return typeof entropy === 'number' ? Number(entropy.toFixed(3)) : null;
    } catch {
        return null;
    }
}

/**
 * 64-bit difference hash, as hex.
 *
 * Catches the same picture arriving under two URLs — the wire photo every
 * outlet ran, or a publisher's fallback card that dodged the filename check.
 * Difference hashing rather than average hashing because it is far less
 * sensitive to the re-encoding and rescaling every CDN applies.
 */
async function imageHash(buffer) {
    try {
        const sharp = require('sharp');
        const raw = await sharp(buffer, { pages: 1 })
            .greyscale()
            .resize(9, 8, { fit: 'fill' })
            .raw()
            .toBuffer();

        let bits = '';
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                bits += raw[row * 9 + col] > raw[row * 9 + col + 1] ? '1' : '0';
            }
        }
        return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
    } catch {
        return null;
    }
}

/** Hamming distance between two hex hashes; Infinity if either is missing. */
function hashDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let count = 0;
    while (bits) { count += Number(bits & 1n); bits >>= 1n; }
    return count;
}

/** Hamming distance at or below which two images are the same picture. */
const DUPLICATE_HASH_DISTANCE = 6;

// ── 4. Normalize ─────────────────────────────────────────────────────────────

/**
 * Re-encode to exactly TARGET_WIDTH x TARGET_HEIGHT WebP.
 *
 * `withoutEnlargement` is intentionally left off. It sounds like the careful
 * choice, but it silently disables the resize for anything smaller than the
 * target, which would emit a non-16:9 image and reintroduce the exact layout
 * problem this function exists to prevent. Sources too small to upscale well
 * are rejected in validation instead, where the reason can be reported.
 *
 * `.rotate()` with no argument applies the EXIF orientation and then drops it.
 * Wire JPEGs carry orientation constantly and publish sideways without it; the
 * previous renders never did, so this had never been needed.
 *
 * Attention-based cropping because a news photograph's subject is very often
 * off-centre, and a centre crop cuts heads off.
 */
async function normalizeSourcedImage(buffer, { quality = 82 } = {}) {
    const sharp = require('sharp');
    return sharp(buffer, { pages: 1 })
        .rotate()
        .resize(TARGET_WIDTH, TARGET_HEIGHT, {
            fit: 'cover',
            position: sharp.strategy.attention,
        })
        .webp({ quality, effort: 5 })
        .toBuffer();
}

// ── Within-run duplicate tracking ────────────────────────────────────────────

/**
 * Rejects an image URL claimed by more than one article in the same run.
 *
 * The single strongest house-logo signal available, and it costs nothing: when
 * an outlet serves its fallback card, it serves the SAME card for every story
 * we could not resolve properly. One article getting it is plausible; three
 * articles sharing one picture is a template. The first claim is allowed
 * through — it may well be genuine — and every repeat is refused.
 *
 * Also tracks perceptual hashes, which catches the same case when the fallback
 * is served under cache-busted URLs.
 */
function createImageTracker({ denylist = [] } = {}) {
    const byUrl = new Map();
    const hashes = [];
    const denied = new Set(denylist);

    return {
        /**
         * Claim a URL before spending a download on it.
         * @returns {{ok: boolean, reason?: string}}
         */
        claim(url, hash = null) {
            if (denied.has(url)) return { ok: false, reason: 'on the known house-image denylist' };

            const seen = byUrl.get(url) || 0;
            byUrl.set(url, seen + 1);
            if (seen) return { ok: false, reason: `image url already used by ${seen} article(s) this run` };

            return hash ? this.claimHash(hash) : { ok: true };
        },

        /**
         * Claim the picture itself, once its bytes are in hand.
         *
         * Separate from `claim` because the two happen at different times: the
         * URL is checked before paying for a download, the hash only after. A
         * cache-busted house image passes the first and is caught here.
         *
         * @returns {{ok: boolean, reason?: string}}
         */
        claimHash(hash) {
            if (!hash) return { ok: true };
            const clash = hashes.find(h => hashDistance(h, hash) <= DUPLICATE_HASH_DISTANCE);
            if (clash) return { ok: false, reason: 'same picture as another article this run' };
            hashes.push(hash);
            return { ok: true };
        },

        /** URLs claimed by more than one article — house images, near certainly. */
        repeats() {
            return [...byUrl.entries()].filter(([, n]) => n > 1).map(([url]) => url);
        },
    };
}

module.exports = {
    TARGET_WIDTH,
    TARGET_HEIGHT,
    MAX_IMAGE_BYTES,
    MIN_SOURCE_WIDTH,
    MIN_SOURCE_HEIGHT,
    MIN_ASPECT,
    MAX_ASPECT,
    ALLOWED_TYPES,
    HOUSE_IMAGE_RE,
    DUPLICATE_HASH_DISTANCE,
    resolveImageCandidates,
    resolveImageUrl,
    normalizeCandidateUrl,
    looksLikeHouseImage,
    fetchImage,
    sniffFormat,
    validateSourcedImage,
    imageEntropy,
    imageHash,
    hashDistance,
    normalizeSourcedImage,
    createImageTracker,
};

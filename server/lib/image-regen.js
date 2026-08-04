'use strict';
/**
 * lib/image-regen.js — Admin-triggered regeneration of one published image.
 *
 * The manual escape hatch when a published image is wrong. Two article kinds
 * are published, and the remedy for each is now a different thing:
 *
 *   news       news/<YYYY>/<MM>/<DD>/<slug>/…   day manifest is index.json
 *              RE-FETCHES the outlet's own photograph. No GPU involved, and
 *              deliberately no way to put a generated image on a news article.
 *   category   articles/<category>/…            manifest is articles.json
 *              RENDERS a fresh hero, which is still right here: these are
 *              devotional pieces with no source photograph to go and get.
 *
 * Three rules shape the implementation:
 *
 *  1. **Prompts are rebuilt server-side** from the article's own title, summary,
 *     category and body. The caller names an article; it never supplies prompt
 *     text, so an authenticated admin cannot turn this into an open image
 *     generator pointed at someone else's GPU.
 *
 *  2. **A new key every time.** Image ids are otherwise deterministic, so
 *     re-rendering would write the same URL the CDN is already caching and the
 *     defect would stay on the page. Each regeneration mints a fresh id from a
 *     salt, which makes the new URL self-invalidating: nothing to purge, and no
 *     window where some readers see the old image and some the new.
 *
 *  3. **A different seed.** `seedFor` is deterministic so a re-run reproduces
 *     an image; here that is exactly wrong — the same seed and prompt would
 *     render the same six fingers again.
 *
 * **LAN-only.** Rendering needs ComfyUI on the GPU host, which is reachable
 * from the LAN box that runs the pipeline and not from the UAT or production
 * VPSes. Away from the LAN this returns a clear `no_gpu` error rather than
 * hanging; the daily pipeline remains the path that publishes images there.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const R2 = require('./r2-client');
const News = require('./r2-news');
const Images = require('./news-images');
const Safety = require('./image-safety');
const Comfy = require('./comfy-client');
const Judge = require('./image-judge');

/** Where a render is staged so the safety scanner (a folder tool) can read it. */
const STAGE_ROOT = path.join(os.tmpdir(), 'jv-image-regen');

/** The hero is image #1 of an article's set. */
const HERO_N = 1;

/** Cache headers for a published image, matching the pipeline's. */
const IMAGE_CACHE = 'public, max-age=31536000, immutable';

class RegenError extends Error {
    constructor(kind, message, status = 400) {
        super(message);
        this.kind = kind;
        this.status = status;
    }
}

// ── Prompt ───────────────────────────────────────────────────────────────────

/**
 * Directives aimed squarely at the defects this feature exists to fix.
 *
 * Stated positively as well as negatively: diffusion models respond to what a
 * scene *should* contain, and the negative prompt below carries the rest.
 */
const QUALITY_DIRECTIVE =
    'Photorealistic editorial news photograph, natural lighting, natural skin tones, '
    + 'anatomically correct: exactly five fingers per hand, one head per person, '
    + 'correctly proportioned faces and limbs, hands relaxed and clearly formed. '
    + 'Sharp focus, documentary framing, 16:9.';

/** Artifacts to steer away from, appended to the renderer's own negative list. */
const ARTIFACT_NEGATIVE = [
    'extra fingers', 'six fingers', 'missing fingers', 'fused fingers', 'malformed hands',
    'extra limbs', 'extra heads', 'two heads', 'duplicate face', 'distorted face',
    'deformed anatomy', 'disfigured', 'mutated hands', 'asymmetrical eyes',
    'text', 'watermark', 'signature',
].join(', ');

/** Trim a body to a prompt-sized gist without cutting mid-word. */
function gist(text, max = 400) {
    const flat = String(text || '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // image embeds
        .replace(/[#*_>`]/g, ' ')                  // markdown markers
        .replace(/\s+/g, ' ')
        .trim();
    if (flat.length <= max) return flat;
    return `${flat.slice(0, flat.lastIndexOf(' ', max) || max)}…`;
}

/**
 * Build the hero prompt from what the article actually says.
 *
 * Keeps the published image faithful to the story: the subject comes from the
 * headline, the framing from the summary and opening body, and the category
 * sets the register. No caller-supplied text reaches the renderer.
 */
function buildHeroPrompt({ title, summary, category, body }) {
    const subject = String(title || '').replace(/["\n]/g, ' ').trim();
    const context = gist(summary || body);
    const topic = String(category || '').replace(/[-_]/g, ' ').trim();

    return [
        `A photograph illustrating a news story headlined "${subject}".`,
        topic ? `Subject area: ${topic}.` : '',
        context ? `Story context: ${context}` : '',
        'Depict an ordinary, dignified real-world scene that represents this story honestly.',
        QUALITY_DIRECTIVE,
    ].filter(Boolean).join(' ');
}

// ── Render ───────────────────────────────────────────────────────────────────

/**
 * Render candidates, gate them, and return the winner as WebP bytes.
 *
 * This runs the pipeline's own path — `Judge.produceImage` — rather than a
 * single render of its own. That is the whole point of Step 6: an admin
 * pressing "regenerate" is asking for a *better* image, and before this the
 * button rendered one shot with no structural check and no judge, so a manual
 * regeneration could replace a defective hero with a worse one and the operator
 * had no way to tell. Now a manual regeneration meets exactly the same bar as
 * an unattended one: same candidate count, same structural gate, same rubric,
 * same escalating retry.
 *
 * Safety policy is the pipeline's, unchanged: an image the classifier flags is
 * never published, and an unreachable scanner follows the configured mode
 * rather than being treated as a pass here and a fail there.
 */
async function renderScreened(prompt, { articleId, salt, article = {}, logger = console }) {
    const lanes = await Comfy.liveLanes({ force: true });
    if (!lanes.length) {
        throw new RegenError(
            'no_gpu',
            'No image GPU is reachable from this host. Regeneration runs on the LAN box that '
            + 'runs the daily pipeline.',
            503,
        );
    }

    const negative = `${Comfy.NEGATIVE}, ${ARTIFACT_NEGATIVE}`;
    const result = await Judge.produceImage({
        prompt,
        articleId,
        article,
        n: HERO_N,
        lanes,
        // The salt is what makes this regeneration distinct from every earlier
        // one; it seeds the whole candidate ladder rather than a single render.
        saltBase: salt,
        // Realism LoRA and the hand-repair pass are the pipeline's defaults
        // and are exactly what this feature is for; named here so a change
        // to the defaults cannot silently drop them from a repair render.
        opts: { negative, realism: 0.7, fixHands: true },
        logger,
    });

    if (!result.image) {
        throw new RegenError(
            'no_quality',
            `No candidate passed the quality gates after ${result.rounds.length} round(s): ${result.reason}. `
            + 'The article keeps its current image. Try again, or edit the article text so the '
            + 'image prompt describes a simpler scene.',
            422,
        );
    }

    const stageDir = path.join(STAGE_ROOT, `${articleId}-${salt}`.replace(/[^A-Za-z0-9-]/g, '_'));
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });

    try {
        const filename = `${articleId}-${salt}.png`;
        fs.writeFileSync(path.join(stageDir, filename), result.image.buffer);

        const { verdicts, scanned } = await Safety.screen(stageDir, [filename], { logger });
        const verdict = verdicts.get(filename) || { safe: false, flags: [], error: 'no verdict' };
        if (!verdict.safe) {
            throw new RegenError(
                'unsafe',
                `The regenerated image was withheld by the safety scanner (${verdict.flags.join(', ') || verdict.error}). Try again.`,
                422,
            );
        }

        return {
            webp: await Images.toWebp(result.image.buffer),
            seed: result.image.seed,
            scanned,
            safety: verdict.skipped || !scanned ? 'unscanned' : 'safe',
            ms: result.image.ms,
            quality: {
                judge: result.image.rubric?.score ?? null,
                structural: result.image.structural?.score ?? null,
                rounds: result.rounds.length,
            },
        };
    } finally {
        fs.rmSync(stageDir, { recursive: true, force: true });
    }
}

// ── News articles ────────────────────────────────────────────────────────────

/** Locate a news article's day and manifest entry from its slug. */
async function findNewsEntry(slug, dateHint) {
    const days = [];
    if (dateHint) days.push(R2.dateFromPstString(dateHint));

    // The slug index is authoritative; fall back to walking recent days so a
    // just-published article is reachable before the index catches up.
    if (!dateHint) {
        const index = await R2.getObjectJson(News.NEWS_SLUGS_KEY);
        const found = index?.slugs?.[slug];
        if (found) days.push(R2.dateFromPstString(found));
        for (let i = 0; i < 14; i++) days.push(new Date(Date.now() - i * 86400000));
    }

    for (const date of days) {
        const manifest = await News.readNewsDayIndex(date);
        const entry = manifest?.articles?.find(a => a.slug === slug);
        if (entry) return { date, manifest, entry };
    }
    throw new RegenError('not_found', `No published news article with the slug "${slug}".`, 404);
}

/**
 * Re-fetch a news article's picture from the outlet that published the story.
 *
 * This used to render a fresh hero on the GPU. It cannot any more: news images
 * are the outlet's own photograph, and a single admin click that put a FLUX
 * render back on a published news article would quietly undo the guarantee the
 * whole sourcing change exists to make.
 *
 * What it does instead is the useful half of the same button — go back to the
 * source and pick the picture up again. That is the actual remedy when a story
 * published without one, or when the outlet has since swapped its lead image.
 *
 * Unlike the render path this needs no GPU, so it works from the VPSes too.
 */
async function regenerateNewsHero(slug, { dateHint, salt, logger }) {
    const ImageSource = require('./news-image-source');
    const Facts = require('./source-facts');

    const { date, entry } = await findNewsEntry(slug, dateHint);
    const articleId = entry.id || `${R2.pstDateString(date)}__${slug}`;

    if (!entry.source_url) {
        throw new RegenError('no_source', `"${slug}" has no source URL recorded, so there is nothing to re-fetch.`, 422);
    }

    const html = await Facts.fetchSourcePage(entry.source_url);
    if (!html) {
        throw new RegenError('source_unreachable', `Could not load ${entry.source_url}.`, 502);
    }

    const meta = Facts.extractMetaFacts(html);
    const ld = Facts.extractJsonLdNewsArticle(html);
    const pick = ImageSource.resolveImageUrl({}, {
        source_url: entry.source_url,
        image: Facts.absoluteUrl(meta?.image || ld?.image || '', entry.source_url),
        image_stage: meta?.image ? 'og' : (ld?.image ? 'jsonld' : ''),
    });
    if (!pick.url) {
        throw new RegenError('no_image_at_source', 'The source page no longer offers a usable image.', 422);
    }

    const { buffer, contentType } = await ImageSource.fetchImage(pick.url);
    const verdict = await ImageSource.validateSourcedImage(buffer, { contentType, url: pick.url });
    if (!verdict.ok) {
        throw new RegenError('image_rejected', `The source image was rejected: ${verdict.reason}.`, 422);
    }
    const webp = await ImageSource.normalizeSourcedImage(buffer);

    // A fresh id, so the URL differs from the one the CDN is caching. The salt
    // is what makes the replacement self-invalidating rather than something to
    // purge; matchStoredImages recovers it from the frontmatter on a rebuild.
    const imageId = Images.mintImageId(articleId, HERO_N, `${Images.SOURCED_SALT}:${salt}`);
    const upload = await News.publishNewsImage(entry, { imageId, buffer: webp, n: HERO_N, date, force: true });
    const rel = upload.key.slice(News.newsDayPrefix(date).length);

    // Repoint the stored markdown too. The manifest and the article's own
    // frontmatter are two records of the same fact, and a rebuild reads the
    // frontmatter — leaving them disagreeing is how a repair silently reverts
    // an image that was deliberately replaced.
    await repointNewsMarkdown(date, entry, rel, logger);

    // Only image fields are touched; the article's text, status and slug are
    // left exactly as published.
    const images = Array.isArray(entry.images) ? [...entry.images] : [];
    const heroIndex = images.findIndex(img => img.n === HERO_N);
    const heroRecord = {
        n: HERO_N,
        role: 'hero',
        id: imageId,
        file: rel,
        safety: 'sourced',
        image_source_url: pick.url,
        image_stage: pick.stage,
        image_credit: entry.source_name || '',
    };
    if (heroIndex === -1) images.unshift(heroRecord); else images[heroIndex] = heroRecord;

    await News.upsertNewsDayIndex({
        ...entry,
        image_file: rel,
        image_status: 'generated',
        image_source_url: pick.url,
        image_stage: pick.stage,
        image_credit: entry.source_name || '',
        images,
        date_updated: new Date().toISOString(),
    }, { date });

    logger.log(`[image-regen] news ${slug} -> ${upload.url} (re-sourced from ${pick.stage}, `
        + `${verdict.meta.width}x${verdict.meta.height} original)`);
    return { url: upload.url, safety: 'sourced', kind: 'news', slug, stage: pick.stage };
}

/**
 * Swap the hero image path inside a published article.md.
 *
 * A targeted substitution rather than a re-render: rebuilding the markdown
 * needs the composed fields, which only exist at compose time. Best effort —
 * the manifest is authoritative for display, so a failure here is worth logging
 * but not worth failing the replacement over.
 */
async function repointNewsMarkdown(date, entry, newRelPath, logger) {
    try {
        const prefix = News.newsDayPrefix(date);
        const key = `${prefix}${entry.file}`;
        const raw = await R2.getObjectText(key);
        if (!raw) return;

        const newFile = newRelPath.split('/').pop();
        const next = raw
            .replace(/^image_file:.*$/m, `image_file: images/${newFile}`)
            .replace(/images\/[0-9A-Za-z]{12}\.(webp|png)/g, `images/${newFile}`);
        if (next === raw) return;

        await R2.putObject({
            key,
            body: next,
            contentType: 'text/markdown; charset=utf-8',
            cacheControl: 'public, max-age=300',
            metadata: { article_slug: entry.slug },
        });
    } catch (e) {
        logger.log?.(`[image-regen] could not repoint markdown for ${entry.slug}: ${e.message.slice(0, 80)}`);
    }
}

// ── Category bundle articles ─────────────────────────────────────────────────

/** Route slug -> published folder, mirroring src/lib/articles.ts. */
const FOLDER_BY_ROUTE = { 'torah-hebraic-insights': 'torah-hebraic' };
const folderForRoute = (routeSlug) => FOLDER_BY_ROUTE[routeSlug] || routeSlug;

/** Regenerate a category article's image and republish it. */
async function regenerateCategoryHero(categorySlug, slug, { salt, logger }) {
    const folder = folderForRoute(categorySlug);
    const manifestKey = `articles/${folder}/articles.json`;

    const manifest = await R2.getObjectJson(manifestKey);
    if (!manifest || !Array.isArray(manifest.articles)) {
        throw new RegenError('not_found', `No published bundle for the category "${categorySlug}".`, 404);
    }
    const entry = manifest.articles.find(a => a?.slug === slug);
    if (!entry) throw new RegenError('not_found', `"${slug}" is not published in ${categorySlug}.`, 404);

    let body = '';
    try {
        body = (await R2.getObjectText(`articles/${folder}/${entry.file || `${slug}.md`}`)) || '';
    } catch { /* frontmatter fields are enough */ }

    const prompt = buildHeroPrompt({
        title: entry.title,
        summary: entry.summary,
        category: manifest.category || categorySlug,
        body: body.replace(/^---[\s\S]*?---/, ''),
    });

    const articleId = `${categorySlug}__${slug}`;
    const { webp, safety, seed, ms, quality } = await renderScreened(prompt, {
        articleId, salt, logger,
        article: { title: entry.title, topic: manifest.category || categorySlug, summary: entry.summary },
    });

    const file = `${Images.mintImageId(articleId, HERO_N, salt)}.${Images.IMAGE_EXT}`;
    const key = `articles/${folder}/images/${file}`;
    await R2.putObject({
        key,
        body: webp,
        contentType: Images.IMAGE_CONTENT_TYPE,
        cacheControl: IMAGE_CACHE,
    });

    // Read-modify-write the manifest, touching this entry's image fields only.
    // Everything else in the catalog is written back exactly as it was read.
    entry.image_file = file;
    entry.image_status = 'generated';
    manifest.updated = new Date().toISOString();
    await R2.putObject({
        key: manifestKey,
        body: JSON.stringify(manifest, null, 2),
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'public, max-age=60',
    });

    logger.log(`[image-regen] ${categorySlug}/${slug} -> ${R2.cdnUrl(key)} (seed ${seed}, ${ms}ms, ${safety}, `
        + `judge ${quality.judge ?? 'n/a'}, structural ${quality.structural ?? 'n/a'}, ${quality.rounds} round(s))`);
    return { url: R2.cdnUrl(key), safety, kind: 'category', slug, quality };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** In-flight regenerations, so one article cannot be started twice at once. */
const inFlight = new Map();

/**
 * Regenerate the hero image for one published article.
 *
 * @param {object} ref
 * @param {'news'|'category'} ref.kind
 * @param {string} ref.slug            article slug
 * @param {string} [ref.categorySlug]  required for kind 'category'
 * @param {string} [ref.date]          optional YYYY-MM-DD hint for kind 'news'
 */
async function regenerateArticleImage(ref, { logger = console } = {}) {
    if (!R2.isConfigured()) {
        throw new RegenError('not_configured', 'Storage is not configured on this host.', 503);
    }

    const kind = ref?.kind;
    const slug = String(ref?.slug || '').trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
        throw new RegenError('bad_request', 'A valid article slug is required.', 400);
    }

    const lockKey = kind === 'category' ? `${ref.categorySlug}/${slug}` : `news/${slug}`;
    if (inFlight.has(lockKey)) return inFlight.get(lockKey);

    // A salt no earlier run can repeat, so both the render and its URL are new.
    const salt = crypto.randomBytes(4).toString('hex');

    const work = (async () => {
        if (kind === 'category') {
            const categorySlug = String(ref.categorySlug || '').trim();
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(categorySlug)) {
                throw new RegenError('bad_request', 'A valid category slug is required.', 400);
            }
            return regenerateCategoryHero(categorySlug, slug, { salt, logger });
        }
        if (kind === 'news') {
            return regenerateNewsHero(slug, { dateHint: ref.date, salt, logger });
        }
        throw new RegenError('bad_request', `Unknown article kind "${kind}".`, 400);
    })();

    inFlight.set(lockKey, work);
    try {
        return await work;
    } finally {
        inFlight.delete(lockKey);
    }
}

module.exports = {
    RegenError,
    QUALITY_DIRECTIVE,
    ARTIFACT_NEGATIVE,
    buildHeroPrompt,
    gist,
    regenerateArticleImage,
    inFlightCount: () => inFlight.size,
};

#!/usr/bin/env node
'use strict';
/**
 * publish-daily-news.js — The daily faith-based news pipeline.
 *
 *   harvest  ~60 RSS feeds -> score -> dedupe -> quota-allocate to the target
 *   facts    fetch each source page -> JSON-LD / OG / <p> -> numbered fact sheet
 *   compose  ONE Claude call per article -> 9 fields + 3 image prompts
 *   images   3 x FLUX per article across the LAN GPU lanes -> safety scan
 *   publish  images -> article.md -> day index.json -> latest.json  (to R2)
 *
 * Runs on a LAN host. The GPUs at 10.0.0.52 are not reachable from the UAT or
 * production VPSes, so this is a scheduled script rather than a tick inside
 * server.js; the VPSes only read the result from cdn.jubileeverse.com.
 *
 * Usage:
 *   node scripts/publish-daily-news.js --dry-run
 *   node scripts/publish-daily-news.js --target 10
 *   node scripts/publish-daily-news.js --date 2026-07-31 --force
 *
 * Flags:
 *   --dry-run        harvest, dedupe and fact-extract only. No LLM, no upload.
 *   --target N       articles to publish (default 60, or NEWS_TARGET)
 *   --date YYYY-MM-DD  publish into a specific PST day folder
 *   --force          re-upload even when R2 already has identical bytes
 *   --no-images      compose and publish text only
 *   --batch          submit composition through the Batches API (half price)
 *   --repair         rebuild the day manifest from the objects in R2, then stop
 *   --to-webp        re-encode the day's published PNGs as WebP, then stop
 *   --prune a,b,c    delete those article folders from the day (needs --yes)
 *   --deadline M     abandon remaining work after M minutes (default: 3 per
 *                    article — 180 at the default target, floor of 90)
 *   --concurrency N  parallel compose calls in real-time mode (default 3)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

loadDotEnv();

const R2 = require('../lib/r2-client');
const News = require('../lib/r2-news');
const Sources = require('../lib/news-sources');
const Facts = require('../lib/source-facts');
const Composer = require('../lib/article-composer');
const Images = require('../lib/news-images');
const Safety = require('../lib/image-safety');
const Judge = require('../lib/image-judge');
const Comfy = require('../lib/comfy-client');

// ── Args and environment ─────────────────────────────────────────────────────

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const next = process.argv[i + 1];
    return (!next || next.startsWith('--')) ? true : next;
}
const has = (name) => process.argv.includes(`--${name}`);

/**
 * server/.env carries a UTF-8 BOM on line one, which would otherwise corrupt
 * the first key's name. Parsed by hand so this script has no dotenv dependency.
 */
function loadDotEnv() {
    const file = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && process.env[m[1]] === undefined) {
            process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
    }
}

/** Articles per day when nothing overrides it. */
const DEFAULT_TARGET = 60;

/**
 * Wall-clock budget, in minutes per article.
 *
 * The images are the long pole: three renders per article across the live GPU
 * lanes, plus a safety scan per wave. A flat deadline would silently become a
 * cap on the day — at three images each, a bigger target needs proportionally
 * more time or the last wave is abandoned and every article publishes with a
 * hero and nothing else. Three minutes per article is what the 30-article day
 * was given (90 minutes), kept per-article so the budget follows the target.
 *
 * The floor keeps small runs generous: `--target 5` still gets a sane window.
 */
const DEADLINE_MIN_PER_ARTICLE = 3;
const DEADLINE_FLOOR_MIN = 90;

const TARGET = Number(arg('target', process.env.NEWS_TARGET || DEFAULT_TARGET));

const OPTIONS = {
    dryRun: has('dry-run'),
    force: has('force'),
    noImages: has('no-images'),
    batch: has('batch'),
    repair: has('repair'),
    toWebp: has('to-webp'),
    prune: arg('prune', null),
    yes: has('yes'),
    target: TARGET,
    date: arg('date', null),
    deadlineMin: Number(
        arg('deadline', Math.max(DEADLINE_FLOOR_MIN, TARGET * DEADLINE_MIN_PER_ARTICLE)),
    ),
    concurrency: Number(arg('concurrency', 3)),
};

// Images stage to LOCAL temp, not server/.tmp. The repo sits on a mapped
// network drive, and writing ~1.5MB PNGs there only to have PowerShell read
// them straight back is both slow and needlessly dependent on the share being
// healthy. The lock stays in the repo so a second checkout can see it.
const STAGE_ROOT = path.join(os.tmpdir(), 'jv-news-images');
const LOCK_FILE = path.join(__dirname, '..', '.tmp', 'news-publish.lock');

const LOG_DIR = path.join(__dirname, '..', 'logs', 'news');

// Floor for "is this a real image object". WebP renders land well above this;
// anything smaller is a truncated upload.
const MIN_IMAGE_BYTES = 8 * 1024;

/**
 * Log to stdout and to a dated file.
 *
 * A scheduled task's console output is gone the moment it exits, and Task
 * Scheduler only records an exit code. The file is what makes a failed 02:00
 * run diagnosable at 09:00; the R2 status object (see reportStatus) is what
 * makes it visible without shell access at all.
 */
let _logStream = null;
function log(m) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`;
    console.log(line);
    try {
        if (!_logStream) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
            const day = new Date().toISOString().slice(0, 10);
            _logStream = fs.createWriteStream(path.join(LOG_DIR, `${day}.log`), { flags: 'a' });
        }
        _logStream.write(`${line}\n`);
    } catch { /* logging must never take the run down */ }
}

/** Delete run logs older than `days`, so the folder cannot grow without bound. */
function pruneLogs(days = 30) {
    try {
        const cutoff = Date.now() - days * 86400000;
        for (const name of fs.readdirSync(LOG_DIR)) {
            const file = path.join(LOG_DIR, name);
            if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
        }
    } catch { /* nothing to prune */ }
}

// ── Single-writer lock ───────────────────────────────────────────────────────

/**
 * One writer at a time. Two concurrent runs would race on the day manifest,
 * and last-writer-wins on a whole JSON object silently loses entries.
 */
function acquireLock() {
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    if (fs.existsSync(LOCK_FILE)) {
        const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
        const staleAfter = OPTIONS.deadlineMin * 2 * 60 * 1000;
        if (age < staleAfter) {
            const holder = fs.readFileSync(LOCK_FILE, 'utf8').trim();
            throw new Error(`another run holds the lock (${holder}, ${Math.round(age / 1000)}s old)`);
        }
        log(`clearing a stale lock (${Math.round(age / 60000)} min old)`);
    }
    fs.writeFileSync(LOCK_FILE, `pid=${process.pid} host=${os.hostname()} started=${new Date().toISOString()}`);
}

function releaseLock() {
    try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
}

// ── Dedupe corpus ────────────────────────────────────────────────────────────

/**
 * Recent manifest entries, used to reject stories already covered.
 *
 * Read from R2 rather than Postgres: this keeps the pipeline decoupled from the
 * shared multi-tenant database, where an unfiltered query leaks other sites'
 * content, and lets the job run anywhere R2 credentials exist.
 */
async function loadRecentlyPublished(date, days = 14) {
    const entries = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(date.getTime() - i * 86400000);
        try {
            const manifest = await News.readNewsDayIndex(d);
            if (manifest?.articles?.length) entries.push(...manifest.articles);
        } catch (e) {
            log(`  warn: could not read ${R2.pstDateString(d)} manifest: ${e.message}`);
        }
    }
    return entries;
}

// ── Selection ────────────────────────────────────────────────────────────────

async function selectStories(date, target = OPTIONS.target) {
    log('harvesting feeds...');

    // Harvest depth scales with the target. Candidates are free once a feed has
    // been fetched, and the funnel below is lossy in a way that grows with the
    // day's size: dedupe runs against a 14-day window that is itself
    // proportional to the target, so a pool that comfortably fed 30 articles
    // would leave 60 short. Anchored on the 30-article day's 12, so that day
    // computes to exactly 12 and keeps its ~3x headroom at any target.
    const perTopicCap = Math.max(12, Math.ceil((target / Sources.QUOTA_BASELINE) * 12));
    const { byTopic, feedErrors } = await Sources.harvestCandidates(null, { perTopicCap });
    const all = [...byTopic.values()].flat();
    log(`  ${all.length} candidates from ${Object.keys(Sources.DEFAULT_QUOTAS).length} topics `
        + `(cap ${perTopicCap}/topic), ${feedErrors.length} feed error(s)`);

    const published = await loadRecentlyPublished(date);
    log(`  ${published.length} articles published in the last 14 days`);

    const { fresh, rejected } = Sources.filterAlreadyPublished(all, published);
    const reasons = rejected.reduce((acc, r) => ({ ...acc, [r.reason]: (acc[r.reason] || 0) + 1 }), {});
    log(`  ${fresh.length} fresh after dedupe ${JSON.stringify(reasons)}`);

    const { kept, dropped } = Sources.collapseWithinRun(fresh);
    if (dropped.length) log(`  ${dropped.length} collapsed as the same event within this run`);

    const regrouped = new Map();
    for (const c of kept) {
        if (!regrouped.has(c.topic)) regrouped.set(c.topic, []);
        regrouped.get(c.topic).push(c);
    }

    // Attempt a reserve above the target so refusals and validation rejects do
    // not force a second round trip.
    const reserve = Math.ceil(target * 0.2);
    const { selected, shortfall, perTopic } = Sources.allocateQuota(regrouped, {
        target: target + reserve,
    });
    log(`  selected ${selected.length} (target ${target} + ${reserve} reserve, `
        + `max ${Sources.perSourceCapFor(target + reserve)}/outlet) ${JSON.stringify(perTopic)}`);
    if (shortfall > 0) log(`  SHORTFALL ${shortfall} — feeds are thin today; publishing fewer rather than inventing filler`);

    return { selected, all: kept, feedErrors, shortfall };
}

async function buildFactSheets(stories, allCandidates) {
    log('extracting facts from source pages...');
    const out = [];
    const tally = { full: 0, partial: 0, headline_only: 0 };
    for (const story of stories) {
        const sheet = await Facts.buildFactSheet(story, { allCandidates, logger: { log() {}, warn() {} } });
        // Corroborators found during the same-event collapse are already
        // attached to the candidate; merge them in.
        if (story.corroborators?.length) {
            const seen = new Set(sheet.corroborating_sources.map(c => c.url));
            sheet.corroborating_sources.push(...story.corroborators.filter(c => !seen.has(c.url)));
        }
        tally[sheet.confidence]++;
        out.push({ story, sheet });
    }
    log(`  confidence: ${JSON.stringify(tally)}`);
    return out;
}

// ── Composition ──────────────────────────────────────────────────────────────

function composeInput({ story, sheet }, recentTitles) {
    return {
        factSheet: sheet,
        topic: story.topic,
        writer: News.DEFAULT_WRITER,
        sourceUrl: story.link,
        recentTitles,
    };
}

/**
 * Compose in real time with a small concurrency window.
 *
 * A circuit breaker trips if half of the first ten attempts fail: a bad prompt
 * change or an expired credential should cost five calls, not thirty.
 */
async function composeRealtime(sheets, recentTitles, target = OPTIONS.target) {
    const results = [];
    let attempted = 0;
    let failed = 0;
    let cursor = 0;

    const worker = async () => {
        for (;;) {
            const item = sheets[cursor++];
            if (!item) return;
            if (results.filter(r => r.fields).length >= target) return;
            try {
                attempted++;
                const r = await Composer.composeArticle(composeInput(item, recentTitles));
                results.push({ ...item, fields: r.fields, usage: r.usage });
                log(`  [${results.filter(x => x.fields).length}/${target}] ${r.fields.title.slice(0, 62)}`);
            } catch (e) {
                failed++;
                log(`  skip (${e.kind || 'error'}): ${item.story.title.slice(0, 50)} — ${e.message.slice(0, 90)}`);
                if (attempted >= 10 && failed / attempted >= 0.5) {
                    throw new Error(
                        `circuit breaker: ${failed}/${attempted} compositions failed`,
                        { cause: e },
                    );
                }
            }
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, OPTIONS.concurrency) }, worker));
    return results.filter(r => r.fields);
}

/** Compose everything through the Batches API at half price. */
async function composeBatched(sheets, recentTitles, target = OPTIONS.target) {
    const requests = sheets.map(item => ({
        customId: item.story.contentHash.slice(0, 60),
        input: composeInput(item, recentTitles),
    }));
    const byId = new Map(sheets.map(item => [item.story.contentHash.slice(0, 60), item]));

    const out = await Composer.composeBatch(requests);
    const results = [];
    for (const [customId, r] of out) {
        const item = byId.get(customId);
        if (!item) continue;
        if (r.error) {
            log(`  skip (${r.error.kind || 'error'}): ${item.story.title.slice(0, 50)}`);
            continue;
        }
        results.push({ ...item, fields: r.fields, usage: r.usage });
    }
    return results.slice(0, target);
}

// ── Publication ──────────────────────────────────────────────────────────────

/** Assemble the article record the R2 layer expects. */
function toArticle({ story, sheet, fields }, slug, date) {
    const articleId = `${R2.pstDateString(date)}__${slug}`;
    return {
        slug,
        articleId,
        title: fields.title,
        writer: News.DEFAULT_WRITER,
        topic: story.topic,
        category: story.topic,
        summary: fields.marketing_summary.slice(0, 200),
        marketing_summary: fields.marketing_summary,
        introduction: fields.introduction,
        body: fields.body,
        faith_relevance_analysis: fields.faith_relevance_analysis,
        source_name: sheet.source_name,
        source_url: story.link,
        content_hash: story.contentHash,
        fact_confidence: sheet.confidence,
        date_published: R2.pstDateString(date),
        date_updated: new Date().toISOString(),
        image_set_id: Images.mintImageSetId(articleId),
        image_prompts: fields.image_prompts,
        // headline-only stories are held back from the feed: thin sourcing is
        // not something to lead with.
        status: sheet.confidence === 'headline_only' ? 'draft' : 'published',
    };
}

/** Stage a buffer to disk so the safety scanner (a folder tool) can see it. */
function stageImage(dir, filename, buffer) {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, filename);
    fs.writeFileSync(dest, buffer);
    return dest;
}

/**
 * Retry rounds for the supporting and symbolic images.
 *
 * Lower than the hero's. A missing supporting image costs the article one
 * illustration further down the page and the next run backfills it; a missing
 * hero costs the article its place in the feed, which is worth escalating for.
 */
const SUPPORTING_ROUNDS = Number(process.env.NEWS_SUPPORTING_ROUNDS || 2);

/**
 * Hold an article back when its hero never cleared the gates.
 *
 * Drafting reuses the mechanism that already holds back thin-sourced stories,
 * so nothing new appears on the reader's side: the article simply does not
 * enter the feed. The text is still written and still published, so a later run
 * that produces a usable hero can promote it without recomposing anything.
 */
function draftForFailedHero(byArticle, drafted, article, reason) {
    drafted.add(article.slug);
    const record = byArticle.get(article.slug);
    if (!record || record.article.status === 'draft') return;
    record.article.status = 'draft';
    record.article.image_status = 'quality_failed';
    log(`  ${article.slug} -> draft (${reason})`);
}

/**
 * Run counters for the night's image quality, reported at the end.
 *
 * These are the numbers the final bake-off compares profiles on, so they are
 * collected on every run rather than only under an evaluation flag.
 */
function createQualityReport() {
    const rows = [];
    return {
        record(job, result) {
            rows.push({
                slug: job.article.slug,
                n: job.n,
                rounds: result.rounds?.length || 0,
                rendered: (result.rounds || []).reduce((s, r) => s + (r.rendered || 0), 0),
                structuralPassed: (result.rounds || []).reduce((s, r) => s + (r.structuralPassed || 0), 0),
                judgeScore: result.image?.rubric?.score ?? null,
                structuralScore: result.image?.structural?.score ?? null,
                accepted: Boolean(result.image),
                reason: result.reason,
            });
        },
        rows: () => rows,
        summary() {
            const heroes = rows.filter(r => r.n === 1);
            const accepted = rows.filter(r => r.accepted);
            const judged = accepted.filter(r => r.judgeScore != null);
            const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
            return {
                images: rows.length,
                accepted: accepted.length,
                rendered: rows.reduce((s, r) => s + r.rendered, 0),
                structuralPassRate: rows.reduce((s, r) => s + r.rendered, 0)
                    ? Math.round(100 * rows.reduce((s, r) => s + r.structuralPassed, 0)
                        / rows.reduce((s, r) => s + r.rendered, 0))
                    : null,
                retried: rows.filter(r => r.rounds > 1).length,
                heroesFailed: heroes.filter(r => !r.accepted).length,
                meanJudgeScore: mean(judged.map(r => r.judgeScore)),
                meanStructuralScore: mean(accepted.filter(r => r.structuralScore != null).map(r => r.structuralScore)),
            };
        },
    };
}

/**
 * Render, screen, and upload every image, then publish the markdown.
 *
 * Jobs are ordered by image number across all articles, so every article's hero
 * renders before any article's second image. Combined with publishing after
 * each wave, an article goes live with a hero image within minutes and a slow
 * GPU only delays the supporting images.
 */
async function publishAll(articles, date) {
    const lanes = OPTIONS.noImages ? [] : await Comfy.liveLanes();
    if (!OPTIONS.noImages) {
        log(lanes.length
            ? `image lanes up: ${lanes.length}`
            : 'no ComfyUI lane reachable — publishing text now, images on the next run');
    }

    const byArticle = new Map(articles.map(a => [a.slug, { article: a, images: [] }]));
    const deadline = Date.now() + OPTIONS.deadlineMin * 60000;

    // Articles whose hero never cleared the quality gates. They still publish —
    // as drafts, with their text intact — rather than shipping a defective
    // photograph or leaving the reader an empty card.
    const drafted = new Set();
    const quality = createQualityReport();

    for (let n = 1; n <= (lanes.length ? Images.IMAGES_PER_ARTICLE : 0); n++) {
        if (Date.now() > deadline) { log(`deadline reached — abandoning image wave ${n}; the next run fills it in`); break; }
        log(`image wave ${n}/${Images.IMAGES_PER_ARTICLE}`
            + (n === 1 ? ` (best-of-${Judge.HERO_CANDIDATES})` : ''));
        // An image problem must never cost us the articles. Anything thrown by
        // rendering, screening, or uploading ends this wave and falls through
        // to publishing whatever text and images we already have.
        try {

        const stageDir = path.join(STAGE_ROOT, R2.pstDateString(date), `wave${n}`);
        fs.rmSync(stageDir, { recursive: true, force: true });

        // Drafted articles are not worth more GPU time: a draft is held back
        // from the feed, so its supporting images would never be seen.
        const wanted = articles.filter(a => !(n > 1 && drafted.has(a.slug)));

        const jobs = wanted.map(a => {
            const prompts = Images.normalizePrompts(a.image_prompts, a);
            return { article: a, n, ...prompts[n - 1] };
        });

        // One shared pool rather than a lane-per-worker loop: every article's
        // candidates queue together, so a lane never idles waiting for the
        // slowest sibling of the article currently in front of it.
        const pool = Comfy.createLanePool(lanes);
        const staged = [];

        await Promise.all(jobs.map(async (job) => {
            if (Date.now() > deadline) return;
            const imageId = Images.mintImageId(job.article.articleId, n);
            const key = News.buildNewsImageKey(job.article, imageId, date);

            // Skip-if-present: the single biggest robustness win. A re-run
            // after a crash costs almost no GPU time.
            if (!OPTIONS.force) {
                const existing = await R2.headObject(key);
                if (existing && existing.size > Comfy.MIN_PNG_BYTES) {
                    byArticle.get(job.article.slug).images.push({
                        n, role: job.role, url: R2.cdnUrl(key), safety: 'previously-cleared',
                    });
                    return;
                }
            }

            try {
                // Both quality gates, the escalating retry, and the selection
                // all live in lib/image-judge.js so the admin regeneration
                // button runs this exact path rather than a parallel copy.
                const result = await Judge.produceImage({
                    prompt: job.prompt,
                    articleId: job.article.articleId,
                    article: job.article,
                    n,
                    candidates: n === 1 ? Judge.HERO_CANDIDATES : 1,
                    maxRounds: n === 1 ? Judge.MAX_ROUNDS : SUPPORTING_ROUNDS,
                    render: (prompt, seed) => {
                        if (Date.now() > deadline) throw new Error('deadline reached');
                        return pool.submit(lane => Comfy.generateImage(prompt, { lane, seed }));
                    },
                    logger: { log, warn: log },
                });

                quality.record(job, result);

                if (!result.image) {
                    // A deadline is not a quality verdict. Leave the article as
                    // it is and let the next run fill the image in.
                    if (Date.now() > deadline) return;
                    log(`  ${job.article.slug} #${n}: ${result.reason}`);
                    if (n === 1) draftForFailedHero(byArticle, drafted, job.article, result.reason);
                    return;
                }

                const filename = `${imageId}.png`;
                stageImage(stageDir, filename, result.image.buffer);
                staged.push({ job, imageId, filename, buffer: result.image.buffer, key, quality: result });
            } catch (e) {
                log(`  image ${job.article.slug} #${n}: ${e.message.slice(0, 80)}`);
            }
        }));

        if (!staged.length) { log('  nothing rendered in this wave'); continue; }

        // One scan per wave, not per image: each invocation opens a WinRM
        // session and cold-starts Python on the GPU box.
        const { verdicts, scanned } = await Safety.screen(stageDir, staged.map(s => s.filename));
        log(`  safety: ${scanned ? 'scanned' : 'not scanned'}, ${staged.length} staged`);

        for (const s of staged) {
            const verdict = verdicts.get(s.filename) || { safe: false, flags: [] };
            if (!verdict.safe) {
                log(`  withheld ${s.job.article.slug} #${n}: ${verdict.flags.join('/') || verdict.error}`);
                continue;
            }
            try {
                // Encode only now: the classifier read the staged PNGs, and
                // re-encoding before that would hand it a format it has never
                // been exercised against for no gain.
                const webp = await Images.toWebp(s.buffer);
                const up = await News.publishNewsImage(s.job.article, {
                    imageId: s.imageId, buffer: webp, n, date, force: OPTIONS.force,
                });
                byArticle.get(s.job.article.slug).images.push({
                    n, role: s.job.role, url: up.url, safety: verdict.skipped ? 'unscanned' : 'safe',
                    // Carried into the manifest so a published image can be
                    // traced back to the marks that let it through.
                    quality_score: s.quality?.image?.rubric?.score ?? null,
                    structural_score: s.quality?.image?.structural?.score ?? null,
                    rounds: s.quality?.rounds?.length ?? 1,
                });
            } catch (e) {
                log(`  upload failed ${s.job.article.slug} #${n}: ${e.message.slice(0, 80)}`);
            }
        }

        fs.rmSync(stageDir, { recursive: true, force: true });
        } catch (e) {
            log(`  image wave ${n} aborted: ${e.message.slice(0, 120)}`);
        }

        // Publish after every wave. Wave one puts the article live with a hero
        // image; later waves re-render the markdown to embed the new images.
        await publishWave(byArticle, date);
    }

    if (!lanes.length) await publishWave(byArticle, date);

    if (quality.rows().length) {
        const s = quality.summary();
        log(`image quality: ${s.accepted}/${s.images} accepted from ${s.rendered} renders `
            + `| structural pass ${s.structuralPassRate}% | retried ${s.retried} `
            + `| heroes failed ${s.heroesFailed} | mean judge ${s.meanJudgeScore ?? 'n/a'} `
            + `| mean structural ${s.meanStructuralScore ?? 'n/a'}`);
    }
    if (drafted.size) log(`drafted for want of a usable hero: ${[...drafted].join(', ')}`);

    return byArticle;
}

/**
 * Upload markdown and refresh the day index for everything we have so far.
 *
 * Ordering is a hard rule: images, then article.md, then index.json. The
 * markdown embeds absolute image URLs, and the index write is what makes an
 * article visible, so visibility comes only after the bytes are provably there.
 */
async function publishWave(byArticle, date) {
    const entries = [];
    for (const { article, images } of byArticle.values()) {
        try {
            await News.publishNewsArticle(article, { images, date, force: OPTIONS.force });
            entries.push(News.buildIndexEntry(article, { images, date }));
        } catch (e) {
            // Never index an article whose markdown is not confirmed present.
            log(`  markdown upload failed for ${article.slug}: ${e.message.slice(0, 90)}`);
        }
    }
    if (entries.length) await News.upsertNewsDayIndex(entries, { date });
    return entries;
}

/**
 * Fill in images for articles already published today.
 *
 * This is what a second run of the day does once the article target is met:
 * no new stories, no model calls, just the images a previous run could not
 * finish because the GPU was busy, the deadline hit, or the safety scanner was
 * unreachable. Skip-if-present makes it nearly free when there is nothing to do.
 */
async function backfillImages(manifest, date) {
    const pending = (manifest?.articles || []).filter(a => (a.images?.length ?? 0) < Images.IMAGES_PER_ARTICLE);
    if (!pending.length) { log('  every article already has its full image set'); return; }

    log(`  ${pending.length} article(s) missing images`);
    const lanes = OPTIONS.noImages ? [] : await Comfy.liveLanes();
    if (!lanes.length) { log('  no ComfyUI lane reachable — leaving them for the next run'); return; }

    // The prompts live in the article's markdown frontmatter only as a set id,
    // so regenerate from the stored title. Prompts are not re-derived from the
    // model: that would cost a composition call to redo work already paid for.
    for (const entry of pending) {
        const article = {
            slug: entry.slug,
            articleId: entry.id,
            title: entry.title,
            topic: entry.topic,
            image_set_id: entry.image_set_id,
        };
        const have = new Set((entry.images || []).map(i => i.n));
        const prompts = Images.normalizePrompts(null, article);

        for (let n = 1; n <= Images.IMAGES_PER_ARTICLE; n++) {
            if (have.has(n)) continue;
            const imageId = Images.mintImageId(entry.id, n);
            const key = News.buildNewsImageKey(article, imageId, date);
            if (await R2.headObject(key)) continue;
            try {
                const r = await Comfy.generateImage(prompts[n - 1].prompt, {
                    lane: lanes[(n - 1) % lanes.length],
                    seed: Images.seedFor(entry.id, n),
                });
                const stageDir = path.join(STAGE_ROOT, R2.pstDateString(date), 'backfill');
                const filename = `${imageId}.png`;
                stageImage(stageDir, filename, r.buffer);
                const { verdicts } = await Safety.screen(stageDir, [filename]);
                fs.rmSync(stageDir, { recursive: true, force: true });
                if (!verdicts.get(filename)?.safe) { log(`  withheld ${entry.slug} #${n}`); continue; }
                await News.publishNewsImage(article, { imageId, buffer: await Images.toWebp(r.buffer), n, date });
                log(`  filled ${entry.slug} #${n}`);
            } catch (e) {
                log(`  ${entry.slug} #${n}: ${e.message.slice(0, 80)}`);
            }
        }
    }

    // Re-derive image state from storage so the manifest matches reality.
    await News.rewriteNewsDayIndex(manifest.articles, { date });
}

/** Read the scalar frontmatter block from an article.md. */
function parseFrontmatter(markdown) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown || '');
    if (!m) return {};
    const out = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
        if (!kv) continue;
        let value = kv[2].trim();
        if (value.startsWith('[') || value.startsWith('{')) continue;
        value = value.replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
        out[kv[1]] = value;
    }
    return out;
}

/**
 * Rebuild a day's manifest from the objects actually in R2.
 *
 * The manifest is authoritative, which cuts both ways: if it loses an entry,
 * a perfectly good article becomes invisible even though its bytes are still
 * there. This walks the day prefix, reads each article's frontmatter, and
 * re-derives image state from storage, so the index can always be reconstructed
 * from the content itself.
 */
async function repairManifest(date) {
    const prefix = News.newsDayPrefix(date);
    const keys = await R2.listPrefix(prefix);
    log(`repairing ${prefix} from ${keys.size} objects`);

    const bySlug = new Map();
    for (const [key, size] of keys) {
        // Accept either extension: images published before the WebP switch are
        // still .png, and a rebuild must not orphan them.
        const m = new RegExp(`^${prefix}([^/]+)/(article\\.md|images/([0-9A-Za-z]{12})\\.(webp|png))$`).exec(key);
        if (!m) continue;
        if (!bySlug.has(m[1])) bySlug.set(m[1], { slug: m[1], md: false, images: new Map() });
        const rec = bySlug.get(m[1]);
        if (m[2] === 'article.md') rec.md = true;
        else if (size > MIN_IMAGE_BYTES) rec.images.set(m[3], m[4]);
    }

    const entries = [];
    for (const rec of bySlug.values()) {
        if (!rec.md) { log(`  skip ${rec.slug} — no article.md`); continue; }
        const raw = await R2.getObjectText(`${prefix}${rec.slug}/article.md`);
        const fm = parseFrontmatter(raw);
        const articleId = fm.id || `${R2.pstDateString(date)}__${rec.slug}`;

        // Match each stored image back to its slot by re-deriving the id, so
        // ordering comes from the derivation and never from key sort order.
        const images = [];
        for (let n = 1; n <= Images.IMAGES_PER_ARTICLE; n++) {
            const id = Images.mintImageId(articleId, n);
            const ext = rec.images.get(id);
            if (ext) {
                images.push({ n, role: Images.ROLES[n - 1], url: R2.cdnUrl(`${prefix}${rec.slug}/images/${id}.${ext}`) });
            }
        }

        entries.push(News.buildIndexEntry({
            slug: rec.slug,
            articleId,
            title: fm.title || rec.slug,
            writer: fm.writer || News.DEFAULT_WRITER,
            topic: fm.topic || '',
            category: fm.category || '',
            summary: fm.summary || '',
            marketing_summary: fm.marketing_summary || '',
            source_name: fm.source_name || '',
            source_url: fm.source_url || '',
            fact_confidence: fm.fact_confidence || 'headline_only',
            date_published: fm.date_published || R2.pstDateString(date),
            date_updated: fm.date_updated || new Date().toISOString(),
            image_set_id: fm.image_set_id || '',
            status: fm.status === 'draft' ? 'draft' : 'published',
        }, { images, date }));

        log(`  ${rec.slug}: ${images.length}/3 images`);
    }

    await News.rewriteNewsDayIndex(entries, { date });
    const published = entries.filter(e => e.status === 'published').length;
    await News.upsertNewsLatest({ date, count: published });
    // Slug -> date index: article URLs are the bare slug, so readers need this
    // to know which day folder to look in.
    await News.upsertNewsSlugIndex(entries, { date });
    log(`rebuilt manifest: ${entries.length} entries, ${published} published`);
    return entries;
}

/**
 * Delete named article folders from a day, then rebuild the manifest.
 *
 * Takes an explicit slug list rather than inferring what looks obsolete:
 * deletion is not recoverable, so the caller says exactly what goes. Prints the
 * full key list first, and does nothing at all unless --yes is passed.
 */
async function pruneArticles(date, slugs) {
    if (!slugs.length) { log('--prune needs a comma-separated slug list'); return; }

    const prefix = News.newsDayPrefix(date);
    log(`prune ${slugs.length} article(s) from ${prefix}`);

    let total = 0;
    const plan = [];
    for (const slug of slugs) {
        const keys = [...(await R2.listPrefix(`${prefix}${slug}/`)).keys()];
        if (!keys.length) { log(`  MISSING  ${slug}`); continue; }
        plan.push({ slug, keys });
        total += keys.length;
        log(`  ${String(keys.length).padStart(2)} objects  ${slug}`);
    }

    if (!plan.length) { log('nothing to delete'); return; }

    if (!OPTIONS.yes) {
        log(`\n${total} objects would be deleted. Re-run with --yes to apply.`);
        return;
    }

    let deleted = 0;
    for (const { slug, keys } of plan) {
        const res = await R2.deleteObjects(keys);
        deleted += res.deleted.length;
        for (const e of res.errors) log(`  ERROR ${e.key}: ${e.message}`);
        log(`  deleted ${res.deleted.length}/${keys.length}  ${slug}`);
    }
    log(`deleted ${deleted} objects`);

    // The manifest is authoritative, so it has to stop listing what is gone.
    await repairManifest(date);
}

/** Publish a run summary to R2, best effort. Never fails the run. */
async function reportStatus(summary) {
    try {
        const res = await News.publishRunStatus(summary);
        log(`  status: ${summary.status} -> ${res.url}`);
    } catch (e) {
        log(`  status report failed: ${e.message.slice(0, 90)}`);
    }
}

/**
 * Repoint every `images/<id>.png` reference in a day's markdown at `.webp`.
 *
 * Article bodies carry absolute CDN image URLs, and the frontmatter carries a
 * relative `image_file`. Both name the extension, so converting the objects
 * without touching the markdown leaves the rendered article pointing at files
 * that no longer exist.
 *
 * A plain extension swap rather than a re-render: the ids are unchanged, and
 * re-rendering would need the article fields, which only exist at compose time.
 */
async function rewriteMarkdownImageLinks(date) {
    const prefix = News.newsDayPrefix(date);
    const keys = await R2.listPrefix(prefix);
    const docs = [...keys.keys()].filter(k => k.endsWith('/article.md'));

    let changed = 0;
    for (const key of docs) {
        try {
            const raw = await R2.getObjectText(key);
            if (!raw) continue;
            const next = raw.replace(/(images\/[0-9A-Za-z]{12})\.png\b/g, '$1.webp');
            if (next === raw) continue;

            await R2.putObject({
                key,
                body: next,
                contentType: 'text/markdown; charset=utf-8',
                cacheControl: 'public, max-age=300',
                metadata: { article_slug: key.split('/').slice(-2)[0] },
            });
            changed++;
        } catch (e) {
            log(`  markdown rewrite failed ${key}: ${e.message.slice(0, 70)}`);
        }
    }
    log(changed ? `repointed image links in ${changed} article(s)` : 'article markdown already points at .webp');
    return changed;
}

/**
 * Re-encode a day's published PNGs as WebP, then drop the originals.
 *
 * Images were PNG until the format switch. They are ~10x larger than they need
 * to be, and a mixed corpus means every consumer has to care which extension a
 * given article uses. This converts in place: upload the .webp, rewrite the
 * manifest off storage, then delete the .png only once its replacement is
 * confirmed present.
 */
async function convertDayToWebp(date) {
    const prefix = News.newsDayPrefix(date);
    const keys = await R2.listPrefix(prefix);
    const pngs = [...keys.entries()]
        .filter(([k]) => /\/images\/[0-9A-Za-z]{12}\.png$/.test(k))
        .map(([key, size]) => ({ key, size }));

    if (!pngs.length) {
        log(`${prefix} has no PNGs to convert`);
        // Still repoint the markdown: a previous run may have converted the
        // images and left the article bodies pointing at the old objects.
        await rewriteMarkdownImageLinks(date);
        return;
    }

    const before = pngs.reduce((sum, p) => sum + p.size, 0);
    log(`converting ${pngs.length} PNG(s) in ${prefix} (${(before / 1048576).toFixed(1)} MB)`);

    let after = 0;
    let converted = 0;
    const done = [];

    for (const png of pngs) {
        const webpKey = png.key.replace(/\.png$/, '.webp');
        try {
            const existing = await R2.headObject(webpKey);
            if (existing && existing.size > MIN_IMAGE_BYTES && !OPTIONS.force) {
                after += existing.size;
                done.push(png.key);
                converted++;
                continue;
            }

            const body = await R2.getObjectBuffer(png.key);
            if (!body) { log(`  read failed ${png.key}`); continue; }

            const webp = await Images.toWebp(body);
            // A conversion that grew, or came back tiny, is not worth trusting.
            if (webp.length < MIN_IMAGE_BYTES || webp.length >= png.size) {
                log(`  skip ${png.key.split('/').pop()} — ${webp.length} bytes vs ${png.size}`);
                continue;
            }

            await R2.putObject({
                key: webpKey,
                body: webp,
                contentType: News.IMAGE_CONTENT_TYPE,
                cacheControl: 'public, max-age=604800',
            });
            after += webp.length;
            converted++;
            done.push(png.key);
        } catch (e) {
            log(`  ${png.key.split('/').pop()}: ${e.message.slice(0, 70)}`);
        }
    }

    log(`converted ${converted}/${pngs.length} — ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`
        + ` (${before ? Math.round((1 - after / before) * 100) : 0}% smaller)`);

    // The article bodies embed absolute image URLs, so converting the objects
    // is only half the job — without this the manifest says .webp while every
    // rendered article still points at a .png that is about to be deleted.
    await rewriteMarkdownImageLinks(date);

    // Point the manifest at the new objects BEFORE deleting the old ones, so
    // there is never a moment where an entry references a key that is gone.
    await repairManifest(date);

    if (done.length) {
        const res = await R2.deleteObjects(done);
        log(`deleted ${res.deleted.length} superseded PNG(s)`);
        for (const e of res.errors) log(`  ERROR ${e.key}: ${e.message}`);
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const started = Date.now();
    const date = OPTIONS.date ? R2.dateFromPstString(OPTIONS.date) : new Date();
    const day = R2.pstDateString(date);

    log(`daily news pipeline — ${day} (PST) target=${OPTIONS.target} `
        + `deadline=${OPTIONS.deadlineMin}min${OPTIONS.dryRun ? ' [DRY RUN]' : ''}`);

    if (!OPTIONS.dryRun && !R2.isConfigured()) {
        // Fail before spending any GPU or model time.
        throw new Error('R2 is not configured — refusing to start');
    }

    if (OPTIONS.prune) {
        await pruneArticles(date, String(OPTIONS.prune).split(',').map(x => x.trim()).filter(Boolean));
        return;
    }

    if (OPTIONS.toWebp) {
        await convertDayToWebp(date);
        return;
    }

    if (OPTIONS.repair) {
        await repairManifest(date);
        return;
    }

    // How much of today's target is already met.
    //
    // This is what makes repeat runs safe. Dedupe only rejects stories we have
    // already covered, so without this a second run would happily select a
    // whole second day's worth of DIFFERENT stories and publish twice the
    // target. Instead each run tops up to the target and then does nothing but
    // retry missing images.
    const todayManifest = await News.readNewsDayIndex(date);
    const alreadyPublished = (todayManifest?.articles || []).filter(a => a.status === 'published').length;
    const remaining = Math.max(0, OPTIONS.target - alreadyPublished);
    if (alreadyPublished) {
        log(`already published today: ${alreadyPublished}/${OPTIONS.target} — ${remaining} to go`);
    }

    if (!remaining && !OPTIONS.dryRun) {
        log("today's target is already met; filling in any missing images only");
        await backfillImages(todayManifest, date);

        // Report even on this path. A monitor that only hears from full runs
        // cannot tell "nothing to do" from "the job never fired".
        const after = await News.readNewsDayIndex(date);
        const pub = (after?.articles || []).filter(a => a.status === 'published');
        const full = pub.filter(a => a.image_status === 'generated').length;
        await reportStatus({
            status: full === pub.length ? 'ok' : 'partial',
            mode: 'top-up',
            date: day,
            started_at: new Date(started).toISOString(),
            finished_at: new Date().toISOString(),
            duration_min: Number(((Date.now() - started) / 60000).toFixed(1)),
            host: os.hostname(),
            target: OPTIONS.target,
            published: pub.length,
            composed: 0,
            with_full_images: full,
            missing_images: pub.length - full,
            shortfall: 0,
            index_url: R2.cdnUrl(News.buildNewsDayIndexKey(date)),
        });
        return;
    }

    const { selected, all, shortfall } = await selectStories(date, remaining || OPTIONS.target);
    if (!selected.length) { log('no stories to publish today'); return; }

    const sheets = await buildFactSheets(selected, all);

    if (OPTIONS.dryRun) {
        log('');
        log('DRY RUN — selected stories:');
        sheets.forEach(({ story, sheet }, i) => {
            log(`${String(i + 1).padStart(3)}. [${String(story.score.total).padStart(3)}] ${sheet.confidence.padEnd(13)} `
                + `${story.topic.padEnd(19)} ${story.sourceName.padEnd(22)} ${story.title.slice(0, 56)}`);
            log(`     facts=${sheet.key_facts.length} quotes=${sheet.quotes.length} corroborators=${sheet.corroborating_sources.length}`);
        });
        log('');
        log(`would compose ${Math.min(sheets.length, OPTIONS.target)} articles. No LLM calls made, nothing uploaded.`);
        return;
    }

    log(`composing ${sheets.length} articles${OPTIONS.batch ? ' via Batches' : ''}...`);
    const recentTitles = (await loadRecentlyPublished(date, 2)).map(a => a.title).filter(Boolean);
    const composed = OPTIONS.batch
        ? await composeBatched(sheets, recentTitles, remaining)
        : await composeRealtime(sheets, recentTitles, remaining);
    log(`  composed ${composed.length}`);
    if (!composed.length) { log('nothing composed — stopping before upload'); return; }

    // Claim slugs by content hash, not by headline. Re-composing a story yields
    // a slightly different headline each time, so keying folders off the title
    // made a re-run mint a second folder and orphan the first.
    //
    // Slug uniqueness spans the whole retention window, not just today: article
    // URLs are the bare slug, so the same slug on two days would make that URL
    // ambiguous. `recentEntries` is the 14 days already loaded for dedupe.
    const existing = await News.readNewsDayIndex(date);
    const recentEntries = await loadRecentlyPublished(date);
    const claims = News.readSlugClaims(recentEntries);
    // Folder reuse is a same-day concern, so byHash comes from today only.
    claims.byHash = News.readSlugClaims(existing).byHash;

    const articles = composed.map((item) => {
        const slug = News.claimNewsSlug(item.fields.title, item.story.contentHash, claims);
        claims.bySlug.set(slug, item.story.contentHash);
        claims.byHash.set(item.story.contentHash, slug);
        return toArticle(item, slug, date);
    });

    // Belt and braces: two articles sharing a slug would also share derived
    // image ids, which is the one way images could ever be reused across
    // articles. Never publish that.
    const slugs = articles.map(a => a.slug);
    if (new Set(slugs).size !== slugs.length) {
        throw new Error(`duplicate slugs in one run: ${slugs.filter((s, i) => slugs.indexOf(s) !== i).join(', ')}`);
    }

    log(`publishing ${articles.length} articles to ${News.newsDayPrefix(date)}`);
    const byArticle = await publishAll(articles, date);

    // Rebuild the index from what is genuinely in R2, discarding whatever the
    // incremental upserts claimed. Self-healing regardless of what raced.
    //
    // The union matters: a top-up run only knows about the articles IT wrote,
    // so rebuilding from those alone would drop everything published earlier
    // today. Entries this run touched win; the rest carry forward.
    log('reconciling the day manifest against storage...');
    const thisRun = [...byArticle.values()].map(({ article, images }) =>
        News.buildIndexEntry(article, { images, date }));
    const touched = new Set(thisRun.map(e => e.slug));
    const carried = (existing?.articles || []).filter(e => !touched.has(e.slug));
    await News.rewriteNewsDayIndex([...carried, ...thisRun], { date });

    const manifest = await News.readNewsDayIndex(date);
    const published = (manifest?.articles || []).filter(a => a.status === 'published');
    await News.upsertNewsLatest({ date, count: published.length });
    await News.upsertNewsSlugIndex(manifest?.articles || [], { date });

    // Count images over the PUBLISHED subset only. Counting across the whole
    // manifest lets drafts inflate the total past `published`, which drove
    // missingImages negative and reported a clean run as "partial".
    const withImages = published.filter(a => a.image_status === 'generated').length;
    const missingImages = published.length - withImages;
    const drafts = (manifest?.articles || []).length - published.length;
    log('');
    log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
    log(`  ${manifest?.articles?.length || 0} in the manifest, ${published.length} published, ${withImages} with a full image set`);
    if (drafts > 0) log(`  ${drafts} held as draft (sourcing too thin to lead with, or images pending)`);
    if (shortfall > 0) log(`  shortfall ${shortfall} against a target of ${OPTIONS.target}`);
    log(`  ${R2.cdnUrl(News.buildNewsDayIndexKey(date))}`);

    // "partial" means the next run still has work: articles missing images, or
    // meaningfully short of target. A handful held back as draft for thin
    // sourcing is the pipeline working as intended, not a fault, so allow a
    // small margin rather than flagging an otherwise clean night.
    const shortOfTarget = published.length < Math.floor(OPTIONS.target * 0.9);
    const status = (!missingImages && !shortOfTarget) ? 'ok' : 'partial';
    await reportStatus({
        status,
        date: day,
        started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(),
        duration_min: Number(((Date.now() - started) / 60000).toFixed(1)),
        host: os.hostname(),
        target: OPTIONS.target,
        published: published.length,
        composed: composed.length,
        with_full_images: withImages,
        missing_images: missingImages,
        shortfall,
        index_url: R2.cdnUrl(News.buildNewsDayIndexKey(date)),
    });
}

if (require.main === module) {
    let held = false;
    try {
        acquireLock();
        held = true;
    } catch (e) {
        console.error(`[publish-daily-news] ${e.message}`);
        process.exit(2);
    }
    const release = () => { if (held) { releaseLock(); held = false; } };
    process.on('SIGINT', () => { release(); process.exit(130); });
    process.on('SIGTERM', () => { release(); process.exit(143); });

    const startedAt = new Date();
    main()
        .then(() => { pruneLogs(); release(); process.exit(0); })
        .catch(async (e) => {
            log(`FAILED: ${e.message}`);
            if (e.stack) log(e.stack.split('\n').slice(1, 4).join('\n'));
            // Record the failure where a monitor can see it, then exit non-zero
            // so Task Scheduler's last-result also reflects it.
            await reportStatus({
                status: 'failed',
                date: OPTIONS.date || R2.pstDateString(),
                started_at: startedAt.toISOString(),
                finished_at: new Date().toISOString(),
                duration_min: Number(((Date.now() - startedAt.getTime()) / 60000).toFixed(1)),
                host: os.hostname(),
                target: OPTIONS.target,
                published: 0,
                error: e.message.slice(0, 300),
            }).catch(() => {});
            pruneLogs();
            release();
            process.exit(1);
        });
}

module.exports = { main, selectStories, buildFactSheets, toArticle, OPTIONS };

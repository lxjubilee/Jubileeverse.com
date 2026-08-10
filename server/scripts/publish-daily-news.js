#!/usr/bin/env node
'use strict';
/**
 * publish-daily-news.js — The daily faith-based news pipeline.
 *
 *   harvest  ~60 RSS feeds -> score -> dedupe -> quota-allocate to the target
 *   facts    fetch each source page -> JSON-LD / OG / <p> -> numbered fact sheet
 *   compose  ONE Claude call per article -> 8 fields
 *   images   download the outlet's own photograph -> validate -> 1600x900 WebP
 *   publish  image -> article.md -> day index.json -> latest.json  (to R2)
 *
 * The pictures were three FLUX renders per article until the sourcing switch.
 * They are now the photograph the originating outlet ran with the story: for
 * news that is simply the better picture — it shows the real place and the real
 * people, and cannot invent a building that was never there — and it costs a
 * download rather than an hour of GPU time. Resolution, validation and
 * normalisation all live in lib/news-image-source.js.
 *
 * Usage:
 *   node scripts/publish-daily-news.js --dry-run
 *   node scripts/publish-daily-news.js --target 60 --max-new 15
 *   node scripts/publish-daily-news.js --date 2026-07-31 --force
 *
 * Flags:
 *   --dry-run        harvest, dedupe, fact-extract and resolve image URLs.
 *                    No LLM call, no download, no upload.
 *   --target N       articles for the DAY (default 60, or NEWS_TARGET)
 *   --max-new N      cap on NEW articles for this run (default: the target)
 *   --date YYYY-MM-DD  publish into a specific PST day folder
 *   --force          re-upload even when R2 already has identical bytes
 *   --no-images      compose and publish text only
 *   --batch          submit composition through the Batches API (half price)
 *   --repair         rebuild the day manifest from the objects in R2, then stop
 *   --to-webp        re-encode the day's published PNGs as WebP, then stop
 *   --prune a,b,c    delete those article folders from the day (needs --yes)
 *   --deadline M     abandon remaining work after M minutes
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
const ImageSource = require('../lib/news-image-source');

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
 * Was 3 minutes with a 90 minute floor, sized for three GPU renders and a
 * safety scan per article — the 2026-08-02 run spent 112 minutes on images
 * alone and still abandoned a wave. A run is now bound by the compose calls;
 * the picture is one HTTP download. A minute per article with a 30 minute floor
 * is generous against that, and the smaller number matters twice over: the
 * stale-lock threshold is derived from it, so an oversized deadline meant a
 * crashed run held the lock for three hours and blocked its successor.
 */
const DEADLINE_MIN_PER_ARTICLE = 1;
const DEADLINE_FLOOR_MIN = 30;

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
    // Per-RUN cap, distinct from the per-DAY target. Defaults to the target so
    // a single-run day behaves exactly as it always has.
    maxNew: Number(arg('max-new', process.env.NEWS_MAX_NEW || TARGET)),
    date: arg('date', null),
    deadlineMin: Number(
        arg('deadline', Math.max(DEADLINE_FLOOR_MIN, TARGET * DEADLINE_MIN_PER_ARTICLE)),
    ),
    concurrency: Number(arg('concurrency', 3)),
};

// Images no longer touch the disk. They were staged to local temp only so the
// NudeNet folder-scanner could read them, and that scan existed because a
// generative model can produce anything; a photograph already published on an
// outlet's own front page is a different risk class. Buffer straight to R2.
const LOCK_FILE = path.join(__dirname, '..', '.tmp', 'news-publish.lock');

const LOG_DIR = path.join(__dirname, '..', 'logs', 'news');

// Floor for "is this a real image object". Shared with the publish layer on
// purpose: two independently-chosen floors meant an image could clear the one
// that let it upload and fail the one that put it in the manifest, which reads
// as an article mysteriously holding itself back as a draft.
const MIN_IMAGE_BYTES = News.MIN_IMAGE_BYTES;

/**
 * A key under a day prefix that belongs to a translation rather than to the
 * article itself — `hi-IN/<slug>/article.md`. Language codes are the only
 * segment here carrying an uppercase region, which is what keeps this from
 * matching an article slug.
 */
const TRANSLATION_KEY = /^[a-z]{2,3}-[A-Z]{2}\//;

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
    const stages = {};
    for (const story of stories) {
        const sheet = await Facts.buildFactSheet(story, { allCandidates, logger: { log() {}, warn() {} } });
        // Corroborators found during the same-event collapse are already
        // attached to the candidate; merge them in.
        if (story.corroborators?.length) {
            const seen = new Set(sheet.corroborating_sources.map(c => c.url));
            sheet.corroborating_sources.push(...story.corroborators.filter(c => !seen.has(c.url)));
        }
        tally[sheet.confidence]++;

        // Resolve the picture HERE, where the source page HTML is already in
        // hand. Doing it later would mean fetching every outlet a second time
        // for something we were holding and discarded.
        const picks = ImageSource.resolveImageCandidates(story, sheet);
        const pick = picks[0] || { url: null, stage: 'none' };
        stages[pick.stage] = (stages[pick.stage] || 0) + 1;

        out.push({ story, sheet, imagePick: pick, imagePicks: picks });
    }
    log(`  confidence: ${JSON.stringify(tally)}`);
    log(`  image candidates: ${JSON.stringify(stages)}`);
    return out;
}

/**
 * Put the stories we can illustrate in front of the ones we cannot.
 *
 * An article with no picture is held back as a draft, so composing one spends
 * an Opus call on something the reader will never see. This does not DROP the
 * imageless stories — a resolvable URL is not a guarantee the bytes are usable,
 * so they stay in the list as fallback behind the reserve.
 *
 * Deliberately a stable partition rather than a re-sort: the quota allocation
 * upstream already balanced topics, and re-scoring here would undo that.
 */
function preferIllustratable(sheets) {
    const withImage = sheets.filter(s => s.imagePick?.url);
    const without = sheets.filter(s => !s.imagePick?.url);
    if (without.length) {
        log(`  ${withImage.length} with a picture, ${without.length} without (held behind the reserve)`);
    }
    return [...withImage, ...without];
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

    // Slots are claimed BEFORE the call, not counted after it.
    //
    // Counting completions instead let every in-flight worker finish past the
    // limit: at a concurrency of 3 a cap of 15 produced 17 articles, and all 17
    // published. That is two Opus calls nobody asked for and two articles over
    // the run's quota, every run. A failed composition hands its slot back, so
    // the target is still reached when some calls fail.
    let claimed = 0;

    const worker = async () => {
        for (;;) {
            if (claimed >= target) return;
            const item = sheets[cursor++];
            if (!item) return;
            claimed++;
            try {
                attempted++;
                const r = await Composer.composeArticle(composeInput(item, recentTitles));
                results.push({ ...item, fields: r.fields, usage: r.usage });
                log(`  [${results.filter(x => x.fields).length}/${target}] ${r.fields.title.slice(0, 62)}`);
            } catch (e) {
                claimed--;
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
    // Belt and braces: the claim counter makes an overshoot impossible, and
    // this makes it un-publishable if it ever happens anyway.
    return results.filter(r => r.fields).slice(0, target);
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
function toArticle({ story, sheet, fields, imagePick, imagePicks }, slug, date) {
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
        // Where the picture comes from, carried so the publish step does not
        // have to re-derive it and so the manifest can record the provenance.
        // The list, not just the head: a feed thumbnail that fails the size
        // gate must not cost the article a picture the source page is serving.
        image_pick: imagePick || { url: null, stage: 'none' },
        image_picks: imagePicks || (imagePick?.url ? [imagePick] : []),
        // The outlet gets the credit for its own photograph. Stored on the
        // article rather than rendered — see the note in buildIndexEntry.
        image_credit: sheet.source_name || '',
        // headline-only stories are held back from the feed: thin sourcing is
        // not something to lead with.
        status: sheet.confidence === 'headline_only' ? 'draft' : 'published',
    };
}

/**
 * Hold an article back when no usable picture could be sourced.
 *
 * Drafting reuses the mechanism that already holds back thin-sourced stories,
 * so nothing new appears on the reader's side: the article simply does not
 * enter the feed. The text is still written and still published, so a later run
 * that resolves a picture can promote it without recomposing anything.
 */
function draftForMissingImage(byArticle, drafted, article, reason) {
    drafted.add(article.slug);
    const record = byArticle.get(article.slug);
    if (!record || record.article.status === 'draft') return;
    record.article.status = 'draft';
    record.article.image_status = 'pending';
    log(`  ${article.slug} -> draft (${reason})`);
}

/**
 * Per-run tally of where pictures came from and why they were refused.
 *
 * Reported at the end and published to status.json, because "how many articles
 * got a real photograph, and what stopped the rest" is the one number that says
 * whether this pipeline is working. A silent drop rate is how you discover six
 * weeks later that one outlet has been serving its logo the whole time.
 */
function createSourcingReport() {
    const stages = {};
    const rejects = {};
    return {
        accepted(stage) { stages[stage] = (stages[stage] || 0) + 1; },
        rejected(reason) {
            const key = String(reason || 'unknown').replace(/\(.*/, '').trim().slice(0, 40);
            rejects[key] = (rejects[key] || 0) + 1;
        },
        stages: () => stages,
        rejects: () => rejects,
        total() { return Object.values(stages).reduce((a, b) => a + b, 0); },
    };
}

/**
 * Source, validate, and upload one picture per article, then publish.
 *
 * Replaces the three-wave GPU render loop. There is no wave structure left to
 * have: one image per article, and a download that takes a second rather than
 * a render that takes a minute, so everything runs in one bounded pass.
 *
 * Concurrency is per-host rather than global. Sixty articles a day already puts
 * real load on a handful of outlets, and firing every download at once is how a
 * publisher decides to start refusing us.
 */
async function publishAll(articles, date) {
    const byArticle = new Map(articles.map(a => [a.slug, { article: a, images: [] }]));
    const drafted = new Set();
    const report = createSourcingReport();

    if (OPTIONS.noImages) {
        log('--no-images: publishing text only');
        await publishWave(byArticle, date);
        return byArticle;
    }

    const deadline = Date.now() + OPTIONS.deadlineMin * 60000;
    const tracker = ImageSource.createImageTracker({ denylist: await loadImageDenylist() });

    log(`sourcing ${articles.length} image(s) from the original outlets`);

    // Serialise per host, run distinct hosts in parallel. A story's picture
    // nearly always lives on the outlet's own CDN, so this naturally spreads
    // the work while never hammering one publisher.
    const byHost = new Map();
    for (const article of articles) {
        const url = article.image_pick?.url;
        if (!url) {
            report.rejected('no image url');
            draftForMissingImage(byArticle, drafted, article, 'no image url on the feed item or source page');
            continue;
        }
        const host = hostOf(url);
        if (!byHost.has(host)) byHost.set(host, []);
        byHost.get(host).push(article);
    }

    await Promise.all([...byHost.values()].map(async (queue) => {
        for (const article of queue) {
            if (Date.now() > deadline) {
                log(`  deadline reached — ${article.slug} keeps its text and waits for the next run`);
                draftForMissingImage(byArticle, drafted, article, 'deadline');
                continue;
            }
            try {
                const image = await sourceOneImage(article, date, tracker, report);
                if (image) byArticle.get(article.slug).images.push(image);
                else draftForMissingImage(byArticle, drafted, article, 'no usable picture');
            } catch (e) {
                report.rejected(e.message);
                log(`  ${article.slug}: ${e.message.slice(0, 90)}`);
                draftForMissingImage(byArticle, drafted, article, 'image fetch failed');
            }
        }
    }));

    await publishWave(byArticle, date);

    const repeats = tracker.repeats();
    if (repeats.length) {
        log(`  ${repeats.length} image url(s) claimed by more than one article — house images, most likely:`);
        for (const url of repeats.slice(0, 5)) log(`    ${url.slice(0, 110)}`);
    }

    log(`images: ${report.total()}/${articles.length} sourced ${JSON.stringify(report.stages())}`);
    if (Object.keys(report.rejects()).length) log(`  refused: ${JSON.stringify(report.rejects())}`);
    if (drafted.size) log(`drafted for want of a picture: ${drafted.size}`);

    return byArticle;
}

/** Hostname, or '' — the key the per-host queues are built on. */
function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * Outlets caught serving one house image across many stories.
 *
 * Persisted to R2 rather than kept in memory so the finding compounds: an
 * outlet identified on Monday is refused on Tuesday without spending the
 * downloads to rediscover it. Best effort — a missing file is not a failure.
 */
async function loadImageDenylist() {
    try {
        const list = await R2.getObjectJson(`${News.NEWS_PREFIX}/_image-denylist.json`);
        return Array.isArray(list?.urls) ? list.urls : [];
    } catch {
        return [];
    }
}

/**
 * Download, validate, normalize and upload one article's picture.
 *
 * @returns {Promise<object|null>} the manifest image record, or null with the
 *   reason already recorded in the report.
 */
async function sourceOneImage(article, date, tracker, report) {
    const picks = article.image_picks?.length
        ? article.image_picks
        : [article.image_pick].filter(p => p?.url);
    if (!picks.length) return null;

    const imageId = Images.mintImageId(article.articleId, 1, Images.SOURCED_SALT);
    const key = News.buildNewsImageKey(article, imageId, date);

    // Skip-if-present. A re-run after a crash costs one HEAD per article
    // instead of re-downloading from every outlet we already asked.
    if (!OPTIONS.force) {
        const existing = await R2.headObject(key);
        if (existing && existing.size > News.MIN_IMAGE_BYTES) {
            report.accepted(picks[0].stage);
            return {
                n: 1, role: 'hero', url: R2.cdnUrl(key), safety: 'previously-cleared',
                source_url: picks[0].url, stage: picks[0].stage, credit: article.image_credit || '',
            };
        }
    }

    // Walk the candidates. A thumbnail in the feed must not cost the article
    // the full-size picture the source page is serving.
    let lastReason = 'no candidate url';
    for (const pick of picks) {
        const claim = tracker.claim(pick.url);
        if (!claim.ok) { lastReason = claim.reason; continue; }

        let buffer;
        let contentType;
        try {
            ({ buffer, contentType } = await ImageSource.fetchImage(pick.url));
        } catch (e) {
            lastReason = e.message;
            continue;
        }

        const verdict = await ImageSource.validateSourcedImage(buffer, { contentType, url: pick.url });
        if (!verdict.ok) {
            lastReason = verdict.reason;
            log(`  ${article.slug}: ${pick.stage} rejected — ${verdict.reason}`
                + (picks.indexOf(pick) < picks.length - 1 ? ', trying the next candidate' : ''));
            continue;
        }

        const hash = await ImageSource.imageHash(buffer);
        const dup = tracker.claimHash(hash);
        if (!dup.ok) { lastReason = dup.reason; continue; }

        const webp = await ImageSource.normalizeSourcedImage(buffer);
        const up = await News.publishNewsImage(article, {
            imageId, buffer: webp, n: 1, date, force: OPTIONS.force,
        });

        report.accepted(pick.stage);
        return {
            n: 1,
            role: 'hero',
            url: up.url,
            safety: 'sourced',
            // Provenance, carried into the manifest: which outlet's picture
            // this is, where it came from, and how we found it.
            source_url: pick.url,
            stage: pick.stage,
            credit: article.image_credit || '',
            phash: hash,
            original_width: verdict.meta?.width ?? null,
            original_height: verdict.meta?.height ?? null,
            entropy: await ImageSource.imageEntropy(buffer),
        };
    }

    report.rejected(lastReason);
    log(`  ${article.slug}: no usable picture from ${picks.length} candidate(s) — ${lastReason}`);
    return null;
}

/**
 * Patch a published article.md to match a picture that arrived after it.
 *
 * The manifest and the frontmatter are two records of the same facts, and a
 * rebuild reads the frontmatter. Updating only the manifest looks like it
 * works — the article appears on the site immediately — and is then silently
 * undone by the next `--repair`, which is exactly what happened the first time
 * this path filled six articles in.
 *
 * A targeted patch rather than a re-render: rebuilding the markdown needs the
 * composed fields, and those exist only at compose time.
 */
async function patchPublishedMarkdown(prefix, entry, image, { promote }) {
    const key = `${prefix}${entry.file}`;
    const raw = await R2.getObjectText(key);
    if (!raw) return false;

    const file = image.url.split('/').pop();
    const setField = (text, field, value) => (
        new RegExp(`^${field}:.*$`, 'm').test(text)
            ? text.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`)
            : text.replace(/^(image_file:.*)$/m, `$1\n${field}: ${value}`)
    );

    let next = raw;
    next = setField(next, 'image_file', `images/${file}`);
    next = setField(next, 'image_status', 'generated');
    next = setField(next, 'image_source_url', image.source_url || '');
    next = setField(next, 'image_stage', image.stage || '');
    next = setField(next, 'image_credit', `"${String(image.credit || '').replace(/"/g, '\\"')}"`);
    if (promote) next = setField(next, 'status', 'published');

    // Put the hero back in the body if it was written without one. The reader
    // strips body images anyway, but the file is also the human-readable record
    // of what was published.
    if (!/!\[[^\]]*\]\([^)]*\/images\//.test(next)) {
        next = next.replace(/\n---\n\n/, `\n---\n\n![${(entry.title || '').replace(/[[\]]/g, '')}](${image.url})\n\n`);
    }

    if (next === raw) return false;
    await R2.putObject({
        key,
        body: next,
        contentType: 'text/markdown; charset=utf-8',
        cacheControl: 'public, max-age=300',
        metadata: { article_slug: entry.slug, topic: entry.topic || '' },
    });
    return true;
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
 * Fill in pictures for articles already published today.
 *
 * This is what a later run of the day does once the article target is met: no
 * new stories, no model calls, just the pictures an earlier run could not get
 * because the outlet was slow, the deadline hit, or the download failed. It
 * re-resolves from the stored `source_url` — the outlet is still the only place
 * the right photograph exists, and asking it again is the whole job.
 *
 * It emphatically does NOT generate anything. This function used to call the
 * GPU directly, bypassing every gate, and paired with an hourly trigger it
 * would quietly re-illustrate the entire corpus with renders once the
 * expectation dropped to one image.
 */
async function backfillImages(manifest, date) {
    const pending = (manifest?.articles || [])
        .filter(a => (a.images?.length ?? 0) < News.EXPECTED_IMAGES);
    if (!pending.length) { log('  every article already has its picture'); return; }
    if (OPTIONS.noImages) { log('  --no-images: leaving them for the next run'); return; }

    log(`  ${pending.length} article(s) without a picture`);
    const tracker = ImageSource.createImageTracker({ denylist: await loadImageDenylist() });
    const report = createSourcingReport();
    let filled = 0;

    for (const entry of pending) {
        if (!entry.source_url) { log(`  ${entry.slug}: no source url recorded`); continue; }

        const article = {
            slug: entry.slug,
            articleId: entry.id,
            title: entry.title,
            topic: entry.topic,
            image_set_id: entry.image_set_id,
            image_credit: entry.source_name || '',
            image_picks: [],
        };

        try {
            // Re-fetch the source page and re-run the ladder. The fact sheet is
            // long gone, so this rebuilds just enough of one to resolve a URL.
            const html = await Facts.fetchSourcePage(entry.source_url);
            const meta = html ? Facts.extractMetaFacts(html) : null;
            const ld = html ? Facts.extractJsonLdNewsArticle(html) : null;
            article.image_picks = ImageSource.resolveImageCandidates({}, {
                source_url: entry.source_url,
                image: Facts.absoluteUrl(meta?.image || ld?.image || '', entry.source_url),
                image_stage: meta?.image ? 'og' : (ld?.image ? 'jsonld' : ''),
            });

            if (!article.image_picks.length) { log(`  ${entry.slug}: still no picture at the source`); continue; }

            const image = await sourceOneImage(article, date, tracker, report);
            if (!image) continue;

            // Manifest shape, not the publish shape: entries carry `file`
            // relative to the day prefix, and rewriteNewsDayIndex checks that
            // path against storage before it will keep the image.
            const file = `${entry.slug}/images/${image.url.split('/').pop()}`;
            entry.images = [{
                n: 1,
                role: 'hero',
                id: image.url.split('/').pop().replace(/\.(webp|png)$/, ''),
                file,
                safety: image.safety,
                image_source_url: image.source_url,
                image_stage: image.stage,
                image_credit: image.credit,
                image_phash: image.phash,
            }];
            entry.image_file = file;
            entry.image_status = 'generated';
            // Mirror the provenance to the top level the way buildIndexEntry
            // does. rewriteNewsDayIndex spreads the entry as-is, so setting it
            // only inside images[] leaves the manifest reporting an unknown
            // source for every article this path filled in.
            entry.image_source_url = image.source_url;
            entry.image_stage = image.stage;
            entry.image_credit = image.credit;

            // Promote out of draft — but only if the picture was the ONLY thing
            // holding it back. A headline-only story is thin sourcing, and no
            // photograph changes that.
            const promote = entry.status === 'draft' && entry.fact_confidence !== 'headline_only';
            if (promote) entry.status = 'published';

            // The markdown has to agree, or the next repair reverts all of this.
            await patchPublishedMarkdown(News.newsDayPrefix(date), entry, image, { promote });

            filled++;
            log(`  filled ${entry.slug} (${image.stage})`);
        } catch (e) {
            log(`  ${entry.slug}: ${e.message.slice(0, 80)}`);
        }
    }

    log(`  filled ${filled}/${pending.length}`);
    Facts.clearPageCache();

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
    // Translations live under the same day prefix, at `<lang>/<slug>/…`, and
    // counting them here would make this number mean something other than "how
    // many objects belong to the articles being repaired".
    const articleKeys = [...keys.keys()].filter(k => !TRANSLATION_KEY.test(`${k.slice(prefix.length)}`));
    log(`repairing ${prefix} from ${articleKeys.length} objects`);

    const bySlug = new Map();
    for (const [key, size] of keys) {
        // Accept either extension: images published before the WebP switch are
        // still .png, and a rebuild must not orphan them.
        //
        // Translation keys cannot reach the branches below and no change is
        // needed for them, but that is load-bearing rather than incidental: a
        // translation is `<lang>/<slug>/article.md`, so `[^/]+` captures the
        // language and the remainder still holds a slash, which neither
        // alternative accepts. Widen this pattern and `hi-IN` starts being
        // published as an article.
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

        // Match each stored image back to its slot, so ordering comes from the
        // match and never from key sort order. Deliberately NOT bare derivation:
        // see matchStoredImages for what that costs.
        const images = Images.matchStoredImages(articleId, rec.images, {
            imageFile: fm.image_file || '',
            expected: News.EXPECTED_IMAGES,
        }).map(m => ({
            n: m.n,
            role: m.role,
            url: R2.cdnUrl(`${prefix}${rec.slug}/images/${m.id}.${m.ext}`),
            // Provenance is in the frontmatter precisely so a rebuild from
            // storage keeps it. Dropping it here would quietly strip the
            // record of whose photograph this is from every article the repair
            // touched — which is the one field a takedown request needs.
            credit: fm.image_credit || '',
            source_url: fm.image_source_url || '',
            stage: fm.image_stage || (fm.image_source_url ? 'sourced' : ''),
        }));

        // Loud, because the consequence is an article dropping out of the feed.
        if (!images.length && rec.images.size) {
            log(`  WARN ${rec.slug}: ${rec.images.size} image object(s) present but none could be`
                + ' matched to a slot — the article will be held as a draft');
        }

        // A draft with a picture is a story that was held back for want of one
        // and has since got it. Pinning it to draft because that is what the
        // frontmatter said when it was written makes the repair destructive
        // rather than self-healing: a later run fills the image in, and the
        // next repair takes the article straight back off the site.
        //
        // Thin sourcing is the one reason a picture cannot undo, so
        // headline_only stays exactly where it is.
        const heldBackOnly = fm.status === 'draft'
            && images.length
            && fm.fact_confidence !== 'headline_only';
        if (heldBackOnly) {
            log(`  ${rec.slug}: promoting — held as a draft but has a picture now`);
            // Correct the frontmatter too, or every future repair re-derives
            // the same promotion from the same stale record. Making the file
            // agree is what stops the drift, rather than compensating for it
            // on each pass.
            await patchPublishedMarkdown(
                prefix,
                { file: `${rec.slug}/article.md`, slug: rec.slug, title: fm.title, topic: fm.topic },
                images[0],
                { promote: true },
            );
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
            image_credit: fm.image_credit || '',
            status: (fm.status === 'draft' && !heldBackOnly) ? 'draft' : 'published',
        }, { images, date }));

        log(`  ${rec.slug}: ${images.length}/${News.EXPECTED_IMAGES} images`);
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

    // One listing for the day, shared across every slug. Each article's keys are
    // then picked out of it by News.listNewsArticleKeys, which takes the
    // translated copies under `<lang>/<slug>/` as well as the English folder —
    // so the preview printed below is honest about everything that goes, which
    // is the entire safety story of this function.
    const dayKeys = await R2.listPrefix(prefix);

    let total = 0;
    const plan = [];
    for (const slug of slugs) {
        const keys = await News.listNewsArticleKeys(slug, date, dayKeys);
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
    const toTarget = Math.max(0, OPTIONS.target - alreadyPublished);

    // Two separate limits, because the day target alone cannot express a
    // schedule. Four runs a day at `--target 15` publishes 15 and then three
    // runs find the target met and do nothing; `--target 60` four times has no
    // per-run cap at all and the first run tries to do the whole day.
    const remaining = Math.min(OPTIONS.maxNew, toTarget);
    if (alreadyPublished) {
        log(`already published today: ${alreadyPublished}/${OPTIONS.target} — ${toTarget} to go`);
    }
    if (remaining < toTarget) {
        log(`this run is capped at ${OPTIONS.maxNew} new article(s)`);
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
            max_new: OPTIONS.maxNew,
            published: pub.length,
            composed: 0,
            with_images: full,
            missing_images: pub.length - full,
            shortfall: 0,
            index_url: R2.cdnUrl(News.buildNewsDayIndexKey(date)),
        });
        return;
    }

    const { selected, all, shortfall } = await selectStories(date, remaining || OPTIONS.target);
    if (!selected.length) { log('no stories to publish today'); return; }

    const sheets = preferIllustratable(await buildFactSheets(selected, all));

    if (OPTIONS.dryRun) {
        log('');
        log('DRY RUN — selected stories:');
        sheets.forEach(({ story, sheet, imagePick }, i) => {
            log(`${String(i + 1).padStart(3)}. [${String(story.score.total).padStart(3)}] ${sheet.confidence.padEnd(13)} `
                + `${story.topic.padEnd(19)} ${story.sourceName.padEnd(22)} ${story.title.slice(0, 56)}`);
            log(`     facts=${sheet.key_facts.length} quotes=${sheet.quotes.length} `
                + `corroborators=${sheet.corroborating_sources.length} `
                + `image=${imagePick.stage}${imagePick.url ? ` ${imagePick.url.slice(0, 70)}` : ''}`);
        });

        // The number that decides whether this design pays for itself: every
        // story we cannot illustrate is an Opus call spent on an article that
        // publishes as a draft nobody sees.
        const stages = {};
        for (const s of sheets) stages[s.imagePick.stage] = (stages[s.imagePick.stage] || 0) + 1;
        const withImage = sheets.filter(s => s.imagePick.url).length;
        const rate = sheets.length ? Math.round((100 * withImage) / sheets.length) : 0;
        log('');
        log(`image URL resolution: ${withImage}/${sheets.length} (${rate}%) ${JSON.stringify(stages)}`);
        log(`would compose ${Math.min(sheets.length, remaining || OPTIONS.target)} articles. `
            + 'No LLM calls made, nothing downloaded, nothing uploaded.');
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

    // Where the day's pictures came from. `with_full_images` alone stopped
    // being a signal once an article carried one image: it is now either 0 or
    // the whole published count, and says nothing about whether the sourcing
    // ladder is still reaching the outlets it used to.
    const byStage = {};
    for (const a of published) {
        if (a.image_status !== 'generated') continue;
        const stage = a.image_stage || 'unknown';
        byStage[stage] = (byStage[stage] || 0) + 1;
    }

    log('');
    log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
    log(`  ${manifest?.articles?.length || 0} in the manifest, ${published.length} published, ${withImages} with a picture`);
    if (withImages) log(`  image sources: ${JSON.stringify(byStage)}`);
    if (drafts > 0) log(`  ${drafts} held as draft (sourcing too thin to lead with, or no picture found)`);
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
        max_new: OPTIONS.maxNew,
        published: published.length,
        composed: composed.length,
        with_images: withImages,
        images_by_stage: byStage,
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

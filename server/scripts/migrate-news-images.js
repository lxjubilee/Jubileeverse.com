#!/usr/bin/env node
'use strict';
/**
 * migrate-news-images.js — Replace every generated news image with the
 * photograph the originating outlet published.
 *
 * The daily pipeline now sources its pictures. This is the one-off pass over
 * everything published before it did.
 *
 * The rule is absolute and was chosen deliberately: no generated image survives
 * on a news article. Where the original cannot be recovered — after the source
 * page, the Wayback snapshot, and another syndicated outlet's coverage have all
 * been tried — the article is UNPUBLISHED rather than left illustrated with a
 * render. That is a real cost, and it is why nothing here happens without being
 * planned, reviewed and confirmed first.
 *
 *   --plan            resolve everything, write a report and a contact sheet,
 *                     change NOTHING. Safe to run repeatedly.
 *   --apply --yes     execute the plan. Archives every image it replaces.
 *   --rollback FILE   put a report's archived images back.
 *
 * Ordering within --apply is not negotiable:
 *   snapshot manifests -> archive old image -> upload new -> repoint markdown
 *   -> rewrite manifest -> delete old image
 * The delete comes last because everything before it is recoverable and it is
 * not.
 *
 * Usage:
 *   node scripts/migrate-news-images.js --plan
 *   node scripts/migrate-news-images.js --plan --days 30 --limit 5
 *   node scripts/migrate-news-images.js --apply --yes
 *   node scripts/migrate-news-images.js --rollback logs/news/migration-....json
 */

const fs = require('fs');
const path = require('path');

loadDotEnv();

const R2 = require('../lib/r2-client');
const News = require('../lib/r2-news');
const Images = require('../lib/news-images');
const Facts = require('../lib/source-facts');
const Recover = require('../lib/news-image-recover');

// ── Args ─────────────────────────────────────────────────────────────────────

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const next = process.argv[i + 1];
    return (!next || next.startsWith('--')) ? true : next;
}
const has = (name) => process.argv.includes(`--${name}`);

function loadDotEnv() {
    const file = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(file)) return;
    // server/.env carries a UTF-8 BOM, which would corrupt the first key name.
    for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && process.env[m[1]] === undefined) {
            process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
    }
}

const OPTIONS = {
    plan: has('plan'),
    apply: has('apply'),
    yes: has('yes'),
    rollback: arg('rollback', null),
    days: Number(arg('days', 60)),
    limit: Number(arg('limit', 0)),
    slug: arg('slug', null),
    noWayback: has('no-wayback'),
    noCorroborate: has('no-corroborate'),
};

const OUT_DIR = path.join(__dirname, '..', 'logs', 'news');
const ARCHIVE_PREFIX = `${News.NEWS_PREFIX}/_archive`;
const BACKUP_PREFIX = `${News.NEWS_PREFIX}/_backup`;

/** Politeness: never more than one request in flight to the same host. */
const PER_HOST_DELAY_MS = 1200;
const _lastHit = new Map();

async function politeDelay(url) {
    let host;
    try { host = new URL(url).hostname; } catch { return; }
    const since = Date.now() - (_lastHit.get(host) || 0);
    if (since < PER_HOST_DELAY_MS) await sleep(PER_HOST_DELAY_MS - since);
    _lastHit.set(host, Date.now());
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const lines = [];
function log(m) {
    console.log(m);
    lines.push(m);
}

// ── Discovery ────────────────────────────────────────────────────────────────

/**
 * Every article in the retention window, with the day it lives in.
 *
 * Read from `latest.json` rather than by walking the bucket: it is the same
 * index the site uses, so an article invisible to it is already invisible to
 * readers and migrating it would be pointless work.
 */
async function collectArticles() {
    const latest = await R2.getObjectJson(News.NEWS_LATEST_KEY);
    const days = (latest?.days || []).slice(0, OPTIONS.days);
    if (!days.length) { log('latest.json lists no days — nothing to migrate'); return []; }

    const out = [];
    for (const day of days) {
        const date = R2.dateFromPstString(day.date);
        const manifest = await News.readNewsDayIndex(date);
        for (const entry of manifest?.articles || []) {
            if (OPTIONS.slug && entry.slug !== OPTIONS.slug) continue;
            out.push({ day: day.date, date, entry });
        }
    }
    return OPTIONS.limit ? out.slice(0, OPTIONS.limit) : out;
}

/**
 * Has this article already been migrated?
 *
 * A sourced image records where it came from. Anything carrying that is done,
 * and re-running must not spend a download rediscovering it — this is what
 * makes the migration resumable after a crash.
 */
function alreadySourced(entry) {
    if (entry.image_source_url) return true;
    return (entry.images || []).some(i => i.image_source_url || i.safety === 'sourced');
}

// ── Planning ─────────────────────────────────────────────────────────────────

/**
 * Validated bytes from the planning pass, keyed `day/slug`.
 *
 * Held in memory rather than in the report, for two reasons. The obvious one is
 * that re-downloading ninety images doubles what we ask of the outlets for
 * nothing. The subtler one is that it removes a window: between planning and
 * applying, an outlet can swap its lead image, and re-fetching would publish a
 * picture nobody reviewed on the contact sheet. What was approved is what ships.
 *
 * A plan loaded from disk on a later run finds this empty and falls back to
 * fetching, which is correct — those bytes are genuinely gone.
 */
const _prepared = new Map();
const preparedKey = (day, slug) => `${day}/${slug}`;

async function planOne({ day, entry }, hosts, index, total) {
    const label = `[${String(index + 1).padStart(3)}/${total}] ${day} ${entry.slug}`;

    if (alreadySourced(entry)) {
        log(`${label}\n      SKIP already sourced`);
        return { day, slug: entry.slug, action: 'skip', reason: 'already sourced' };
    }

    if (entry.source_url) await politeDelay(entry.source_url);

    const found = await Recover.recoverImage(entry, {
        hosts,
        useWayback: !OPTIONS.noWayback,
        useCorroboration: !OPTIONS.noCorroborate,
        logger: { log: (m) => log(`      ${m}`) },
    });

    if (!found.url) {
        log(`${label}\n      UNPUBLISH no original found `
            + `(${found.attempts.map(a => `${a.rung}: ${a.reason}`).join('; ')})`);
        return {
            day, slug: entry.slug, action: 'unpublish',
            title: entry.title, source_url: entry.source_url || '',
            attempts: found.attempts,
            old_images: (entry.images || []).map(i => i.file),
        };
    }

    // recoverImage already downloaded and validated the winner, so the plan is
    // a promise the apply step can keep rather than a list of URLs that might
    // turn out to be logos.
    const prepared = found.prepared;
    _prepared.set(preparedKey(day, entry.slug), prepared);

    log(`${label}\n      REPLACE ${found.stage} ${prepared.meta.width}x${prepared.meta.height} `
        + `${found.url.slice(0, 90)}`);

    return {
        day,
        slug: entry.slug,
        action: 'replace',
        title: entry.title,
        source_url: entry.source_url || '',
        image_source_url: found.url,
        image_stage: found.stage,
        image_credit: entry.source_name || '',
        image_phash: prepared.phash,
        via: found.via || '',
        via_title: found.via_title || '',
        similarity: found.similarity ?? null,
        original_width: prepared.meta.width,
        original_height: prepared.meta.height,
        old_images: (entry.images || []).map(i => i.file),
        new_image_id: Images.mintImageId(entry.id || `${day}__${entry.slug}`, 1, Images.SOURCED_SALT),
    };
}

// ── Applying ─────────────────────────────────────────────────────────────────

/**
 * Copy the three index files aside before touching anything.
 *
 * These are the only thing standing between a bad run and an unrecoverable
 * corpus: article bytes can be rebuilt from a manifest, but a manifest cannot
 * be rebuilt from nothing.
 */
async function snapshotIndexes(stamp, days) {
    const keys = [News.NEWS_LATEST_KEY, News.NEWS_SLUGS_KEY, News.NEWS_STATUS_KEY];
    for (const day of days) keys.push(News.buildNewsDayIndexKey(R2.dateFromPstString(day)));

    let saved = 0;
    for (const key of keys) {
        const body = await R2.getObjectText(key);
        if (!body) continue;
        await R2.putObject({
            key: `${BACKUP_PREFIX}/${stamp}/${key}`,
            body,
            contentType: 'application/json; charset=utf-8',
            cacheControl: 'private, max-age=0',
        });
        saved++;
    }
    log(`snapshotted ${saved} index file(s) to ${BACKUP_PREFIX}/${stamp}/`);
}

/**
 * Copy an object aside. R2 has no CopyObject in our client, and at this volume
 * a read-then-write is simpler than adding one.
 */
async function archiveObject(key, stamp) {
    const buffer = await R2.getObjectBuffer(key);
    if (!buffer) return null;
    const dest = `${ARCHIVE_PREFIX}/${stamp}/${key}`;
    await R2.putObject({
        key: dest,
        body: buffer,
        contentType: News.IMAGE_CONTENT_TYPE,
        cacheControl: 'private, max-age=0',
    });
    return dest;
}

/**
 * Point a published article.md at the new image AND record where it came from.
 *
 * The provenance has to land in the frontmatter, not only the manifest.
 * `--repair` rebuilds the index from these files, so a field the markdown does
 * not carry is a field the next repair silently erases — which is exactly what
 * happened on the first pass: the pictures were right, and the record of whose
 * pictures they were vanished from 86 articles. That record is the only thing
 * a takedown request can be answered from.
 */
async function repointMarkdown(prefix, entry, newFile, provenance = {}) {
    const key = `${prefix}${entry.file}`;
    const raw = await R2.getObjectText(key);
    if (!raw) return false;

    const setField = (text, field, value) => (
        new RegExp(`^${field}:.*$`, 'm').test(text)
            ? text.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`)
            : text.replace(/^(image_file:.*)$/m, `$1\n${field}: ${value}`)
    );

    let next = raw
        .replace(/images\/[0-9A-Za-z]{12}\.(webp|png)/g, `images/${newFile}`);
    next = setField(next, 'image_file', `images/${newFile}`);
    next = setField(next, 'image_status', 'generated');
    next = setField(next, 'image_source_url', provenance.image_source_url || '');
    next = setField(next, 'image_stage', provenance.image_stage || '');
    next = setField(next, 'image_credit', `"${String(provenance.image_credit || '').replace(/"/g, '\\"')}"`);
    if (provenance.promote) next = setField(next, 'status', 'published');

    if (next === raw) return false;

    await R2.putObject({
        key,
        body: next,
        contentType: 'text/markdown; charset=utf-8',
        cacheControl: 'public, max-age=300',
        metadata: { article_slug: entry.slug },
    });
    return true;
}

/** Clear the image fields on an article being taken out of the feed. */
async function markMarkdownUnpublished(prefix, entry) {
    const key = `${prefix}${entry.file}`;
    const raw = await R2.getObjectText(key);
    if (!raw) return false;

    const next = raw
        .replace(/^image_file:.*$/m, 'image_file: ')
        .replace(/^image_status:.*$/m, 'image_status: pending')
        .replace(/^status:.*$/m, 'status: draft')
        // Drop the body image, whose object is about to be deleted.
        .replace(/^!\[[^\]]*\]\([^)]*\/images\/[^)]*\)\n\n?/gm, '');
    if (next === raw) return false;

    await R2.putObject({
        key,
        body: next,
        contentType: 'text/markdown; charset=utf-8',
        cacheControl: 'public, max-age=300',
        metadata: { article_slug: entry.slug },
    });
    return true;
}

async function applyPlan(report) {
    const stamp = report.stamp;
    const days = [...new Set(report.rows.map(r => r.day))];

    await snapshotIndexes(stamp, days);

    const archived = [];
    let replaced = 0;
    let unpublished = 0;

    for (const day of days) {
        const date = R2.dateFromPstString(day);
        const prefix = News.newsDayPrefix(date);
        const manifest = await News.readNewsDayIndex(date);
        if (!manifest?.articles) { log(`  ${day}: no manifest, skipping`); continue; }

        const rows = report.rows.filter(r => r.day === day && r.action !== 'skip');
        const toDelete = [];

        for (const row of rows) {
            const entry = manifest.articles.find(a => a.slug === row.slug);
            if (!entry) { log(`  ${day} ${row.slug}: gone from the manifest, skipping`); continue; }

            // Everything actually in the folder, not just what the manifest
            // admits to. A generated image the manifest forgot about — one from
            // an abandoned wave, or an admin regeneration under a random salt —
            // is still a generated image sitting in the CDN path, and leaving
            // it is how a folder ends up containing nothing BUT an AI render,
            // which the repair's lone-file rule would then adopt as the hero.
            const inFolder = [...(await R2.listPrefix(`${prefix}${row.slug}/images/`)).keys()];
            for (const key of inFolder) {
                const dest = await archiveObject(key, stamp);
                if (dest) archived.push({ from: key, to: dest });
            }

            if (row.action === 'unpublish') {
                entry.status = 'draft';
                entry.images = [];
                entry.image_file = '';
                entry.image_status = 'pending';
                entry.date_updated = new Date().toISOString();
                // The markdown has to say so too, or the next repair reads
                // `status: published` off the file and puts it straight back —
                // pointing at an image that is about to be deleted.
                await markMarkdownUnpublished(prefix, entry);
                toDelete.push(...inFolder);
                unpublished++;
                log(`  ${day} ${row.slug}: unpublished`);
                continue;
            }

            // Prefer the bytes the planning pass already validated — those are
            // the ones on the contact sheet that was reviewed. Only re-fetch
            // when applying a report loaded from an earlier run.
            let prepared = _prepared.get(preparedKey(day, row.slug));
            if (!prepared) {
                await politeDelay(row.image_source_url);
                prepared = await Recover.prepareRecovered(row.image_source_url);
            }
            if (!prepared.ok) {
                log(`  ${day} ${row.slug}: image no longer usable (${prepared.reason}) — leaving as planned-unpublish`);
                entry.status = 'draft';
                entry.images = [];
                entry.image_file = '';
                entry.image_status = 'pending';
                await markMarkdownUnpublished(prefix, entry);
                toDelete.push(...inFolder);
                unpublished++;
                continue;
            }

            const imageId = row.new_image_id;
            const upload = await News.publishNewsImage(entry, {
                imageId, buffer: prepared.webp, n: 1, date, force: true,
            });
            const rel = upload.key.slice(prefix.length);
            const newFile = `${imageId}.${News.IMAGE_EXT}`;
            const promote = entry.status === 'draft' && entry.fact_confidence !== 'headline_only';

            await repointMarkdown(prefix, entry, newFile, {
                image_source_url: row.image_source_url,
                image_stage: row.image_stage,
                image_credit: row.image_credit,
                promote,
            });

            entry.images = [{
                n: 1,
                role: 'hero',
                id: imageId,
                file: rel,
                safety: 'sourced',
                image_source_url: row.image_source_url,
                image_stage: row.image_stage,
                image_credit: row.image_credit,
                image_phash: prepared.phash,
            }];
            entry.image_file = rel;
            entry.image_status = 'generated';
            entry.image_source_url = row.image_source_url;
            entry.image_stage = row.image_stage;
            entry.image_credit = row.image_credit;
            entry.date_updated = new Date().toISOString();
            if (promote) entry.status = 'published';

            // Everything that was in the folder except the picture just
            // written. Sweeping the folder rather than the manifest's list is
            // what guarantees no generated render is left behind.
            toDelete.push(...inFolder.filter(k => k !== upload.key));
            replaced++;
            log(`  ${day} ${row.slug}: replaced (${row.image_stage})`);
        }

        // Every other article's folder, including the ones already migrated on
        // an earlier pass. Those were skipped above, so their leftovers would
        // otherwise survive forever — and a folder holding nothing but a
        // generated render is one `--repair` away from putting it back on the
        // site, because the repair adopts a lone image as the hero.
        const handled = new Set(rows.map(r => r.slug));
        for (const entry of manifest.articles) {
            if (handled.has(entry.slug)) continue;
            const keep = entry.image_file ? `${prefix}${entry.image_file}` : null;
            const stale = [...(await R2.listPrefix(`${prefix}${entry.slug}/images/`)).keys()]
                .filter(k => k !== keep);
            for (const key of stale) {
                const dest = await archiveObject(key, stamp);
                if (dest) archived.push({ from: key, to: dest });
            }
            if (stale.length) {
                toDelete.push(...stale);
                log(`  ${day} ${entry.slug}: sweeping ${stale.length} superseded image(s)`);
            }
        }

        // Manifest before deletion: an article pointing at a file that is gone
        // is worse than a file nothing points at.
        await News.rewriteNewsDayIndex(manifest.articles, { date });
        await News.upsertNewsSlugIndex(manifest.articles, { date });
        await News.upsertNewsLatest({
            date,
            count: manifest.articles.filter(a => a.status === 'published').length,
        });

        if (toDelete.length) {
            const res = await R2.deleteObjects(toDelete);
            log(`  ${day}: deleted ${res.deleted.length} superseded image(s)`);
            for (const e of res.errors) log(`    ERROR ${e.key}: ${e.message}`);
        }
    }

    report.archived = archived;
    report.applied_at = new Date().toISOString();
    report.result = { replaced, unpublished };
    log('');
    log(`applied: ${replaced} replaced, ${unpublished} unpublished, ${archived.length} archived`);
}

// ── Rollback ─────────────────────────────────────────────────────────────────

async function rollback(file) {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!report.archived?.length) { log('that report archived nothing — nothing to roll back'); return; }

    log(`restoring ${report.archived.length} archived image(s) from ${report.stamp}`);
    let restored = 0;
    for (const { from, to } of report.archived) {
        const buffer = await R2.getObjectBuffer(to);
        if (!buffer) { log(`  MISSING ${to}`); continue; }
        await R2.putObject({
            key: from, body: buffer,
            contentType: News.IMAGE_CONTENT_TYPE,
            cacheControl: 'public, max-age=604800',
        });
        restored++;
    }

    for (const day of [...new Set(report.rows.map(r => r.day))]) {
        const key = `${BACKUP_PREFIX}/${report.stamp}/${News.buildNewsDayIndexKey(R2.dateFromPstString(day))}`;
        const body = await R2.getObjectText(key);
        if (!body) { log(`  no index snapshot for ${day}`); continue; }
        await R2.putObject({
            key: News.buildNewsDayIndexKey(R2.dateFromPstString(day)),
            body,
            contentType: 'application/json; charset=utf-8',
            cacheControl: 'public, max-age=60',
        });
        log(`  restored the ${day} manifest`);
    }

    log(`restored ${restored} image(s). The article markdown still points at the new ids —`);
    log('run --repair for each affected day to reconcile.');
}

// ── Report and contact sheet ─────────────────────────────────────────────────

function writeReport(report) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `migration-${report.stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    return file;
}

/**
 * A page of every proposed picture beside its headline.
 *
 * Twenty minutes of looking is the cheapest defence there is against the
 * corroboration rung attaching the wrong photograph to a real story — no
 * automated check substitutes for seeing them side by side.
 */
function writeContactSheet(report) {
    const rows = report.rows.filter(r => r.action === 'replace');
    const misses = report.rows.filter(r => r.action === 'unpublish');

    const card = (r) => `
    <figure class="${r.image_stage === 'corroborated' ? 'flag' : ''}">
      <img src="${escapeHtml(r.image_source_url)}" alt="" loading="lazy">
      <figcaption>
        <strong>${escapeHtml(r.title || r.slug)}</strong>
        <span class="meta">${escapeHtml(r.day)} · ${escapeHtml(r.image_stage)}${
    r.similarity ? ` · similarity ${r.similarity}` : ''} · ${r.original_width}x${r.original_height}</span>
        <a href="${escapeHtml(r.source_url)}">source</a>
        ${r.via ? `<a href="${escapeHtml(r.via)}">via ${escapeHtml(new URL(r.via).hostname)}</a>` : ''}
      </figcaption>
    </figure>`;

    const html = `<!DOCTYPE html>
<meta charset="utf-8">
<title>News image migration — ${report.stamp}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; background: #fafafa; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; }
  figure { margin: 0; background: #fff; border: 1px solid #e3e3e3; border-radius: 6px; overflow: hidden; }
  figure.flag { border-color: #d97706; box-shadow: 0 0 0 2px #fde68a; }
  img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; background: #eee; }
  figcaption { padding: .6rem .75rem; display: grid; gap: .25rem; }
  .meta { color: #666; font-size: .82rem; }
  a { font-size: .82rem; margin-right: .6rem; }
  .warn { background: #fff7ed; border: 1px solid #fdba74; padding: .75rem 1rem; border-radius: 6px; }
  ul { padding-left: 1.2rem; }
</style>
<h1>News image migration — ${report.stamp}</h1>
<p>${rows.length} to replace, ${misses.length} to unpublish, ${report.rows.filter(r => r.action === 'skip').length} already done.</p>
<div class="warn">
  <strong>Check the highlighted cards.</strong> Those came from a different outlet's coverage
  rather than the story's own source page, so they are the only ones that could depict the
  wrong event. Everything else is the picture the original outlet published.
</div>
<div class="grid">${rows.map(card).join('')}</div>
<h2>To be unpublished (${misses.length})</h2>
<ul>${misses.map(r => `<li><a href="${escapeHtml(r.source_url)}">${escapeHtml(r.title || r.slug)}</a>
  — ${escapeHtml((r.attempts || []).map(a => a.reason).join('; '))}</li>`).join('')}</ul>
`;

    const file = path.join(OUT_DIR, `migration-${report.stamp}.html`);
    fs.writeFileSync(file, html);
    return file;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (!R2.isConfigured()) throw new Error('R2 is not configured — refusing to start');

    if (OPTIONS.rollback && OPTIONS.rollback !== true) {
        await rollback(OPTIONS.rollback);
        return;
    }

    if (!OPTIONS.plan && !OPTIONS.apply) {
        log('Nothing to do. Pass --plan to survey, or --apply --yes to execute a plan.');
        log('  node scripts/migrate-news-images.js --plan');
        return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const hosts = Recover.trustedHosts();

    log(`news image migration — ${OPTIONS.apply ? 'APPLY' : 'PLAN'} (${stamp})`);
    const articles = await collectArticles();
    if (!articles.length) { log('no articles found'); return; }
    log(`${articles.length} article(s) across ${new Set(articles.map(a => a.day)).size} day(s)`);
    log('');

    const rows = [];
    for (let i = 0; i < articles.length; i++) {
        rows.push(await planOne(articles[i], hosts, i, articles.length));
        // The page cache holds every source page's HTML; over a hundred
        // articles that is tens of megabytes of retained strings.
        if (i % 20 === 19) Facts.clearPageCache();
    }
    Facts.clearPageCache();

    const report = { stamp, generated_at: new Date().toISOString(), options: OPTIONS, rows };
    const counts = rows.reduce((acc, r) => ({ ...acc, [r.action]: (acc[r.action] || 0) + 1 }), {});
    const stages = rows.filter(r => r.action === 'replace')
        .reduce((acc, r) => ({ ...acc, [r.image_stage]: (acc[r.image_stage] || 0) + 1 }), {});

    log('');
    log(`plan: ${JSON.stringify(counts)}`);
    log(`  recovered from: ${JSON.stringify(stages)}`);

    if (OPTIONS.apply) {
        if (!OPTIONS.yes) {
            const file = writeReport(report);
            log('');
            log(`--apply needs --yes. Nothing was changed. Plan written to ${file}`);
            return;
        }
        log('');
        await applyPlan(report);
    }

    const jsonFile = writeReport(report);
    const sheetFile = writeContactSheet(report);
    fs.writeFileSync(path.join(OUT_DIR, `migration-${stamp}.log`), lines.join('\n'));

    console.log('');
    console.log(`report       : ${jsonFile}`);
    console.log(`contact sheet: ${sheetFile}`);
    if (!OPTIONS.apply) {
        console.log('');
        console.log('Open the contact sheet and check the highlighted cards before applying.');
        console.log('Then: node scripts/migrate-news-images.js --apply --yes');
    }
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => {
        console.error(`[migrate-news-images] ${e.message}`);
        if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
        process.exit(1);
    });
}

module.exports = { collectArticles, alreadySourced, planOne, applyPlan, escapeHtml };

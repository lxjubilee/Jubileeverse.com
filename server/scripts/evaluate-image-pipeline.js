'use strict';
/**
 * scripts/evaluate-image-pipeline.js — Measure the finished pipeline, and
 * compare render profiles through it.
 *
 * This is the "final bake-off and recommendation" step of
 * docs/IMAGE-QUALITY-PIPELINE.md. Round one compared the two checkpoints on
 * timing alone, because there was no scoring gate yet to compare them on
 * anything else. There is now, so this runs the same articles through the same
 * gates on each profile and reports what actually differs.
 *
 * It changes nothing. `COMFY_PROFILE` is read, never written, and no image is
 * uploaded anywhere — the owner decides whether to switch the default, on the
 * numbers this prints.
 *
 *   node scripts/evaluate-image-pipeline.js                       # both profiles
 *   node scripts/evaluate-image-pipeline.js --profiles schnell    # just one
 *   node scripts/evaluate-image-pipeline.js --articles 10
 *   node scripts/evaluate-image-pipeline.js --out report.json
 *   node scripts/evaluate-image-pipeline.js --sample-only         # no R2, built-in set
 */

const fs = require('fs');
const path = require('path');

/**
 * server/.env carries a UTF-8 BOM on line one, which would otherwise corrupt
 * the first key's name. Parsed by hand, exactly as publish-daily-news.js does,
 * so this script needs no dotenv dependency. It must run before the libraries
 * below are required: they read credentials at module load.
 */
(function loadDotEnv() {
    const file = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && process.env[m[1]] === undefined) {
            process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
    }
}());

const Comfy = require('../lib/comfy-client');
const Judge = require('../lib/image-judge');
const Regen = require('../lib/image-regen');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const arg = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const ARTICLE_COUNT = Number(arg('articles', 6));
const PROFILES = String(arg('profiles', 'schnell,sdxl')).split(',').map(s => s.trim()).filter(Boolean);

/**
 * Fallback corpus, used when R2 is unreachable.
 *
 * Chosen to span what the pipeline actually publishes rather than what is easy
 * to render: people with visible hands, a crowd, an exterior with no subject,
 * a low-light interior, and an abstract topic with no obvious scene. A sample
 * of flattering prompts would make any profile look good.
 */
const SAMPLE_ARTICLES = [
    { title: 'Volunteers Open New Food Bank in Rural County', topic: 'community', summary: 'A church-run food bank opens its doors after eighteen months of fundraising, serving four hundred families a week.' },
    { title: 'Congregation Marks Fiftieth Anniversary of Its Building', topic: 'church-us', summary: 'Members gather for a service of thanksgiving in the sanctuary their parents built.' },
    { title: 'Main Street Businesses Report Slow Recovery', topic: 'finance', summary: 'Shopfront vacancies fall for a third quarter, but owners say foot traffic has not returned.' },
    { title: 'Night Shift Chaplains Keep Watch at County Hospital', topic: 'health', summary: 'A team of volunteer chaplains sits with patients through the small hours.' },
    { title: 'Families Turn Off Screens for a Week', topic: 'family-life', summary: 'A congregation tries a seven-day fast from devices and reports on what changed at home.' },
    { title: 'Rural Schools Share One Science Teacher', topic: 'social', summary: 'Three districts pool resources to keep a physics course running.' },
];

/** Real published articles, so the evaluation reflects what the site ships. */
async function loadArticles(count) {
    if (has('sample-only')) return SAMPLE_ARTICLES.slice(0, count);
    try {
        const R2 = require('../lib/r2-client');
        const News = require('../lib/r2-news');
        if (!R2.isConfigured()) throw new Error('R2 not configured');

        const out = [];
        for (let i = 0; i < 21 && out.length < count; i++) {
            const day = new Date(Date.now() - i * 86400000);
            const manifest = await News.readNewsDayIndex(day);
            for (const a of manifest?.articles || []) {
                if (out.length >= count) break;
                if (!a.title) continue;
                out.push({ title: a.title, topic: a.topic || a.category, summary: a.summary || a.marketing_summary });
            }
        }
        if (out.length) {
            console.log(`using ${out.length} published article(s) from R2`);
            return out;
        }
        throw new Error('no published articles found');
    } catch (e) {
        console.log(`R2 unavailable (${e.message}) — using the built-in sample set`);
        return SAMPLE_ARTICLES.slice(0, count);
    }
}

/** Which checkpoints the render hosts actually hold. */
async function installedCheckpoints(lane) {
    const r = await Comfy.request('GET', `${lane}/object_info/CheckpointLoaderSimple`, { timeout: 15000 });
    if (r.status !== 200) return [];
    return JSON.parse(r.buf.toString()).CheckpointLoaderSimple.input.required.ckpt_name[0] || [];
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n, digits = 1) => (n == null ? '   n/a' : n.toFixed(digits).padStart(6));

/** Run every article through the full pipeline on one profile. */
async function evaluateProfile(profileName, articles, lanes) {
    const pool = Comfy.createLanePool(lanes);
    const quiet = { log() {}, warn() {} };
    const results = [];

    await Promise.all(articles.map(async (article, i) => {
        const prompt = Regen.buildHeroPrompt({
            title: article.title, summary: article.summary, category: article.topic,
        });
        const t0 = Date.now();
        const out = await Judge.produceImage({
            prompt,
            articleId: `eval-${profileName}-${i}`,
            article,
            n: 1,
            candidates: Number(arg('candidates', Judge.HERO_CANDIDATES)),
            maxRounds: Number(arg('rounds', Judge.MAX_ROUNDS)),
            render: (p, seed) => pool.submit(lane => Comfy.generateImage(p, {
                lane, seed, opts: { profile: profileName },
            })),
            logger: quiet,
        });

        const rendered = out.rounds.reduce((s, r) => s + (r.rendered || 0), 0);
        const passed = out.rounds.reduce((s, r) => s + (r.structuralPassed || 0), 0);
        results.push({
            title: article.title,
            ms: Date.now() - t0,
            rounds: out.rounds.length,
            rendered,
            structuralPassed: passed,
            flags: out.rounds.flatMap(r => r.flags || []),
            // Every mark the judge gave, accepted or not. Recording only the
            // winner's score made a total rejection indistinguishable from a
            // judge that never ran: the first evaluation drafted 10/10 articles
            // and left no evidence of how close any of them came.
            allJudgeScores: out.rounds.flatMap(r => r.scores || []),
            judgeScore: out.image?.rubric?.score ?? null,
            structuralScore: out.image?.structural?.score ?? null,
            accepted: Boolean(out.image),
            reason: out.reason,
        });
        process.stdout.write(out.image ? '.' : 'x');
    }));

    process.stdout.write('\n');

    const rendered = results.reduce((s, r) => s + r.rendered, 0);
    const passed = results.reduce((s, r) => s + r.structuralPassed, 0);
    const flagCounts = {};
    for (const f of results.flatMap(r => r.flags)) flagCounts[f] = (flagCounts[f] || 0) + 1;

    return {
        profile: profileName,
        articles: results.length,
        rendered,
        structuralPassed: passed,
        structuralPassRate: rendered ? (100 * passed) / rendered : null,
        accepted: results.filter(r => r.accepted).length,
        draftRate: results.length ? (100 * results.filter(r => !r.accepted).length) / results.length : null,
        retryRate: results.length ? (100 * results.filter(r => r.rounds > 1).length) / results.length : null,
        meanJudge: mean(results.filter(r => r.judgeScore != null).map(r => r.judgeScore)),
        meanStructural: mean(results.filter(r => r.structuralScore != null).map(r => r.structuralScore)),
        meanMsPerArticle: mean(results.map(r => r.ms)),
        medianMsPerArticle: median(results.map(r => r.ms)),
        flagCounts,
        results,
    };
}

(async () => {
    const lanes = await Comfy.liveLanes({ force: true });
    if (!lanes.length) { console.error('no ComfyUI lane reachable'); process.exit(1); }
    console.log(`lanes: ${lanes.join(', ')}`);

    const checkpoints = await installedCheckpoints(lanes[0]);
    const runnable = [];
    for (const name of PROFILES) {
        const p = Comfy.profile(name);
        if (p.licence === 'non-commercial') {
            console.log(`skipping ${name}: non-commercial licence, not eligible for this site`);
            continue;
        }
        if (checkpoints.length && !checkpoints.includes(p.checkpoint)) {
            console.log(`skipping ${name}: ${p.checkpoint} is not installed on ${lanes[0]}`);
            continue;
        }
        runnable.push(name);
    }
    if (!runnable.length) { console.error('no runnable profile'); process.exit(1); }

    const articles = await loadArticles(ARTICLE_COUNT);
    console.log(`evaluating ${runnable.join(' vs ')} over ${articles.length} article(s)`);
    console.log(`judge: ${Judge.MODE} (model ${Judge.JUDGE_MODEL}, bar ${Judge.MIN_JUDGE_SCORE})`);
    console.log(`candidates per hero: ${Judge.HERO_CANDIDATES}, max rounds: ${Judge.MAX_ROUNDS}\n`);

    const reports = [];
    for (const name of runnable) {
        console.log(`--- ${name} (${Comfy.profile(name).checkpoint}) ---`);
        reports.push(await evaluateProfile(name, articles, lanes));
    }

    console.log('\n  profile    articles  struct-pass  judge  struct  retry%  draft%   s/article');
    console.log('  ' + '-'.repeat(76));
    for (const r of reports) {
        console.log(
            `  ${r.profile.padEnd(10)} ${String(r.articles).padStart(8)}  `
            + `${fmt(r.structuralPassRate)}%      ${fmt(r.meanJudge, 0)} ${fmt(r.meanStructural, 0)}  `
            + `${fmt(r.retryRate, 0)}  ${fmt(r.draftRate, 0)}    ${fmt(r.meanMsPerArticle / 1000)}`,
        );
    }

    for (const r of reports) {
        const flags = Object.entries(r.flagCounts).sort((a, b) => b[1] - a[1]);
        console.log(`\n  ${r.profile} structural flags: ${flags.length ? flags.map(([f, c]) => `${f}x${c}`).join(', ') : '(none)'}`);

        // The distribution matters more than the mean when nothing passes: it
        // is the difference between "the bar is slightly high" and "these
        // images are not close".
        const all = r.results.flatMap(x => x.allJudgeScores || []).sort((a, b) => a - b);
        if (all.length) {
            const pct = (p) => all[Math.min(all.length - 1, Math.floor(all.length * p))];
            console.log(`  ${r.profile} judge marks (n=${all.length}): min ${all[0]}, p50 ${pct(0.5)}, `
                + `p90 ${pct(0.9)}, max ${all[all.length - 1]} | bar is ${Judge.MIN_JUDGE_SCORE}`
                + ` | ${all.filter(s => s >= Judge.MIN_JUDGE_SCORE).length} of ${all.length} at or above it`);
        }
    }

    if (reports.length === 2) {
        const [a, b] = reports;
        const delta = (x, y) => (x == null || y == null ? 'n/a' : (y - x >= 0 ? '+' : '') + (y - x).toFixed(1));
        console.log(`\n  ${b.profile} vs ${a.profile}:`
            + ` judge ${delta(a.meanJudge, b.meanJudge)},`
            + ` structural pass ${delta(a.structuralPassRate, b.structuralPassRate)}pp,`
            + ` draft ${delta(a.draftRate, b.draftRate)}pp,`
            + ` time ${delta(a.meanMsPerArticle / 1000, b.meanMsPerArticle / 1000)}s/article`);
    }

    console.log('\n  licences: ' + reports.map(r => `${r.profile}=${Comfy.profile(r.profile).licence}`).join(', '));
    console.log(`  DEFAULT_PROFILE is unchanged (${Comfy.DEFAULT_PROFILE}); switching it is the owner's call.`);

    const out = arg('out', null);
    if (out) {
        fs.writeFileSync(path.resolve(out), JSON.stringify({ generatedFor: runnable, reports }, null, 2));
        console.log(`\n  wrote ${out}`);
    }
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/**
 * scripts/calibrate-image-score.js — Derive the local-metric thresholds in
 * lib/image-score.js from real renders instead of taste.
 *
 * The structural rules (extra heads, cloned faces, cropped faces) need no
 * calibration: they are counting arguments and hold whatever the model. The
 * local metrics do — "blurry" is a number, and the right number depends on what
 * the current profile's output actually looks like. Switching COMFY_PROFILE
 * changes the population, so re-run this when the profile changes.
 *
 * Method: score a set of good renders, then score deliberately degraded copies
 * of the same renders (blurred, darkened, blown out, flattened). A usable
 * threshold sits in the gap between the two populations; one that does not
 * separate them is reported as such rather than quietly adopted.
 *
 *   node scripts/calibrate-image-score.js                  # render a fresh set
 *   node scripts/calibrate-image-score.js --dir path/to/pngs
 *   node scripts/calibrate-image-score.js --profile sdxl
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const Comfy = require('../lib/comfy-client');
const Score = require('../lib/image-score');

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

/**
 * Scenes chosen to span what the pipeline actually renders: people with hands,
 * an interior, an exterior, and a deliberately dim one. A calibration set of
 * only bright outdoor shots produces thresholds that flag every night scene.
 */
const SCENES = [
    'Two volunteers handing out boxes of food at a community centre, visible hands, warm afternoon light',
    'A small congregation seated in a sunlit chapel, wide documentary framing',
    'An empty small-town main street on an overcast morning, brick storefronts',
    'A single candle burning on a wooden table in a dark room, deep shadows',
];

/** The degradations a quality gate is supposed to catch. */
const DEGRADATIONS = {
    blurred: b => sharp(b).blur(6).png().toBuffer(),
    soft: b => sharp(b).blur(2.5).png().toBuffer(),
    dark: b => sharp(b).linear(0.25, 0).png().toBuffer(),
    blown: b => sharp(b).linear(1.9, 40).png().toBuffer(),
    flat: b => sharp(b).linear(0.25, 96).png().toBuffer(),
};

const fmt = n => (Number.isFinite(n) ? n.toFixed(2).padStart(7) : '      -');
const pct = n => (Number.isFinite(n) ? `${(n * 100).toFixed(2)}%`.padStart(7) : '      -');

async function loadSet() {
    const dir = arg('dir');
    if (dir) {
        const files = fs.readdirSync(dir).filter(f => /\.png$/i.test(f));
        console.log(`reading ${files.length} PNG(s) from ${dir}\n`);
        return files.map(f => ({ name: f, buffer: fs.readFileSync(path.join(dir, f)) }));
    }

    const lanes = await Comfy.liveLanes();
    if (!lanes.length) {
        console.error('no ComfyUI lane reachable, and no --dir given');
        process.exit(1);
    }
    const profileName = arg('profile') || Comfy.DEFAULT_PROFILE;
    console.log(`rendering ${SCENES.length} scene(s) on ${lanes.length} lane(s), profile ${profileName}\n`);

    const out = [];
    let cursor = 0;
    await Promise.all(lanes.map(async (lane) => {
        for (;;) {
            const i = cursor++;
            if (i >= SCENES.length) return;
            try {
                const r = await Comfy.generateImage(SCENES[i], {
                    lane, seed: 1000 + i, opts: { profile: profileName },
                });
                out.push({ name: `scene${i + 1}`, buffer: r.buffer });
                console.log(`  rendered scene${i + 1} (${r.ms}ms)`);
            } catch (e) {
                console.log(`  scene${i + 1} failed: ${e.message}`);
            }
        }
    }));
    const save = arg('save');
    if (save) {
        fs.mkdirSync(save, { recursive: true });
        out.forEach(o => fs.writeFileSync(path.join(save, `${o.name}.png`), o.buffer));
        console.log(`  saved ${out.length} render(s) to ${save}`);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

(async () => {
    const originals = await loadSet();
    if (!originals.length) { console.error('nothing to calibrate against'); process.exit(1); }

    const rows = [];
    for (const img of originals) {
        rows.push({ name: img.name, kind: 'good', m: await Score.localMetrics(img.buffer) });
        for (const [label, fn] of Object.entries(DEGRADATIONS)) {
            rows.push({
                name: `${img.name}:${label}`, kind: label,
                m: await Score.localMetrics(await fn(img.buffer)),
            });
        }
    }

    console.log('\n  metric        sharpness contrast     luma  shadow%  hilite%  image');
    console.log('  ' + '-'.repeat(72));
    for (const r of rows) {
        console.log(`  ${r.kind.padEnd(10)} ${fmt(r.m.sharpness)} ${fmt(r.m.contrast)} `
            + `${fmt(r.m.luma)} ${pct(r.m.shadowClip)} ${pct(r.m.highlightClip)}  ${r.name}`);
    }

    // A threshold is only meaningful where the two populations do not overlap.
    const good = rows.filter(r => r.kind === 'good').map(r => r.m);
    const bad = k => rows.filter(r => r.kind === k).map(r => r.m);
    const min = (xs, k) => Math.min(...xs.map(m => m[k]));
    const max = (xs, k) => Math.max(...xs.map(m => m[k]));

    // Each row is the tightest pair: the worst good render against the least-bad
    // degraded one. A threshold set anywhere in between holds for the whole set.
    const gaps = [
        ['sharpness', 'blurry', min(good, 'sharpness'), max([...bad('blurred'), ...bad('soft')], 'sharpness'), 'above'],
        ['contrast', 'flat', min(good, 'contrast'), max(bad('flat'), 'contrast'), 'above'],
        // Kept so the overlap stays visible: these are the two rules the gate
        // does NOT have, and re-running here is what would justify adding them.
        ['shadowClip', 'underexposed', max(good, 'shadowClip'), min(bad('dark'), 'shadowClip'), 'below'],
        ['highlightClip', 'overexposed', max(good, 'highlightClip'), min(bad('blown'), 'highlightClip'), 'below'],
    ];

    console.log('\n  separation (worst good vs worst bad)\n  ' + '-'.repeat(62));
    for (const [metric, flag, goodEdge, badEdge, dir] of gaps) {
        const separated = dir === 'above' ? goodEdge > badEdge : goodEdge < badEdge;
        const midpoint = (goodEdge + badEdge) / 2;
        console.log(`  ${metric.padEnd(13)} good=${fmt(goodEdge)} bad=${fmt(badEdge)}  `
            + (separated
                ? `SEPARATED -> suggest ${midpoint.toFixed(2)} for "${flag}"`
                : `OVERLAP — "${flag}" cannot be set from this data`));
    }

    // Entropy is printed but never gated: it ranks a candle-lit chapel below a
    // flattened daylight scene, so it separates mood, not quality.
    console.log(`\n  entropy (reported, not gated): good ${min(good, 'entropy').toFixed(2)}`
        + `-${max(good, 'entropy').toFixed(2)}`);
    console.log('  current limits in lib/image-score.js:', JSON.stringify(Score.LIMITS));

    // Re-score the same set through the real gate, so the thresholds above are
    // checked against the code that will use them rather than against a table.
    // Exposure degradations are listed but not asserted on: the gate makes no
    // exposure claim, so demanding they fail would be scoring it against a rule
    // it deliberately does not have.
    const UNGATED = new Set(['dark', 'blown']);

    console.log('\n  verdicts under the current limits\n  ' + '-'.repeat(72));
    let wrong = 0;
    let judged = 0;
    for (const r of rows) {
        const v = Score.verdictFrom(Score.gradeLocal(r.m), { partial: true });
        let mark;
        if (UNGATED.has(r.kind)) {
            mark = ' -- ';
        } else {
            const agree = v.ok === (r.kind === 'good');
            judged++;
            if (!agree) wrong++;
            mark = agree ? ' ok ' : 'MISS';
        }
        console.log(`  ${mark}  ${r.name.padEnd(20)} score=${String(v.score).padStart(3)}`
            + `  ${v.flags.join(',') || '(clean)'}`);
    }
    console.log(`\n  ${judged - wrong}/${judged} gated cases classified as expected`
        + ` (${rows.length - judged} ungated, shown as --)`);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * generate-pending-article-images.js
 *
 * Renders the hero image for every article whose `image_file` is still empty,
 * i.e. the image generator's work queue as defined in JubileeVerse-Article-Spec
 * section 15.
 *
 * Why this exists alongside generate-article-images.js: that script implements
 * an older contract — `image-prompt01/02/03`, a random set ID, `<ID>-N.png`
 * output and an `articles_catalog.json` sidecar. Nothing in the live corpus
 * uses it: all 600 articles carry a single `image_prompt`, images are named
 * `<slug>.webp`, and the manifest is `articles.json`. This script targets the
 * live contract and leaves the older one untouched.
 *
 * Output is WebP, not PNG, matching every image already on the CDN. ComfyUI
 * returns PNG, so it is re-encoded here at the same quality the WPF studio uses.
 *
 * The .md is only stamped AFTER the bytes are on disk. An article whose render
 * failed keeps `image_file: ""` and is simply picked up by the next run — the
 * one rule that must never be violated is writing a filename for a file that
 * does not exist, which marks the work done and dequeues it forever.
 *
 * Usage:
 *   node scripts/generate-pending-article-images.js --dry
 *   node scripts/generate-pending-article-images.js --limit 5
 *   node scripts/generate-pending-article-images.js --realism 0 --fix-hands 0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const sharp = require('sharp');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);

const ROOT = arg('root', 'J:/jubileeverse.com/articles');
const CATEGORIES = ['covenant-identity', 'teshuvah-restoration', 'shalom-salvation', 'celebration-mishpakhah', 'torah-hebraic'];
const HOSTS = arg('comfy', 'http://10.0.0.52:8188,http://10.0.0.52:8189').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = has('dry');
const LIMIT = Number(arg('limit', '0')) || Infinity;
const QUALITY = Number(arg('quality', '82'));

const FLUX = {
    checkpoint: arg('flux-checkpoint', 'flux1-schnell-fp8.safetensors'),
    steps: Number(arg('steps', '4')),
    guidance: Number(arg('guidance', '3.5')),
    width: Number(arg('width', '1344')),
    height: Number(arg('height', '768')),
    realism: Number(arg('realism', '0.7')),
    realismLora: arg('realism-lora', 'flux-realism.safetensors'),
    fixHands: arg('fix-hands', '1') !== '0',
    handModel: arg('hand-model', 'bbox/hand_yolov8s.pt'),
    handSteps: Number(arg('hand-steps', '8')),
    handDenoise: Number(arg('hand-denoise', '0.6')),
    handBbox: Number(arg('hand-bbox', '0.3')),
    handDilation: Number(arg('hand-dilation', '10')),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, url, { body = null, timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const h = {};
        let data = null;
        if (body != null) { data = JSON.stringify(body); h['Content-Length'] = Buffer.byteLength(data); h['Content-Type'] = 'application/json'; }
        const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, headers: h, timeout }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
        if (data) req.write(data);
        req.end();
    });
}

/** FLUX txt2img graph — same shape as generate-article-images.js, which is known to work here. */
function fluxGraph(prompt, seed, id) {
    const g = {
        '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: FLUX.checkpoint } },
        '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
        '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
        '6': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: FLUX.guidance } },
        '7': { class_type: 'EmptySD3LatentImage', inputs: { width: FLUX.width, height: FLUX.height, batch_size: 1 } },
        '8': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['5', 0], latent_image: ['7', 0], seed, steps: FLUX.steps, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
        '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['1', 2] } },
        '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: `jv_${id}` } },
    };
    if (FLUX.realism > 0 && FLUX.realismLora) {
        g['11'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: FLUX.realismLora, strength_model: FLUX.realism } };
        g['8'].inputs.model = ['11', 0];
    }
    if (FLUX.fixHands) {
        const modelRef = (FLUX.realism > 0 && FLUX.realismLora) ? ['11', 0] : ['1', 0];
        g['12'] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: FLUX.handModel } };
        g['13'] = { class_type: 'FaceDetailer', inputs: {
            image: ['9', 0], model: modelRef, clip: ['1', 1], vae: ['1', 2],
            positive: ['6', 0], negative: ['5', 0], bbox_detector: ['12', 0],
            guide_size: 512, guide_size_for: true, max_size: 1024,
            seed, steps: FLUX.handSteps, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple',
            denoise: FLUX.handDenoise, feather: 5, noise_mask: true, force_inpaint: true,
            bbox_threshold: FLUX.handBbox, bbox_dilation: FLUX.handDilation, bbox_crop_factor: 3.0,
            sam_detection_hint: 'center-1', sam_dilation: 0, sam_threshold: 0.93,
            sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7, sam_mask_hint_use_negative: 'False',
            drop_size: 10, wildcard: '', cycle: 1,
        } };
        g['10'].inputs.images = ['13', 0];
    }
    return g;
}

/** Render one prompt on one host and return the raw PNG buffer. */
async function render(host, prompt) {
    const id = crypto.randomBytes(6).toString('hex');
    const seed = crypto.randomInt(1, 2 ** 31);
    const sub = await request('POST', `${host}/prompt`, { body: { prompt: fluxGraph(prompt, seed, id), client_id: crypto.randomUUID() } });
    if (sub.status !== 200) throw new Error(`/prompt HTTP ${sub.status}: ${sub.buf.toString().slice(0, 160)}`);
    const promptId = JSON.parse(sub.buf.toString()).prompt_id;
    if (!promptId) throw new Error('no prompt_id returned');

    let out = null;
    for (let t = 0; t < 120; t++) {
        await sleep(2000);
        const h = await request('GET', `${host}/history/${promptId}`, { timeout: 15000 });
        if (h.status !== 200) continue;
        const rec = (JSON.parse(h.buf.toString() || '{}'))[promptId];
        if (!rec || !rec.outputs) continue;
        for (const node of Object.values(rec.outputs)) if (node.images && node.images[0]) { out = node.images[0]; break; }
        if (out) break;
        if (rec.status && rec.status.status_str === 'error') throw new Error('comfy reported job error');
    }
    if (!out) throw new Error('timed out waiting for the render');

    const q = `filename=${encodeURIComponent(out.filename)}&subfolder=${encodeURIComponent(out.subfolder || '')}&type=${encodeURIComponent(out.type || 'output')}`;
    const img = await request('GET', `${host}/view?${q}`, { timeout: 60000 });
    if (img.status !== 200 || img.buf.length < 10000) throw new Error(`/view HTTP ${img.status}, ${img.buf.length} bytes`);
    return img.buf;
}

/** Stamp the real filename into frontmatter. Called only once bytes are on disk. */
function stampImageFile(mdPath, fileName) {
    const text = fs.readFileSync(mdPath, 'utf8');
    const end = text.indexOf('\n---', 3);
    if (end < 0) return false;
    const head = text.slice(0, end);
    const tail = text.slice(end);
    const rx = /^image_file:\s*".*"\s*$/m;
    if (!rx.test(head)) return false;
    fs.writeFileSync(mdPath, head.replace(rx, `image_file: "${fileName}"`) + tail, 'utf8');
    return true;
}

function pending() {
    const jobs = [];
    for (const cat of CATEGORIES) {
        const dir = path.join(ROOT, cat);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
            const p = path.join(dir, f);
            const raw = fs.readFileSync(p, 'utf8');
            const fmEnd = raw.indexOf('\n---', 3);
            const fm = fmEnd < 0 ? '' : raw.slice(0, fmEnd);
            const imgM = fm.match(/^image_file:\s*"(.*)"\s*$/m);
            if (!imgM || imgM[1] !== '') continue;              // already has one
            const prM = fm.match(/^image_prompt:\s*"([\s\S]*?)"\s*$/m);
            const slug = f.replace(/\.md$/, '');
            if (!prM || !prM[1].trim()) { console.log(`  ! ${cat}/${slug}: empty image_prompt, skipped`); continue; }
            jobs.push({ cat, slug, mdPath: p, prompt: prM[1], dest: path.join(dir, 'images', `${slug}.webp`) });
        }
    }
    return jobs;
}

(async () => {
    const jobs = pending().slice(0, LIMIT);
    console.log(`pending articles : ${jobs.length}`);
    console.log(`hosts            : ${HOSTS.join(', ')}`);
    console.log(`model            : ${FLUX.checkpoint} @ ${FLUX.width}x${FLUX.height}, ${FLUX.steps} steps`
        + `, realism ${FLUX.realism}, hands ${FLUX.fixHands ? 'on' : 'off'}`);
    if (DRY) {
        for (const j of jobs.slice(0, 8)) console.log(`  would render ${j.cat}/${j.slug}.webp`);
        if (jobs.length > 8) console.log(`  …and ${jobs.length - 8} more`);
        console.log('\nDRY RUN — nothing rendered');
        return;
    }

    let done = 0, failed = 0, bytes = 0;
    const queue = jobs.slice();
    const t0 = Date.now();

    // One worker per GPU; each pulls the next job as it frees up.
    await Promise.all(HOSTS.map(async (host) => {
        for (;;) {
            const job = queue.shift();
            if (!job) return;
            try {
                const png = await render(host, job.prompt);
                const webp = await sharp(png).webp({ quality: QUALITY }).toBuffer();
                fs.mkdirSync(path.dirname(job.dest), { recursive: true });
                fs.writeFileSync(job.dest, webp);
                // Only now, with the file genuinely on disk.
                const stamped = stampImageFile(job.mdPath, `${job.slug}.webp`);
                bytes += webp.length; done++;
                console.log(`  ✓ ${job.cat}/${job.slug}.webp  ${(webp.length / 1024).toFixed(0)}KB`
                    + (stamped ? '' : '  (WARN: could not stamp image_file)') + `  [${done}/${jobs.length}]`);
            } catch (e) {
                failed++;
                console.log(`  ✗ ${job.cat}/${job.slug}: ${e.message}`);
            }
        }
    }));

    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`\nrendered : ${done}`);
    console.log(`failed   : ${failed}${failed ? '  (still image_file:"" — re-run to retry)' : ''}`);
    console.log(`written  : ${(bytes / 1024 / 1024).toFixed(1)} MB in ${mins} min`);
    console.log('\nNext: node server/scripts/rebuild-article-manifests.js --write');
})();

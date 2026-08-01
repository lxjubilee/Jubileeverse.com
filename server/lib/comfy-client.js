'use strict';
/**
 * lib/comfy-client.js — Lean ComfyUI/FLUX client that returns image buffers.
 *
 * The graph, model choices, and hand-repair settings are lifted from
 * scripts/generate-article-images.js, which is tuned and working. This is a
 * separate module rather than a refactor of that script because the script is
 * argv-driven, writes to disk, and rewrites articles_catalog.json — the nav
 * catalog the live site reads. Pointing the news pipeline at it would corrupt
 * site navigation nightly.
 *
 * The one behavioural difference: generateImage() returns a Buffer instead of
 * writing a file. Everything downstream (safety scan, R2 upload) wants bytes.
 *
 * Topology: two ComfyUI instances on the LAN, one per RTX 5090. Each owns its
 * GPU and queues internally, so the caller must not submit more than one job
 * per lane at a time.
 */

const http = require('http');
const crypto = require('crypto');

const COMFY_LANES = (process.env.COMFY_URLS || 'http://10.0.0.52:8188,http://10.0.0.52:8189')
    .split(',').map(s => s.trim()).filter(Boolean);

/**
 * Model profiles.
 *
 * Which checkpoint renders an article image is a licensing decision as much as
 * a quality one, so it is configuration rather than a constant:
 *
 *   sdxl       Juggernaut-XI (SDXL). OpenRAIL++-M, commercial use permitted.
 *              Not guidance-distilled, so it honours real CFG — the only
 *              profile here whose negative prompt actually does anything.
 *   schnell    FLUX.1-schnell fp8. Apache-2.0, commercial-safe, 4-step
 *              distilled. Fast, and the historical default.
 *   flux-dev   FLUX.1-dev fp8. **Non-commercial licence** — opt-in only, and
 *              not installed on the render hosts. Left here so a commercial
 *              licence can be switched on by configuration if one is bought.
 *
 * Select with COMFY_PROFILE. `supportsCfg` is the load-bearing field: a
 * distilled model runs at cfg 1.0, where classifier-free guidance cannot
 * subtract the negative branch, so its negative prompt is inert no matter what
 * it contains. Anatomy constraints therefore live in the POSITIVE prompt for
 * every profile, and the negative is an extra layer only where it works.
 */
const PROFILES = {
    sdxl: {
        family: 'sdxl',
        checkpoint: process.env.COMFY_SDXL_CHECKPOINT || 'Juggernaut-XI-byRunDiffusion.safetensors',
        steps: 30,
        cfg: 5.5,
        sampler: 'dpmpp_2m',
        scheduler: 'karras',
        supportsCfg: true,
        // The realism LoRA is a FLUX LoRA; applying it to SDXL would not load.
        realism: 0,
        realismLora: null,
        licence: 'commercial-ok',
    },
    schnell: {
        family: 'flux',
        checkpoint: process.env.COMFY_FLUX_CHECKPOINT || 'flux1-schnell-fp8.safetensors',
        steps: 4,
        guidance: 3.5,
        cfg: 1.0,
        sampler: 'euler',
        scheduler: 'simple',
        supportsCfg: false,
        realism: 0.7,
        realismLora: 'flux-realism.safetensors',
        licence: 'commercial-ok',
    },
    'flux-dev': {
        family: 'flux',
        checkpoint: process.env.COMFY_FLUX_DEV_CHECKPOINT || 'flux1-dev-fp8.safetensors',
        steps: 24,
        guidance: 3.5,
        cfg: 1.0,
        sampler: 'euler',
        scheduler: 'simple',
        supportsCfg: false,
        realism: 0.7,
        realismLora: 'flux-realism.safetensors',
        licence: 'non-commercial',
    },
};

/** Shared by every profile. */
const COMMON_DEFAULTS = {
    width: 1344,
    height: 768,
    fixHands: true,
    handModel: 'bbox/hand_yolov8s.pt',
    handSteps: 8,
    handDenoise: 0.6,
    handBbox: 0.3,
    handDilation: 16,
};

/**
 * The profile in force. Defaults to schnell until the Juggernaut bake-off has
 * run; set COMFY_PROFILE=sdxl to switch.
 */
const DEFAULT_PROFILE = process.env.COMFY_PROFILE || 'schnell';

/** Resolve a profile name to its settings. Unknown names fall back, loudly. */
function profile(name = DEFAULT_PROFILE) {
    const found = PROFILES[name];
    if (!found) {
        console.warn(`[comfy] unknown profile "${name}" — using schnell`);
        return { name: 'schnell', ...COMMON_DEFAULTS, ...PROFILES.schnell };
    }
    return { name, ...COMMON_DEFAULTS, ...found };
}

/**
 * Style and anatomy directives, appended to every positive prompt.
 *
 * These are positive on purpose. A distilled model ignores the negative prompt
 * entirely, so "five fingers" stated only as a negative ("no six fingers") does
 * nothing at all on schnell — which is how malformed hands kept shipping while
 * a long negative list sat in the config looking like a control.
 */
const STYLE_SUFFIX = ', photorealistic editorial photograph, dramatic natural lighting, consistent light direction, rich color depth, sharp focus, fine detail, professional press photography, anatomically correct anatomy, exactly five fingers and one thumb per hand, natural well-formed hands, one head per person, natural facial expression, correct body proportions, complete uncropped subjects';

/**
 * Negative prompt. Only reaches the sampler on profiles with `supportsCfg`;
 * `buildGraph` drops it elsewhere rather than pretending it applies.
 */
const NEGATIVE = 'nsfw, nude, bare skin, suggestive, sexual content, ugly, deformed, blurry, low quality, bad anatomy, malformed hands, mutated hands, six fingers, extra fingers, missing fingers, fused fingers, distorted hands, extra limbs, extra heads, two heads, duplicate person, cloned face, disfigured face, asymmetrical eyes, cropped limbs, text, watermark, logo, signature, gore, violence, dark ominous mood';

const MIN_PNG_BYTES = 10 * 1024;

// ── HTTP ─────────────────────────────────────────────────────────────────────

function request(method, url, { body, timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const payload = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = http.request({
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method,
            timeout,
            headers: payload
                ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
                : {},
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (payload) req.write(payload);
        req.end();
    });
}

async function reachable(baseUrl, timeout = 5000) {
    try {
        const r = await request('GET', `${baseUrl}/system_stats`, { timeout });
        return r.status === 200;
    } catch {
        return false;
    }
}

let _lanes = null;
let _lanesAt = 0;

/** Lanes answering right now, memoized briefly so a batch does not re-probe. */
async function liveLanes({ timeoutMs = 5000, ttlMs = 60000, force = false } = {}) {
    if (!force && _lanes && Date.now() - _lanesAt < ttlMs) return _lanes;
    const results = await Promise.all(COMFY_LANES.map(async u => (await reachable(u, timeoutMs)) ? u : null));
    _lanes = results.filter(Boolean);
    _lanesAt = Date.now();
    return _lanes;
}

/**
 * A queue that keeps exactly one job in flight per lane.
 *
 * The one-job-per-lane rule is stated at the top of this file; this is where it
 * is enforced, because best-of-N made the naive alternative expensive. Rendering
 * an article's candidates as their own batch leaves a lane idle whenever the
 * candidate count is not a multiple of the lane count — three candidates on two
 * lanes wastes a third of the wall clock, every article, all night.
 *
 * With a shared pool every article submits into the same queue, so a lane picks
 * up the next article's work the moment it frees rather than waiting for the
 * current article's slowest sibling.
 */
function createLanePool(lanes) {
    const free = [...lanes];
    const queue = [];

    function pump() {
        while (free.length && queue.length) {
            const lane = free.shift();
            const job = queue.shift();
            Promise.resolve()
                .then(() => job.run(lane))
                .then(job.resolve, job.reject)
                .finally(() => { free.push(lane); pump(); });
        }
    }

    return {
        lanes: [...lanes],
        size: lanes.length,
        pending: () => queue.length,
        /** @param {(lane: string) => Promise<any>} run */
        submit(run) {
            return new Promise((resolve, reject) => {
                queue.push({ run, resolve, reject });
                pump();
            });
        },
    };
}

// ── Graph ────────────────────────────────────────────────────────────────────

/**
 * Text-to-image graph for the selected profile.
 *
 * Two shapes, one function, because only three nodes differ:
 *
 *   flux  distilled — FluxGuidance carries the prompt strength, the sampler
 *         runs at cfg 1.0, and an SD3 latent feeds it. The negative branch is
 *         still wired (the sampler requires one) but has no influence.
 *   sdxl  not distilled — a plain SDXL latent, real CFG, and a negative prompt
 *         that genuinely steers away from the artifacts it names.
 *
 * The hand-repair pass is shared: it detects each hand with YOLO and re-renders
 * that region, and works the same either way.
 */
function buildGraph(prompt, seed, opts = {}) {
    const p = opts.profile ? profile(opts.profile) : profile();
    const o = { ...p, ...opts };
    const isSdxl = o.family === 'sdxl';
    // A negative prompt only reaches a sampler that can act on it.
    const negativeText = o.supportsCfg ? (o.negative ?? NEGATIVE) : '';
    const filenamePrefix = `jvnews_${seed}`;

    const g = {
        '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: o.checkpoint } },
        '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
        '5': { class_type: 'CLIPTextEncode', inputs: { text: negativeText, clip: ['1', 1] } },
        '7': {
            class_type: isSdxl ? 'EmptyLatentImage' : 'EmptySD3LatentImage',
            inputs: { width: o.width, height: o.height, batch_size: 1 },
        },
        '8': {
            class_type: 'KSampler',
            inputs: {
                model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['7', 0],
                seed,
                steps: o.steps,
                cfg: o.supportsCfg ? o.cfg : 1.0,
                sampler_name: o.sampler,
                scheduler: o.scheduler,
                denoise: 1.0,
            },
        },
        '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['1', 2] } },
        '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: filenamePrefix } },
    };

    // FLUX takes its prompt strength through FluxGuidance rather than CFG.
    if (!isSdxl) {
        g['6'] = { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: o.guidance } };
        g['8'].inputs.positive = ['6', 0];
    }

    if (o.realism > 0 && o.realismLora) {
        g['11'] = {
            class_type: 'LoraLoaderModelOnly',
            inputs: { model: ['1', 0], lora_name: o.realismLora, strength_model: o.realism },
        };
        g['8'].inputs.model = ['11', 0];
    }

    if (o.fixHands) {
        const modelRef = (o.realism > 0 && o.realismLora) ? ['11', 0] : ['1', 0];
        // The repair pass must condition exactly as the sampler did: through
        // FluxGuidance on a distilled profile, straight off the encoder on SDXL.
        const positiveRef = isSdxl ? ['4', 0] : ['6', 0];
        g['12'] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: o.handModel } };
        g['13'] = {
            class_type: 'FaceDetailer',
            inputs: {
                image: ['9', 0], model: modelRef, clip: ['1', 1], vae: ['1', 2],
                positive: positiveRef, negative: ['5', 0], bbox_detector: ['12', 0],
                guide_size: 512, guide_size_for: true, max_size: 1024,
                seed,
                steps: o.handSteps,
                cfg: o.supportsCfg ? o.cfg : 1.0,
                sampler_name: o.sampler,
                scheduler: o.scheduler,
                denoise: o.handDenoise, feather: 5, noise_mask: true, force_inpaint: true,
                bbox_threshold: o.handBbox, bbox_dilation: o.handDilation, bbox_crop_factor: 3.0,
                sam_detection_hint: 'center-1', sam_dilation: 0, sam_threshold: 0.93,
                sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7, sam_mask_hint_use_negative: 'False',
                drop_size: 10, wildcard: '', cycle: 1,
            },
        };
        g['10'].inputs.images = ['13', 0];   // save the hand-corrected image
    }

    return g;
}

// ── Generation ───────────────────────────────────────────────────────────────

function isValidPng(buf) {
    return Buffer.isBuffer(buf)
        && buf.length >= MIN_PNG_BYTES
        && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Render one prompt on one lane and return the PNG bytes.
 *
 * @param {string} prompt
 * @param {object} options
 * @param {string} options.lane        base URL of the ComfyUI instance
 * @param {number} [options.seed]      omit for a random seed; pass one to reproduce
 * @param {object} [options.opts]      profile overrides, incl. `profile: 'sdxl'`
 * @param {number} [options.timeoutMs] wall clock for the whole job
 * @returns {Promise<{buffer: Buffer, seed: number, lane: string, ms: number, profile: string}>}
 */
async function generateImage(prompt, { lane, seed, opts = {}, timeoutMs = 180000 } = {}) {
    if (!lane) throw new Error('generateImage requires a lane');
    const t0 = Date.now();
    const useSeed = Number.isInteger(seed) ? seed : crypto.randomInt(1, 2 ** 31);
    const styled = `${prompt}${STYLE_SUFFIX}`;
    const active = opts.profile ? profile(opts.profile) : profile();

    const sub = await request('POST', `${lane}/prompt`, {
        body: { prompt: buildGraph(styled, useSeed, opts), client_id: crypto.randomUUID() },
        timeout: 30000,
    });
    if (sub.status !== 200) {
        throw new Error(`/prompt HTTP ${sub.status}: ${sub.buf.toString().slice(0, 200)}`);
    }
    const promptId = JSON.parse(sub.buf.toString()).prompt_id;
    if (!promptId) throw new Error('ComfyUI returned no prompt_id');

    let out = null;
    const deadline = t0 + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(2000);
        let hist;
        try {
            const h = await request('GET', `${lane}/history/${promptId}`, { timeout: 15000 });
            if (h.status !== 200) continue;
            hist = JSON.parse(h.buf.toString() || '{}');
        } catch {
            continue;   // transient; the job is still queued on the GPU
        }
        const rec = hist[promptId];
        if (!rec) continue;
        if (rec.status?.status_str === 'error') {
            throw new Error(`ComfyUI job failed: ${JSON.stringify(rec.status.messages || []).slice(0, 200)}`);
        }
        for (const node of Object.values(rec.outputs || {})) {
            if (node.images?.[0]) { out = node.images[0]; break; }
        }
        if (out) break;
    }
    if (!out) throw new Error(`timed out after ${Math.round((Date.now() - t0) / 1000)}s`);

    const q = `filename=${encodeURIComponent(out.filename)}`
        + `&subfolder=${encodeURIComponent(out.subfolder || '')}`
        + `&type=${encodeURIComponent(out.type || 'output')}`;
    const img = await request('GET', `${lane}/view?${q}`, { timeout: 60000 });
    if (img.status !== 200) throw new Error(`/view HTTP ${img.status}`);
    if (!isValidPng(img.buf)) throw new Error(`not a usable PNG (${img.buf.length} bytes)`);

    return { buffer: img.buf, seed: useSeed, lane, ms: Date.now() - t0, profile: active.name };
}

module.exports = {
    COMFY_LANES,
    PROFILES,
    COMMON_DEFAULTS,
    DEFAULT_PROFILE,
    profile,
    STYLE_SUFFIX,
    NEGATIVE,
    MIN_PNG_BYTES,
    request,
    reachable,
    liveLanes,
    createLanePool,
    buildGraph,
    generateImage,
    isValidPng,
};

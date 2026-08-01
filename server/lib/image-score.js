'use strict';
/**
 * lib/image-score.js — Deterministic structural scoring gate for rendered images.
 *
 * Step 3 of docs/IMAGE-QUALITY-PIPELINE.md. The pipeline had exactly one
 * automated gate — NudeNet, which only answers "is this nudity". Nothing looked
 * at anatomy, focus, exposure or framing, so six-fingered hands and two-headed
 * people reached the CDN with a clean bill of health. MIN_PNG_BYTES only ever
 * proved the file was not truncated.
 *
 * No LLM is involved here, by design. This gate must return the same verdict for
 * the same bytes every time so the Step 4 judge and the final bake-off compare
 * profiles against a fixed ruler. Claude's opinion arrives in Step 4; this is the
 * ruler.
 *
 * Two measurement channels, deliberately split by what each one needs:
 *
 *   detection   YOLO inside ComfyUI (UltralyticsDetectorProvider -> *DetectorSEGS).
 *               Needs a GPU lane. Yields hand/face/person geometry.
 *   local       sharp statistics on the buffer we already hold. Needs nothing.
 *               Yields focus, exposure, contrast and detail.
 *
 * Detection runs inside ComfyUI rather than beside the NudeNet classifier
 * because `D:\inspire-imgsafe` is deliberately torch-free so the Wan video venv
 * is unaffected (CLAUDE.md). ComfyUI already has YOLO loaded; adding torch to
 * the safety venv to duplicate it would put the video pipeline at risk for
 * nothing.
 *
 * Because the two channels are independent, a dead lane degrades this gate to
 * local-only instead of switching it off — blur and blown exposure are still
 * caught with every GPU on the floor down.
 *
 * ── Getting numbers out of ComfyUI ──────────────────────────────────────────
 *
 * ComfyUI returns images, not JSON, so the detector's boxes have to come back as
 * pixels. `ImpactSEGSToMaskList` is the one node that makes this exact: it
 * declares `output_is_list`, so a SEGS of N detections drives MaskToImage N
 * times and PreviewImage collects N full-canvas masks — one detection each,
 * white box on black. Reading the white extent back gives the true bbox.
 *
 * Verified on a two-person food-bank render: 4 hand masks, each 1344x768, boxes
 * [546,500,670,670] [673,459,846,623] [182,550,336,703] [1029,452,1219,608].
 * `SegsToCombinedMask` was rejected for this: it unions every detection into one
 * mask, so two adjacent faces merge into a single box and the count — the whole
 * point — is lost.
 */

const http = require('http');
const crypto = require('crypto');

const { liveLanes } = require('./comfy-client');

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * enforce: a failing image is withheld.  warn: score, log, publish anyway.
 * off: skip entirely.
 *
 * Defaults to `warn`, unlike the safety gate's `enforce`. Nudity is a hard line
 * worth failing closed on; quality is a threshold whose numbers are provisional
 * until the Step 4 judge calibrates them, and a mis-set threshold in enforce
 * mode silently empties the site. Flip to enforce once the bake-off has run.
 */
const MODE = (process.env.NEWS_SCORE_MODE || 'warn').toLowerCase();

/** Score at or above which an image passes, absent a fatal flag. */
const MIN_SCORE = Number(process.env.NEWS_SCORE_MIN || 70);

/**
 * Detectors, by role. `model` is matched against what the render host actually
 * has installed, so a missing model degrades the gate rather than failing it.
 *
 * Only `bbox/hand_yolov8s.pt` ships with the current install. face and person
 * are pending an owner-approved install on 10.0.0.52 (see the Step 3 section of
 * docs/IMAGE-QUALITY-PIPELINE.md); every rule that needs them is written, tested
 * and inert until they appear, and `partial` records their absence in the
 * verdict rather than quietly scoring as though the check had passed.
 *
 * The hand threshold stays at the repair pass's 0.3 on evidence, not by
 * inheritance. Swept over the calibration set at 0.3/0.4/0.5/0.6/0.7, every
 * detection held its confidence flat until 0.7, where a real hand in a
 * two-person scene dropped out. Nothing was gained in between: the one
 * suspicious detection — a hand across an "empty street" render — was correct,
 * and survived every threshold, because the image really did contain one.
 */
const DETECTORS = {
    hand: { match: /hand/i, family: 'bbox', threshold: 0.3 },
    face: { match: /face/i, family: 'bbox', threshold: 0.5 },
    person: { match: /person/i, family: 'either', threshold: 0.5 },
};

/**
 * Flags that fail an image outright, whatever the arithmetic says.
 *
 * These are the artifacts with no benign reading: a body with two heads, or the
 * same face stamped twice in one frame. A merely low score can still be the best
 * of three candidates in Step 4 — these can never be.
 */
const FATAL_FLAGS = new Set(['extra-heads', 'duplicate-person', 'cloned-face']);

/**
 * Penalty per flag. Provisional: set from the measured spread over real renders
 * (see the calibration note in the pipeline doc), to be revisited when Step 4
 * can score them against a vision judge's opinion.
 */
const FLAG_WEIGHTS = {
    'extra-hands': 25,
    'distorted-face': 25,
    'hand-closeup': 15,
    // Enough to fail an image on its own. A hand this large is the defect, not a
    // blemish on one — see the note on HAND_DOMINANT_AREA.
    'hand-dominates': 40,
    'cropped-face': 15,
    // A blurred render is unusable at any size, so its penalty must clear
    // MIN_SCORE on its own: at 30 it landed on exactly 70 and passed the bar.
    blurry: 40,
    flat: 15,
};

/**
 * Local-metric thresholds, measured rather than guessed.
 *
 * Every number here is the midpoint of a measured gap between good renders and
 * deliberately degraded copies of the same renders; re-derive with
 * scripts/calibrate-image-score.js when the profile changes, because the
 * population changes with it.
 *
 * The first pass at these was guessed, and the guesses were not close:
 * `sharpness: 2.2` sat above every good render in the set (1.05-1.39), so in
 * enforce mode it would have withheld every image the pipeline produced.
 *
 * Only two local metrics survived measurement. Exposure and detail were dropped
 * rather than tuned, because the data shows no threshold exists:
 *
 *   mean luma   A candle-lit chapel (luma 18.5) is legitimately darker than a
 *               bright scene crushed to a quarter brightness (24.9-31.0).
 *   clipping    Measuring lost detail instead of brightness does not rescue it:
 *               that same chapel clips 74.9% of its pixels to black by design,
 *               while good daylight renders clip up to 4.4% of highlights to
 *               white through windows. The populations overlap end to end.
 *   entropy     The chapel reads 3.02, below the flattened copies of brighter
 *               scenes (5.37-5.77). The rule would fire on the most atmospheric
 *               images in the set.
 *
 * All three stay in `metrics` because Step 4's judge and the final bake-off want
 * the numbers; they simply do not gate. Telling a dark scene from a broken one
 * needs to know what the scene is, which is exactly what a vision judge adds and
 * a threshold cannot. Degenerate cases are not lost with them: a blown-white or
 * crushed-black frame has almost no channel spread, so `flat` still catches it.
 */
const LIMITS = {
    sharpness: Number(process.env.IMGSCORE_SHARPNESS || 0.6),
    contrast: Number(process.env.IMGSCORE_CONTRAST || 25),
};

/** Luma at or below / above which a pixel has lost its detail to clipping. */
const CLIP_LOW = 4;
const CLIP_HIGH = 251;

/**
 * Hand size as a share of frame, in two tiers, because the failure is graduated.
 *
 * Measured over the calibration renders: hands in working images occupied 1.2%,
 * 2.1%, 2.2%, 2.3%, 2.8%, 2.9%, 6.6% and 10.1% of frame. One render — prompted
 * for "an empty small-town main street", with no person requested at all —
 * produced a single malformed hand across 22.5% of the frame and nothing else of
 * the subject. Nothing legitimate in the set came close to that.
 *
 * So `hand-closeup` (>12%) is a warning that the composition drifted toward the
 * house rule against foreground hands, while `hand-dominates` (>20%) is a
 * failure on its own: at that size the hand has become the subject.
 */
const HAND_CLOSEUP_AREA = 0.12;
const HAND_DOMINANT_AREA = 0.20;

/** Face aspect ratio (w/h) outside this range is a distortion, not a pose. */
const FACE_ASPECT = { min: 0.6, max: 1.7 };

/** Distance from the frame edge, in px, at which a box counts as cropped. */
const EDGE_PX = 3;

/** Hamming distance between two 64-bit dHashes at or below which they match. */
const DUPLICATE_HAMMING = 5;

/** Detections per role beyond which we stop downloading masks. */
const MAX_DETECTIONS = 12;

// ── HTTP ─────────────────────────────────────────────────────────────────────

/**
 * Raw request. comfy-client's `request` JSON-encodes its body, which cannot
 * express the multipart upload this module needs, so transport is local.
 */
function req(method, url, { body = null, headers = {}, timeout = 60000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const r = http.request({
            hostname: u.hostname, port: u.port, path: u.pathname + u.search,
            method, timeout, headers,
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
            res.on('error', reject);
        });
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
        if (body) r.write(body);
        r.end();
    });
}

const _detectorCache = new Map();

/**
 * Which detector models this lane actually has, by role.
 *
 * Read from the live node definition rather than assumed: ComfyUI validates a
 * widget value against this enum, so naming a model that is not installed fails
 * the whole prompt. Asking first turns "missing model" into a degraded check
 * instead of a hard error mid-run.
 */
async function availableDetectors(lane, { force = false } = {}) {
    if (!force && _detectorCache.has(lane)) return _detectorCache.get(lane);

    const r = await req('GET', `${lane}/object_info/UltralyticsDetectorProvider`, { timeout: 15000 });
    if (r.status !== 200) throw new Error(`object_info HTTP ${r.status}`);
    const installed = JSON.parse(r.buf.toString())
        .UltralyticsDetectorProvider.input.required.model_name[0];

    const found = {};
    for (const [role, spec] of Object.entries(DETECTORS)) {
        // Prefer a bbox model even where a segm one would serve: BboxDetectorSEGS
        // returns a rectangle, which is all the geometry rules use, and skips the
        // mask work a segm model would spend on every detection.
        const hits = installed.filter(m => spec.match.test(m));
        const bbox = hits.find(m => m.startsWith('bbox/'));
        const segm = hits.find(m => m.startsWith('segm/'));
        const model = spec.family === 'bbox' ? bbox : (bbox || segm);
        found[role] = model
            ? { model, family: model.startsWith('segm/') ? 'segm' : 'bbox', threshold: spec.threshold }
            : null;
    }
    _detectorCache.set(lane, found);
    return found;
}

/**
 * Put an image where LoadImage can see it.
 *
 * The upload name is the content hash, which makes this idempotent: re-scoring
 * the same bytes — a retry, a re-run after a crash — overwrites one file rather
 * than accumulating one per attempt, and a name collision can only ever mean
 * identical content, so no scoring job can be handed another job's image. Two
 * processes scoring at once is otherwise a real hazard here, and a random name
 * would trade that for unbounded growth in ComfyUI's input directory.
 *
 * That directory is still append-only across distinct images and wants periodic
 * pruning; ComfyUI exposes no delete endpoint to do it from here.
 */
async function uploadImage(lane, buffer) {
    const name = `jvscore_${crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16)}.png`;
    const boundary = `----jvscore${crypto.randomBytes(8).toString('hex')}`;
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\n`
            + 'Content-Type: image/png\r\n\r\n'),
        buffer,
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n`
            + `--${boundary}--\r\n`),
    ]);

    const r = await req('POST', `${lane}/upload/image`, {
        body,
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
        },
        timeout: 60000,
    });
    if (r.status !== 200) throw new Error(`/upload/image HTTP ${r.status}`);
    const j = JSON.parse(r.buf.toString());
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

// ── Graph ────────────────────────────────────────────────────────────────────

/**
 * One detection branch per installed role, all reading the same LoadImage.
 *
 * Detection settings are deliberately not the generator's: `dilation: 0` and
 * `crop_factor: 1.0` keep the mask on the detector's own box, because this
 * measures the box rather than repairing what is inside it. comfy-client's
 * repair pass dilates by 16 and crops at 3.0 for the opposite reason.
 *
 * `labels: 'all'` is required, not optional — omitting it fails validation with
 * `required_input_missing: labels`.
 */
function detectionGraph(imageRef, detectors) {
    const graph = {
        '1': { class_type: 'LoadImage', inputs: { image: imageRef, upload: 'image' } },
    };
    const previewNodes = {};
    let next = 10;

    for (const [role, d] of Object.entries(detectors)) {
        if (!d) continue;
        const provider = String(next++);
        const segs = String(next++);
        const masks = String(next++);
        const toImage = String(next++);
        const preview = String(next++);

        graph[provider] = {
            class_type: 'UltralyticsDetectorProvider',
            inputs: { model_name: d.model },
        };
        // UltralyticsDetectorProvider returns [BBOX_DETECTOR, SEGM_DETECTOR];
        // a segm model only populates the second.
        graph[segs] = d.family === 'segm'
            ? {
                class_type: 'SegmDetectorSEGS',
                inputs: {
                    segm_detector: [provider, 1], image: ['1', 0],
                    threshold: d.threshold, dilation: 0, crop_factor: 1.0,
                    drop_size: 10, labels: 'all',
                },
            }
            : {
                class_type: 'BboxDetectorSEGS',
                inputs: {
                    bbox_detector: [provider, 0], image: ['1', 0],
                    threshold: d.threshold, dilation: 0, crop_factor: 1.0,
                    drop_size: 10, labels: 'all',
                },
            };
        graph[masks] = { class_type: 'ImpactSEGSToMaskList', inputs: { segs: [segs, 0] } };
        graph[toImage] = { class_type: 'MaskToImage', inputs: { mask: [masks, 0] } };
        graph[preview] = { class_type: 'PreviewImage', inputs: { images: [toImage, 0] } };
        previewNodes[role] = preview;
    }

    return { graph, previewNodes };
}

/** Submit a graph and wait for its history record. */
async function runGraph(lane, graph, { timeoutMs = 120000 } = {}) {
    const sub = await req('POST', `${lane}/prompt`, {
        body: Buffer.from(JSON.stringify({ prompt: graph, client_id: crypto.randomUUID() })),
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
    });
    if (sub.status !== 200) {
        throw new Error(`/prompt HTTP ${sub.status}: ${sub.buf.toString().slice(0, 200)}`);
    }
    const promptId = JSON.parse(sub.buf.toString()).prompt_id;
    if (!promptId) throw new Error('ComfyUI returned no prompt_id');

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1000));
        let rec;
        try {
            const h = await req('GET', `${lane}/history/${promptId}`, { timeout: 15000 });
            if (h.status !== 200) continue;
            rec = JSON.parse(h.buf.toString() || '{}')[promptId];
        } catch {
            continue;   // transient; the job is still queued behind a render
        }
        if (!rec) continue;
        if (rec.status?.status_str === 'error') {
            throw new Error(`detection failed: ${JSON.stringify(rec.status.messages || []).slice(0, 200)}`);
        }
        if (rec.status?.completed) return rec;
    }
    throw new Error(`detection timed out after ${Math.round(timeoutMs / 1000)}s`);
}

// ── Pixels ───────────────────────────────────────────────────────────────────

/**
 * The white extent of a detection mask, or null if the mask is empty.
 *
 * A whole-canvas scan rather than sharp's `trim()`: trim infers its background
 * from the corner pixel and would read a detection touching the top-left corner
 * as background. At ~1 ms per megapixel mask this is not worth outsmarting.
 */
async function maskBoundingBox(png) {
    const sharp = require('sharp');
    const { data, info } = await sharp(png).greyscale().raw()
        .toBuffer({ resolveWithObject: true });

    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < info.height; y++) {
        const row = y * info.width;
        for (let x = 0; x < info.width; x++) {
            if (data[row + x] > 127) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) return null;
    return {
        x0, y0, x1, y1,
        w: x1 - x0 + 1,
        h: y1 - y0 + 1,
        frame: { width: info.width, height: info.height },
    };
}

/**
 * 64-bit difference hash of a region, for spotting the same person rendered
 * twice. Structural rather than exact: a clone is never bit-identical, but its
 * 8x8 luminance gradient is.
 */
async function regionHash(buffer, box) {
    const sharp = require('sharp');
    const { data } = await sharp(buffer)
        .extract({ left: box.x0, top: box.y0, width: box.w, height: box.h })
        .greyscale().resize(9, 8, { fit: 'fill' }).raw()
        .toBuffer({ resolveWithObject: true });

    let bits = 0n;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const i = y * 9 + x;
            bits = (bits << 1n) | (data[i] > data[i + 1] ? 1n : 0n);
        }
    }
    return bits;
}

function hamming(a, b) {
    let v = a ^ b;
    let n = 0;
    while (v) { n += Number(v & 1n); v >>= 1n; }
    return n;
}

/**
 * Focus, exposure, contrast and detail, straight off the buffer.
 *
 * Exposure is measured as the share of pixels clipped to pure black or pure
 * white — detail that no longer exists — rather than as mean brightness. A dim
 * frame is a legitimate artistic choice; a frame where a tenth of the pixels are
 * crushed to zero is a broken render, and only the second is a defect.
 */
async function localMetrics(buffer) {
    const sharp = require('sharp');
    const st = await sharp(buffer).stats();
    const [r, g, b] = st.channels;

    // greyscale() applies Rec. 601 weighting, so the clip counts follow
    // perceived brightness rather than any single channel.
    const { data } = await sharp(buffer).greyscale().raw()
        .toBuffer({ resolveWithObject: true });
    let shadow = 0;
    let highlight = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] <= CLIP_LOW) shadow++;
        else if (data[i] >= CLIP_HIGH) highlight++;
    }

    return {
        luma: 0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean,
        contrast: (r.stdev + g.stdev + b.stdev) / 3,
        sharpness: st.sharpness,
        entropy: st.entropy,
        shadowClip: shadow / data.length,
        highlightClip: highlight / data.length,
    };
}

// ── Rules ────────────────────────────────────────────────────────────────────

const centre = box => ({ x: box.x0 + box.w / 2, y: box.y0 + box.h / 2 });
const contains = (outer, p) => p.x >= outer.x0 && p.x <= outer.x1 && p.y >= outer.y0 && p.y <= outer.y1;

/**
 * Structural flags from detection geometry. Pure, so the rules are testable
 * without a GPU — which matters, because CI has no lane.
 *
 * The counting rules are per-person on purpose. "More faces than people" reads
 * a crowd where one person went undetected as a defect; "two face centres inside
 * one person box" is a body with two heads and very little else.
 *
 * @param {{hand?: object[], face?: object[], person?: object[]}} boxes
 * @param {{width: number, height: number}} frame
 * @param {{personHashes?: bigint[], faceHashes?: bigint[]}} hashes
 */
function gradeDetections(boxes, frame, hashes = {}) {
    const flags = [];
    const hands = boxes.hand || [];
    const faces = boxes.face || [];
    const people = boxes.person || [];

    for (const person of people) {
        const facesOn = faces.filter(f => contains(person, centre(f))).length;
        const handsOn = hands.filter(h => contains(person, centre(h))).length;
        if (facesOn > 1) flags.push('extra-heads');
        if (handsOn > 2) flags.push('extra-hands');
    }

    for (const face of faces) {
        const aspect = face.w / face.h;
        if (aspect < FACE_ASPECT.min || aspect > FACE_ASPECT.max) flags.push('distorted-face');
        // A face against the frame edge is a beheading, not a crop choice.
        if (face.x0 <= EDGE_PX || face.y0 <= EDGE_PX
            || face.x1 >= frame.width - 1 - EDGE_PX || face.y1 >= frame.height - 1 - EDGE_PX) {
            flags.push('cropped-face');
        }
    }

    // Hands fail hardest when they dominate the frame. The tiers are exclusive:
    // a dominating hand is not also merely a close-up.
    const frameArea = frame.width * frame.height;
    for (const hand of hands) {
        const share = (hand.w * hand.h) / frameArea;
        if (share > HAND_DOMINANT_AREA) flags.push('hand-dominates');
        else if (share > HAND_CLOSEUP_AREA) flags.push('hand-closeup');
    }

    for (const [kind, list] of [['duplicate-person', hashes.personHashes], ['cloned-face', hashes.faceHashes]]) {
        const hs = list || [];
        for (let i = 0; i < hs.length; i++) {
            for (let j = i + 1; j < hs.length; j++) {
                if (hamming(hs[i], hs[j]) <= DUPLICATE_HAMMING) flags.push(kind);
            }
        }
    }

    return [...new Set(flags)];
}

/** Flags from the local statistics. Pure, for the same reason. */
function gradeLocal(metrics, limits = LIMITS) {
    const flags = [];
    if (metrics.sharpness < limits.sharpness) flags.push('blurry');
    if (metrics.contrast < limits.contrast) flags.push('flat');
    return flags;
}

/**
 * Fold flags into a verdict.
 *
 * A fatal flag drops the score to 0 rather than merely failing the boolean, so
 * Step 4's best-of-3 selection cannot rank a two-headed candidate above a merely
 * soft-focus one on arithmetic.
 */
function verdictFrom(flags, { minScore = MIN_SCORE, partial = false, ...rest } = {}) {
    const unique = [...new Set(flags)];
    const fatal = unique.filter(f => FATAL_FLAGS.has(f));
    const penalty = unique.reduce((sum, f) => sum + (FLAG_WEIGHTS[f] || 0), 0);
    const score = fatal.length ? 0 : Math.max(0, 100 - penalty);
    return { ok: !fatal.length && score >= minScore, score, flags: unique, fatal, partial, ...rest };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score one image. Detection is skipped — not failed — when no lane is given.
 *
 * @returns {Promise<object>} verdict: {ok, score, flags, fatal, partial, metrics, detectors}
 */
async function scoreBuffer(buffer, { lane = null, minScore = MIN_SCORE, logger = console } = {}) {
    const metrics = await localMetrics(buffer);
    const flags = gradeLocal(metrics);

    if (!lane) {
        return verdictFrom(flags, {
            minScore, partial: true, metrics, detectors: {},
            note: 'no lane — local metrics only',
        });
    }

    const boxes = {};
    // `used` keeps its empty default for the catch below, which reports whatever
    // was resolved before the failure. `partial` is only ever read after the try
    // block has set it, so an initial value here would be dead.
    let used = {};
    let partial;
    try {
        const detectors = await availableDetectors(lane);
        used = Object.fromEntries(Object.entries(detectors).map(([k, v]) => [k, v ? v.model : null]));
        partial = Object.values(detectors).some(d => !d);

        const active = Object.fromEntries(Object.entries(detectors).filter(([, v]) => v));
        if (!Object.keys(active).length) {
            return verdictFrom(flags, {
                minScore, partial: true, metrics, detectors: used,
                note: 'no detector models installed',
            });
        }

        const imageRef = await uploadImage(lane, buffer);
        const { graph, previewNodes } = detectionGraph(imageRef, active);
        const rec = await runGraph(lane, graph);

        for (const [role, nodeId] of Object.entries(previewNodes)) {
            // No output for a node means the SEGS was empty: nothing detected,
            // which is a legitimate result and not an error.
            const images = rec.outputs?.[nodeId]?.images || [];
            const found = [];
            for (const img of images.slice(0, MAX_DETECTIONS)) {
                const q = `filename=${encodeURIComponent(img.filename)}`
                    + `&subfolder=${encodeURIComponent(img.subfolder || '')}`
                    + `&type=${encodeURIComponent(img.type || 'temp')}`;
                const m = await req('GET', `${lane}/view?${q}`, { timeout: 30000 });
                if (m.status !== 200) continue;
                const box = await maskBoundingBox(m.buf);
                if (box) found.push(box);
            }
            boxes[role] = found;
        }
    } catch (e) {
        logger.warn(`[score] detection unavailable: ${e.message}`);
        return verdictFrom(flags, {
            minScore, partial: true, metrics, detectors: used,
            note: `detection failed: ${e.message}`,
        });
    }

    const frame = (boxes.hand?.[0] || boxes.face?.[0] || boxes.person?.[0])?.frame
        || { width: 0, height: 0 };

    const hashes = {};
    if (boxes.person?.length > 1) {
        hashes.personHashes = await Promise.all(boxes.person.map(b => regionHash(buffer, b)));
    }
    if (boxes.face?.length > 1) {
        hashes.faceHashes = await Promise.all(boxes.face.map(b => regionHash(buffer, b)));
    }

    flags.push(...gradeDetections(boxes, frame, hashes));

    return verdictFrom(flags, {
        minScore, partial, metrics, detectors: used,
        counts: Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, v.length])),
    });
}

/**
 * Score a batch, mirroring image-safety's `screen` so the publish path consumes
 * a quality verdict exactly as it consumes a safety one.
 *
 * Work is spread one image at a time per lane: each ComfyUI instance owns a GPU
 * and queues internally, so submitting more per lane buys queueing, not speed.
 *
 * @param {Array<{name: string, buffer: Buffer}>} images
 * @returns {Promise<{verdicts: Map<string, object>, mode: string, scored: boolean}>}
 */
async function screen(images, { mode = MODE, lanes = null, minScore = MIN_SCORE, logger = console } = {}) {
    const verdicts = new Map();

    if (mode === 'off') {
        images.forEach(i => verdicts.set(i.name, {
            ok: true, score: 100, flags: [], fatal: [], skipped: true,
        }));
        return { verdicts, mode, scored: false };
    }

    const available = lanes || await liveLanes();
    if (!available.length) {
        logger.warn('[score] no ComfyUI lane reachable — scoring on local metrics only');
    }

    // With no lane, everything still runs: local metrics need no GPU. `pool` is
    // then a single null "lane", which keeps one code path instead of two.
    const pool = available.length ? available : [null];
    let cursor = 0;
    await Promise.all(pool.map(async (lane) => {
        for (;;) {
            const item = images[cursor++];
            if (!item) return;
            try {
                verdicts.set(item.name, await scoreBuffer(item.buffer, { lane, minScore, logger }));
            } catch (e) {
                // Fail open on an unexpected error: this gate exists to catch bad
                // images, and must not become a way to lose good ones. `enforce`
                // still has the flags it did manage to collect.
                verdicts.set(item.name, {
                    ok: mode !== 'enforce', score: 0, flags: [], fatal: [],
                    partial: true, error: e.message,
                });
            }
        }
    }));

    const failed = [...verdicts.entries()].filter(([, v]) => !v.ok);
    if (failed.length) {
        logger.warn(`[score] ${failed.length}/${images.length} below the bar: `
            + failed.map(([n, v]) => `${n}(${v.flags.join('/') || v.error || 'score ' + v.score})`).join(', '));
    } else {
        logger.log(`[score] ${images.length} image(s) cleared`);
    }

    return { verdicts, mode, scored: available.length > 0 };
}

module.exports = {
    MODE,
    MIN_SCORE,
    DETECTORS,
    FATAL_FLAGS,
    FLAG_WEIGHTS,
    LIMITS,
    CLIP_LOW,
    CLIP_HIGH,
    HAND_CLOSEUP_AREA,
    HAND_DOMINANT_AREA,
    FACE_ASPECT,
    EDGE_PX,
    DUPLICATE_HAMMING,
    availableDetectors,
    uploadImage,
    detectionGraph,
    runGraph,
    maskBoundingBox,
    regionHash,
    hamming,
    localMetrics,
    gradeDetections,
    gradeLocal,
    verdictFrom,
    scoreBuffer,
    screen,
};

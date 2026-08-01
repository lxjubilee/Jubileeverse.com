'use strict';
/**
 * The structural scoring gate — rules, graph, and geometry.
 *
 * Everything here runs without a GPU on purpose. The detection channel needs a
 * ComfyUI lane, which CI does not have, so the rules are pure functions over
 * boxes and the tests feed them boxes directly. What cannot be covered here is
 * whether ComfyUI returns the boxes we think it does; that was verified live and
 * is recorded in the module header.
 *
 * The threshold tests carry the numbers measured by
 * scripts/calibrate-image-score.js. They exist because the first set of
 * thresholds was guessed, and a guessed blur limit of 2.2 sat above every real
 * render — in enforce mode it would have withheld the site's entire image feed.
 * If someone re-guesses them, these fail.
 */

const Score = require('../../lib/image-score');

const FRAME = { width: 1344, height: 768 };
const box = (x0, y0, w, h) => ({ x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, w, h, frame: FRAME });

/** Measured on the calibration set — good renders and degraded copies. */
const MEASURED = {
    good: [
        { name: 'volunteers', sharpness: 1.39, contrast: 66.27, luma: 100.92, entropy: 7.49 },
        { name: 'congregation', sharpness: 1.05, contrast: 65.48, luma: 85.08, entropy: 7.37 },
        { name: 'street', sharpness: 1.19, contrast: 69.04, luma: 125.54, entropy: 7.76 },
        { name: 'candlelit', sharpness: 1.17, contrast: 39.19, luma: 18.51, entropy: 3.02 },
    ],
    degraded: [
        { name: 'blurred', sharpness: 0.16, contrast: 63.58 },
        { name: 'soft', sharpness: 0.24, contrast: 65.78 },
        { name: 'crushed', sharpness: 0.38, contrast: 16.56 },
    ],
};

describe('local metric thresholds', () => {
    test('every good render measured clears the bar', () => {
        for (const m of MEASURED.good) {
            expect(Score.gradeLocal(m)).toEqual([]);
        }
    });

    test('every degraded copy is caught', () => {
        for (const m of MEASURED.degraded) {
            expect(Score.gradeLocal(m).length).toBeGreaterThan(0);
        }
    });

    test('the blur limit sits below the softest good render, with margin', () => {
        const softestGood = Math.min(...MEASURED.good.map(m => m.sharpness));
        const sharpestBad = Math.max(...MEASURED.degraded.map(m => m.sharpness));
        expect(Score.LIMITS.sharpness).toBeLessThan(softestGood);
        expect(Score.LIMITS.sharpness).toBeGreaterThan(sharpestBad);
    });

    test('blur alone fails an image — at weight 30 it landed exactly on the bar', () => {
        const v = Score.verdictFrom(['blurry']);
        expect(v.ok).toBe(false);
        expect(v.score).toBeLessThan(Score.MIN_SCORE);
    });

    test('a dark scene is not a defect: luma and entropy do not gate', () => {
        // The candle render is the darkest and least detailed in the set and is
        // still a good image. Any rule keyed on brightness would reject it.
        const candle = MEASURED.good.find(m => m.name === 'candlelit');
        expect(Score.gradeLocal(candle)).toEqual([]);
        expect(Score.LIMITS.lumaLow).toBeUndefined();
        expect(Score.LIMITS.entropy).toBeUndefined();
    });
});

describe('anatomy rules', () => {
    const person = box(400, 100, 300, 600);

    test('two faces inside one body is an extra head', () => {
        const boxes = { person: [person], face: [box(430, 130, 80, 90), box(560, 130, 80, 90)] };
        expect(Score.gradeDetections(boxes, FRAME)).toContain('extra-heads');
    });

    test('one face per person is not', () => {
        const boxes = { person: [person], face: [box(470, 130, 80, 90)] };
        expect(Score.gradeDetections(boxes, FRAME)).not.toContain('extra-heads');
    });

    test('a crowd with an undetected person is not an extra head', () => {
        // The rule counts faces per body, not faces against a global head count,
        // precisely so a missed body does not read as a defect.
        const boxes = { person: [person], face: [box(470, 130, 80, 90), box(1000, 130, 80, 90)] };
        expect(Score.gradeDetections(boxes, FRAME)).not.toContain('extra-heads');
    });

    test('a third hand on one body is flagged', () => {
        const hands = [box(410, 400, 60, 60), box(500, 400, 60, 60), box(620, 400, 60, 60)];
        expect(Score.gradeDetections({ person: [person], hand: hands }, FRAME)).toContain('extra-hands');
        expect(Score.gradeDetections({ person: [person], hand: hands.slice(0, 2) }, FRAME))
            .not.toContain('extra-hands');
    });

    test('hand size is graduated, and the tiers are exclusive', () => {
        const area = FRAME.width * FRAME.height;
        const sized = share => {
            const side = Math.round(Math.sqrt(area * share));
            return box(100, 100, side, side);
        };
        expect(Score.gradeDetections({ hand: [sized(0.25)] }, FRAME)).toEqual(['hand-dominates']);
        expect(Score.gradeDetections({ hand: [sized(0.15)] }, FRAME)).toEqual(['hand-closeup']);
        expect(Score.gradeDetections({ hand: [sized(0.05)] }, FRAME)).toEqual([]);
    });

    test('a hand across a quarter of the frame fails on its own', () => {
        // The render that motivated the tier: an "empty street" prompt that came
        // back as one malformed hand over 22.5% of the image.
        const v = Score.verdictFrom(['hand-dominates']);
        expect(v.ok).toBe(false);
    });

    test('a face against the frame edge is cropped', () => {
        expect(Score.gradeDetections({ face: [box(0, 200, 90, 90)] }, FRAME)).toContain('cropped-face');
        expect(Score.gradeDetections({ face: [box(600, 200, 90, 90)] }, FRAME))
            .not.toContain('cropped-face');
    });

    test('a face stretched out of proportion is a distortion', () => {
        expect(Score.gradeDetections({ face: [box(600, 200, 200, 60)] }, FRAME))
            .toContain('distorted-face');
        expect(Score.gradeDetections({ face: [box(600, 200, 90, 100)] }, FRAME))
            .not.toContain('distorted-face');
    });
});

describe('duplicate detection', () => {
    test('near-identical regions are a clone; different ones are not', () => {
        const a = 0xf0f0f0f0f0f0f0f0n;
        const near = 0xf0f0f0f0f0f0f0f1n;        // 1 bit apart
        const far = 0x0f0f0f0f0f0f0f0fn;         // every bit apart

        expect(Score.hamming(a, near)).toBe(1);
        expect(Score.hamming(a, far)).toBe(64);
        expect(Score.gradeDetections({ person: [] }, FRAME, { personHashes: [a, near] }))
            .toContain('duplicate-person');
        expect(Score.gradeDetections({ person: [] }, FRAME, { personHashes: [a, far] }))
            .not.toContain('duplicate-person');
        expect(Score.gradeDetections({ face: [] }, FRAME, { faceHashes: [a, near] }))
            .toContain('cloned-face');
    });
});

describe('verdicts', () => {
    test('a fatal flag scores zero, so best-of-3 can never rank it first', () => {
        const twoHeaded = Score.verdictFrom(['extra-heads']);
        const merelySoft = Score.verdictFrom(['flat']);
        expect(twoHeaded.score).toBe(0);
        expect(twoHeaded.ok).toBe(false);
        expect(merelySoft.score).toBeGreaterThan(twoHeaded.score);
    });

    test('penalties accumulate and are clamped at zero', () => {
        expect(Score.verdictFrom([]).score).toBe(100);
        expect(Score.verdictFrom(['flat']).score).toBe(100 - Score.FLAG_WEIGHTS.flat);
        expect(Score.verdictFrom(['blurry', 'flat', 'hand-dominates', 'extra-hands']).score).toBe(0);
    });

    test('repeated flags are counted once', () => {
        expect(Score.verdictFrom(['flat', 'flat', 'flat']).score)
            .toBe(100 - Score.FLAG_WEIGHTS.flat);
    });

    test('every fatal flag is one the model cannot have meant', () => {
        expect([...Score.FATAL_FLAGS].sort())
            .toEqual(['cloned-face', 'duplicate-person', 'extra-heads']);
    });
});

describe('detection graph', () => {
    const detectors = {
        hand: { model: 'bbox/hand_yolov8s.pt', family: 'bbox', threshold: 0.3 },
        person: { model: 'segm/person_yolov8m-seg.pt', family: 'segm', threshold: 0.5 },
    };
    const { graph, previewNodes } = Score.detectionGraph('probe.png', detectors);
    const nodesOf = type => Object.values(graph).filter(n => n.class_type === type);

    test('one branch per detector, all reading one LoadImage', () => {
        expect(graph['1'].class_type).toBe('LoadImage');
        expect(nodesOf('UltralyticsDetectorProvider')).toHaveLength(2);
        expect(Object.keys(previewNodes).sort()).toEqual(['hand', 'person']);
        for (const n of [...nodesOf('BboxDetectorSEGS'), ...nodesOf('SegmDetectorSEGS')]) {
            expect(n.inputs.image).toEqual(['1', 0]);
        }
    });

    test('labels is sent — omitting it fails ComfyUI validation outright', () => {
        for (const n of [...nodesOf('BboxDetectorSEGS'), ...nodesOf('SegmDetectorSEGS')]) {
            expect(n.inputs.labels).toBe('all');
        }
    });

    test('a segm model is taken off the provider second output, bbox off the first', () => {
        expect(nodesOf('BboxDetectorSEGS')[0].inputs.bbox_detector[1]).toBe(0);
        expect(nodesOf('SegmDetectorSEGS')[0].inputs.segm_detector[1]).toBe(1);
    });

    test('the box is measured, not dilated the way the repair pass dilates it', () => {
        for (const n of [...nodesOf('BboxDetectorSEGS'), ...nodesOf('SegmDetectorSEGS')]) {
            expect(n.inputs.dilation).toBe(0);
            expect(n.inputs.crop_factor).toBe(1.0);
        }
    });

    test('detections come back one mask each, not merged into one', () => {
        // SegsToCombinedMask would union adjacent faces into a single box and
        // lose the count, which is the measurement.
        expect(nodesOf('ImpactSEGSToMaskList')).toHaveLength(2);
        expect(nodesOf('SegsToCombinedMask')).toHaveLength(0);
        expect(nodesOf('PreviewImage')).toHaveLength(2);
    });

    test('a detector with no installed model contributes no branch', () => {
        const { graph: g, previewNodes: p } = Score.detectionGraph('x.png', {
            hand: detectors.hand, face: null,
        });
        expect(Object.keys(p)).toEqual(['hand']);
        expect(Object.values(g).filter(n => n.class_type === 'UltralyticsDetectorProvider'))
            .toHaveLength(1);
    });
});

describe('mask geometry', () => {
    const sharp = require('sharp');

    /** A detection mask as ComfyUI returns one: white box on a black canvas. */
    const maskPng = (left, top, w, h) => sharp({
        create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).composite([{
        input: { create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } },
        left, top,
    }]).png().toBuffer();

    test('reads back the exact box', async () => {
        const bb = await Score.maskBoundingBox(await maskPng(30, 20, 50, 40));
        expect(bb).toMatchObject({ x0: 30, y0: 20, x1: 79, y1: 59, w: 50, h: 40 });
        expect(bb.frame).toEqual({ width: 200, height: 100 });
    });

    test('finds a detection in the top-left corner', async () => {
        // sharp's trim() infers background from the corner pixel and would read
        // this as empty, which is why the scan is explicit.
        const bb = await Score.maskBoundingBox(await maskPng(0, 0, 25, 25));
        expect(bb).toMatchObject({ x0: 0, y0: 0, w: 25, h: 25 });
    });

    test('an empty mask is null, not a zero-sized box', async () => {
        const blank = await sharp({
            create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
        }).png().toBuffer();
        expect(await Score.maskBoundingBox(blank)).toBeNull();
    });
});

describe('screen', () => {
    const quiet = { log() {}, warn() {} };

    test('mode=off clears everything without touching a lane', async () => {
        const { verdicts, scored } = await Score.screen(
            [{ name: 'a.png', buffer: Buffer.alloc(0) }],
            { mode: 'off', lanes: [], logger: quiet },
        );
        expect(scored).toBe(false);
        expect(verdicts.get('a.png')).toMatchObject({ ok: true, skipped: true });
    });

    test('a failure inside scoring never silently passes in enforce mode', async () => {
        // Buffer.alloc(0) is not a decodable image, so sharp throws.
        const { verdicts } = await Score.screen(
            [{ name: 'bad.png', buffer: Buffer.alloc(0) }],
            { mode: 'enforce', lanes: [], logger: quiet },
        );
        const v = verdicts.get('bad.png');
        expect(v.ok).toBe(false);
        expect(v.error).toBeTruthy();
    });

    test('in warn mode the same failure does not cost the image', async () => {
        const { verdicts } = await Score.screen(
            [{ name: 'bad.png', buffer: Buffer.alloc(0) }],
            { mode: 'warn', lanes: [], logger: quiet },
        );
        expect(verdicts.get('bad.png').ok).toBe(true);
    });
});

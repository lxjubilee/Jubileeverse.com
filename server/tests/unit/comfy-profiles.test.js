'use strict';
/**
 * Render profiles and the graph each one builds.
 *
 * The defect this replaces was silent: the sampler ran at cfg 1.0, where
 * classifier-free guidance cannot subtract the negative branch, so a long list
 * of "six fingers, malformed hands, extra limbs" sat in the config having no
 * effect on any image. Anatomy constraints now live in the positive prompt for
 * every profile, and the negative is wired only where it can act.
 *
 * Licensing is asserted too: FLUX.1-dev is non-commercial and must never become
 * the default by accident.
 */

const Comfy = require('../../lib/comfy-client');

const graph = (prompt, seed, opts) => Comfy.buildGraph(prompt, seed, opts);
const sampler = (g) => g['8'].inputs;
const positiveText = (g) => g['4'].inputs.text;
const negativeText = (g) => g['5'].inputs.text;

describe('profiles', () => {
    test('every profile names a checkpoint and declares its CFG support', () => {
        for (const [name, p] of Object.entries(Comfy.PROFILES)) {
            expect(typeof p.checkpoint).toBe('string');
            expect(p.checkpoint.endsWith('.safetensors')).toBe(true);
            expect(typeof p.supportsCfg).toBe('boolean');
            expect(['flux', 'sdxl']).toContain(p.family);
            expect(['commercial-ok', 'non-commercial']).toContain(p.licence);
            expect(name).toBeTruthy();
        }
    });

    test('the non-commercial model is opt-in and never the default', () => {
        expect(Comfy.PROFILES['flux-dev'].licence).toBe('non-commercial');
        expect(Comfy.DEFAULT_PROFILE).not.toBe('flux-dev');
        expect(Comfy.profile().licence).toBe('commercial-ok');
    });

    test('juggernaut is the SDXL profile and permits commercial use', () => {
        const p = Comfy.PROFILES.sdxl;
        expect(p.checkpoint).toMatch(/Juggernaut/i);
        expect(p.licence).toBe('commercial-ok');
        expect(p.supportsCfg).toBe(true);
    });

    test('an unknown profile falls back to schnell rather than failing a run', () => {
        expect(Comfy.profile('nonexistent').checkpoint).toBe(Comfy.PROFILES.schnell.checkpoint);
    });
});

describe('positive prompt — where the anatomy constraints actually live', () => {
    test('the style suffix states the anatomy rules positively', () => {
        for (const phrase of [
            'five fingers', 'one head per person', 'correct body proportions',
            'natural facial expression', 'consistent light direction', 'uncropped',
        ]) {
            expect(Comfy.STYLE_SUFFIX.toLowerCase()).toContain(phrase.toLowerCase());
        }
    });

    test('it reaches the graph on both families', () => {
        for (const name of ['sdxl', 'schnell']) {
            const g = graph(`a scene${Comfy.STYLE_SUFFIX}`, 1, { profile: name });
            expect(positiveText(g)).toContain('five fingers');
        }
    });
});

describe('sdxl profile — real CFG, working negative', () => {
    const g = graph('a newsroom at dawn', 42, { profile: 'sdxl' });

    test('runs at a CFG the negative branch can act on', () => {
        expect(sampler(g).cfg).toBeGreaterThan(1);
        expect(sampler(g).cfg).toBe(Comfy.PROFILES.sdxl.cfg);
    });

    test('carries the artifact negative into the sampler', () => {
        for (const artifact of ['six fingers', 'extra heads', 'duplicate person', 'cropped limbs']) {
            expect(negativeText(g)).toContain(artifact);
        }
    });

    test('uses an SDXL latent and sampler, not the FLUX ones', () => {
        expect(g['7'].class_type).toBe('EmptyLatentImage');
        expect(g['6']).toBeUndefined();               // no FluxGuidance
        expect(sampler(g).positive).toEqual(['4', 0]); // straight off the encoder
        expect(sampler(g).sampler_name).toBe('dpmpp_2m');
        expect(sampler(g).scheduler).toBe('karras');
    });

    test('does not load the FLUX realism LoRA, which would not apply', () => {
        expect(g['11']).toBeUndefined();
        expect(sampler(g).model).toEqual(['1', 0]);
    });

    test('the hand repair conditions the same way the sampler did', () => {
        expect(g['13'].inputs.positive).toEqual(['4', 0]);
        expect(g['13'].inputs.cfg).toBe(Comfy.PROFILES.sdxl.cfg);
    });
});

describe('schnell profile — distilled, so no false comfort from a negative', () => {
    const g = graph('a newsroom at dawn', 42, { profile: 'schnell' });

    test('still runs at cfg 1.0, as a distilled model must', () => {
        expect(sampler(g).cfg).toBe(1.0);
    });

    test('sends an empty negative rather than one that cannot act', () => {
        expect(negativeText(g)).toBe('');
    });

    test('keeps the FLUX graph shape it has always had', () => {
        expect(g['7'].class_type).toBe('EmptySD3LatentImage');
        expect(g['6'].class_type).toBe('FluxGuidance');
        expect(sampler(g).positive).toEqual(['6', 0]);
        expect(sampler(g).steps).toBe(4);
        expect(g['11'].inputs.lora_name).toBe('flux-realism.safetensors');
        expect(sampler(g).model).toEqual(['11', 0]);
    });

    test('the hand repair still conditions through FluxGuidance', () => {
        expect(g['13'].inputs.positive).toEqual(['6', 0]);
        expect(g['13'].inputs.cfg).toBe(1.0);
    });
});

describe('graph invariants shared by every profile', () => {
    for (const name of Object.keys(Comfy.PROFILES)) {
        test(`${name}: renders 1344x768, repairs hands, and saves one image`, () => {
            const g = graph('a scene', 7, { profile: name });
            expect(g['7'].inputs.width).toBe(1344);
            expect(g['7'].inputs.height).toBe(768);
            expect(g['12'].inputs.model_name).toBe('bbox/hand_yolov8s.pt');
            expect(g['10'].inputs.images).toEqual(['13', 0]);  // the repaired image
            expect(g['8'].inputs.seed).toBe(7);
        });
    }

    test('an explicit negative override still only applies where CFG works', () => {
        expect(negativeText(graph('x', 1, { profile: 'sdxl', negative: 'custom terms' })))
            .toBe('custom terms');
        expect(negativeText(graph('x', 1, { profile: 'schnell', negative: 'custom terms' })))
            .toBe('');
    });
});

'use strict';
/**
 * Read Aloud — the play decision that governs voice switching.
 *
 * The reported fault: choose Female, play, stop, choose Male, play — and the
 * article came back in the female voice. Pressing Play resumed whatever was
 * attached to the audio element whenever `src` was set, and Stop only paused it,
 * so the loaded female segment was replayed and no new audio was requested.
 *
 * These tests drive the real decision function through the reported sequence and
 * the surrounding cycles, rather than restating the rule.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load src/lib/readAloudPlayback.ts as CommonJS, with types erased. */
function loadPlayback() {
    const file = path.join(__dirname, '..', '..', '..', 'src', 'lib', 'readAloudPlayback.ts');
    const src = fs.readFileSync(file, 'utf8')
        .replace(/^export type[\s\S]*?;$/gm, '')            // type aliases (Voice)
        .replace(/^export type PlayAction[\s\S]*?;$/gm, '')  // union alias
        .replace(/^export interface[\s\S]*?^}/gm, '')        // interfaces
        .replace(/\(state:\s*PlaybackState\)/g, '(state)')   // param annotation
        .replace(/\)\s*:\s*PlayAction\s*\{/g, ') {')         // return annotation
        .replace(/\bexport\s+/g, '');

    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(`${src}\n;__out = { playAction };`, sandbox);
    return sandbox.__out;
}

const { playAction } = loadPlayback();

/**
 * A tiny model of the widget: the state the decision reads, plus the effects the
 * component applies for each action. Lets a whole play/stop sequence run and be
 * asserted on, including which voices were actually synthesized.
 */
function createWidget() {
    const state = {
        playing: false,
        hasLoadedAudio: false,
        loadedVoice: null,
        selectedVoice: 'female',
        segIndex: 0,
    };
    const synthesized = [];   // every voice actually sent to /api/tts

    return {
        state,
        synthesized,
        selectVoice(v) {
            if (v === state.selectedVoice) return;
            state.selectedVoice = v;
            // Mirrors changeVoice: a live playback re-synthesizes at once.
            if (state.playing) this.synthesize(state.segIndex);
        },
        /** playSegment: fetch in the selected voice and attach it. */
        synthesize(segment) {
            synthesized.push(state.selectedVoice);
            state.loadedVoice = state.selectedVoice;
            state.hasLoadedAudio = true;
            state.segIndex = segment;
            state.playing = true;
        },
        /** The play/pause button. */
        press() {
            const action = playAction(state);
            if (action.kind === 'pause') state.playing = false;
            else if (action.kind === 'resume') state.playing = true;
            else this.synthesize(action.segment);
            return action;
        },
        /** The stop button — detaches the loaded segment, as the fix requires. */
        stop() {
            state.playing = false;
            state.hasLoadedAudio = false;
            state.loadedVoice = null;
            state.segIndex = 0;
        },
    };
}

describe('the reported sequence: female → stop → male → play', () => {
    test('the male voice is used, not the female one already loaded', () => {
        const w = createWidget();

        w.selectVoice('female');
        w.press();                       // 1. play
        expect(w.synthesized).toEqual(['female']);

        w.stop();                        // 2. stop
        w.selectVoice('male');           // 3. switch
        const action = w.press();        // 4. play again

        expect(action).toEqual({ kind: 'synthesize', segment: 0 });
        expect(w.synthesized).toEqual(['female', 'male']);
        expect(w.state.loadedVoice).toBe('male');
    });

    test('before the fix the loaded audio would simply have been resumed', () => {
        // The old rule was `hasLoadedAudio` alone. Pinned here so a regression to
        // it is unambiguous: with audio still attached, that returns 'resume'.
        const stale = {
            playing: false,
            hasLoadedAudio: true,
            loadedVoice: 'female',
            selectedVoice: 'male',
            segIndex: 0,
        };
        expect(playAction(stale)).toEqual({ kind: 'synthesize', segment: 0 });
    });
});

describe('repeated play/stop cycles keep honouring the selection', () => {
    test('alternating voices across several cycles', () => {
        const w = createWidget();
        const order = ['female', 'male', 'female', 'male', 'male', 'female'];

        for (const v of order) {
            w.selectVoice(v);
            w.press();
            expect(w.state.loadedVoice).toBe(v);
            w.stop();
        }
        // Consecutive identical picks still re-synthesize, because Stop detached
        // the audio — six presses, six requests, each in the chosen voice.
        expect(w.synthesized).toEqual(order);
    });

    test('stop always clears the loaded audio', () => {
        const w = createWidget();
        w.press();
        expect(w.state.hasLoadedAudio).toBe(true);
        w.stop();
        expect(w.state.hasLoadedAudio).toBe(false);
        expect(w.state.loadedVoice).toBeNull();
        expect(w.state.segIndex).toBe(0);
    });
});

describe('switching voice while paused mid-article', () => {
    test('re-synthesizes the segment being read, not the start', () => {
        const w = createWidget();
        w.press();
        w.state.segIndex = 4;            // read on to segment 4
        w.press();                       // pause
        expect(w.state.playing).toBe(false);

        w.selectVoice('male');
        const action = w.press();

        expect(action).toEqual({ kind: 'synthesize', segment: 4 });
        expect(w.synthesized).toEqual(['female', 'male']);
        expect(w.state.segIndex).toBe(4);
    });

    test('pausing and resuming the same voice does not re-synthesize', () => {
        const w = createWidget();
        w.press();                       // play  (1 request)
        w.press();                       // pause
        const action = w.press();        // resume

        expect(action).toEqual({ kind: 'resume' });
        expect(w.synthesized).toEqual(['female']);   // no extra TTS call
        expect(w.state.playing).toBe(true);
    });
});

describe('switching voice during playback', () => {
    test('re-synthesizes immediately in the newly selected voice', () => {
        const w = createWidget();
        w.press();
        expect(w.state.playing).toBe(true);

        w.selectVoice('male');

        expect(w.synthesized).toEqual(['female', 'male']);
        expect(w.state.loadedVoice).toBe('male');
        expect(w.state.playing).toBe(true);
    });

    test('re-selecting the voice already active changes nothing', () => {
        const w = createWidget();
        w.press();
        w.selectVoice('female');
        expect(w.synthesized).toEqual(['female']);
    });
});

describe('the rest of the play button is unchanged', () => {
    test('playing pauses', () => {
        expect(playAction({
            playing: true, hasLoadedAudio: true, loadedVoice: 'female',
            selectedVoice: 'female', segIndex: 2,
        })).toEqual({ kind: 'pause' });
    });

    test('a pause is still a pause even after the voice was switched', () => {
        // The switch is handled on the way back in, not by turning Pause into
        // something else.
        expect(playAction({
            playing: true, hasLoadedAudio: true, loadedVoice: 'female',
            selectedVoice: 'male', segIndex: 2,
        })).toEqual({ kind: 'pause' });
    });

    test('a fresh widget synthesizes segment 0', () => {
        expect(playAction({
            playing: false, hasLoadedAudio: false, loadedVoice: null,
            selectedVoice: 'female', segIndex: 0,
        })).toEqual({ kind: 'synthesize', segment: 0 });
    });

    test('matching voice with audio loaded resumes', () => {
        expect(playAction({
            playing: false, hasLoadedAudio: true, loadedVoice: 'male',
            selectedVoice: 'male', segIndex: 3,
        })).toEqual({ kind: 'resume' });
    });
});

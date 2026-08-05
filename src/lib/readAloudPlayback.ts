/**
 * The play/pause decision for the Read Aloud widget.
 *
 * Pulled out of the component because it is where the voice switch went wrong:
 * pressing Play resumed whatever was attached to the audio element whenever
 * `src` was set, which is still true after Stop. A reader who stopped, chose the
 * other voice and pressed Play therefore heard the previous voice again — the
 * element replayed its loaded segment and no new audio was ever requested.
 *
 * Resuming is only correct while the loaded audio is still in the selected
 * voice. Anything else has to be synthesized again.
 */

export type Voice = 'female' | 'male';

/** What pressing the play/pause button should do. */
export type PlayAction =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'synthesize'; segment: number };

export interface PlaybackState {
  /** Audio is currently playing. */
  playing: boolean;
  /** A synthesized segment is attached to the audio element. */
  hasLoadedAudio: boolean;
  /** The voice that attached segment was synthesized with; null when none is. */
  loadedVoice: Voice | null;
  /** The voice the reader currently has selected. */
  selectedVoice: Voice;
  /** The segment the widget is positioned on. */
  segIndex: number;
}

export function playAction(state: PlaybackState): PlayAction {
  if (state.playing) return { kind: 'pause' };
  // Resume only while the loaded audio still matches the selection. Testing for
  // loaded audio alone is what made a voice change between stop and play — or
  // between pause and play — have no effect.
  if (state.hasLoadedAudio && state.loadedVoice === state.selectedVoice) {
    return { kind: 'resume' };
  }
  // Synthesize where the widget actually is: segment 0 for a fresh start or
  // after Stop, and the current segment when the voice changed while paused.
  return { kind: 'synthesize', segment: state.segIndex };
}

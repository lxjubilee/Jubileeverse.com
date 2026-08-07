/**
 * The text rules behind Read Aloud: how a paragraph is cut into what gets sent
 * for synthesis, which word is being spoken, and for how long.
 *
 * The backend returns one MP3 per paragraph and nothing else — no word
 * boundaries, no marks — so the position within a paragraph cannot be known,
 * only estimated. The estimate is re-made at every word from the audio's own
 * remaining time divided by the words still to say, which is what keeps it from
 * drifting: a word that ran long shortens the ones after it, and by the end of
 * the paragraph the highlight and the voice arrive together.
 *
 * The rules live here rather than in the component because they are the part
 * worth testing, and they need neither a DOM nor an audio element to check.
 */

/** A word's position in a block of text, as `[start, end)` offsets. */
export interface WordSpan {
  start: number;
  end: number;
}

/**
 * The words in `text`, in order.
 *
 * A word is a run of non-whitespace, which is what the original engine treated
 * as one. It follows that punctuation travels with the word it touches, and
 * that a script written without spaces — Chinese, Japanese, Thai — yields one
 * span per phrase rather than per word. The highlight is then coarser for those
 * languages, but it still advances with the voice, which is the point.
 */
export function wordOffsets(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/**
 * Sentence ends, including the Devanagari danda and its Chinese/Japanese
 * equivalents, so a translated article breaks where a reader would pause.
 */
const SENTENCE_END = /(?<=[.!?…।。！？])\s+/;

/**
 * Cut `text` into pieces of at most `limit` characters, at sentence boundaries.
 *
 * This replaced a truncation. A segment over the cap used to be sliced and the
 * remainder dropped, so a long paragraph was read up to a point and the rest was
 * never spoken — with nothing to show that anything was missing. Splitting says
 * all of it.
 *
 * Sentences are packed greedily. One longer than the whole limit is broken on
 * spaces rather than mid-word, and a single unbroken run longer than the limit
 * is cut where it must be, since something has to give.
 *
 * Whitespace between pieces is dropped, being the join; no other character is.
 */
export function sentenceChunks(text: string, limit: number): string[] {
  const whole = text.trim();
  if (whole.length <= limit || limit <= 0) return whole ? [whole] : [];

  const pieces: string[] = [];
  let current = '';

  const flush = () => {
    if (current) pieces.push(current);
    current = '';
  };
  const add = (part: string) => {
    if (!part) return;
    if (!current) current = part;
    else if (current.length + 1 + part.length <= limit) current += ` ${part}`;
    else {
      flush();
      current = part;
    }
  };

  for (const sentence of whole.split(SENTENCE_END)) {
    if (sentence.length <= limit) {
      add(sentence);
      continue;
    }
    // Too long to be a piece on its own: fall back to words, then to a hard cut.
    flush();
    let run = '';
    for (const word of sentence.split(/\s+/)) {
      if (word.length > limit) {
        if (run) {
          pieces.push(run);
          run = '';
        }
        for (let i = 0; i < word.length; i += limit) pieces.push(word.slice(i, i + limit));
        continue;
      }
      if (!run) run = word;
      else if (run.length + 1 + word.length <= limit) run += ` ${word}`;
      else {
        pieces.push(run);
        run = word;
      }
    }
    if (run) pieces.push(run);
  }
  flush();
  return pieces;
}

/** Assumed pace before the audio can say otherwise. ~240 words/minute at 1x. */
const FALLBACK_MS_PER_WORD = 250;

/**
 * The shortest a word may be held. Without it, a paragraph whose audio is
 * nearly over races the remaining words past in a blur that reads as a glitch
 * rather than as reading.
 */
const MIN_WORD_MS = 80;

/**
 * How long to hold the current word, in wall-clock milliseconds.
 *
 * `remainingMs` is media time — what the audio element reports — so it is
 * divided by the playback rate to become real time: at 2x, a second of audio
 * takes half a second to hear. Pass a non-finite `remainingMs` before the
 * duration is known, and the fallback pace stands in.
 */
export function wordDelayMs(remainingMs: number, wordsLeft: number, rate: number): number {
  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const perWord =
    wordsLeft > 0 && Number.isFinite(remainingMs) && remainingMs > 0
      ? remainingMs / wordsLeft
      : FALLBACK_MS_PER_WORD;
  return Math.max(MIN_WORD_MS, perWord / speed);
}

/**
 * The word a paragraph is at, given how far its audio has played.
 *
 * Used when the highlight has to rejoin audio already in progress — resuming
 * from a pause, or landing mid-paragraph after a seek — so it picks up beside
 * the voice instead of starting the paragraph again.
 */
export function wordIndexAt(currentTime: number, duration: number, wordCount: number): number {
  if (!(wordCount > 0)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
  const index = Math.floor((currentTime / duration) * wordCount);
  return Math.min(wordCount - 1, Math.max(0, index));
}

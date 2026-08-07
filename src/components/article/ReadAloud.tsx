'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/authStorage';
import { playAction, type Voice } from '@/lib/readAloudPlayback';
import { sentenceChunks, wordDelayMs, wordIndexAt, wordOffsets } from '@/lib/readAloudWords';
import styles from './widgets.module.css';

/**
 * Read Aloud (TTS) widget. Streams the article aloud via `POST /api/tts`
 * (returns binary audio/mpeg; `voice` is a gender: 'female' | 'male').
 * The text is split into paragraph segments played sequentially, with
 * play/pause/stop, voice + speed controls, and a seekable progress bar.
 */
const SPEEDS = [1, 1.25, 1.5, 2] as const;

/** Block-level tags that should become a paragraph break, not vanish. */
const BLOCK_END =
  /<\/(?:p|div|h[1-6]|li|blockquote|tr|section|article|figcaption)\s*>|<br\s*\/?>/gi;

/** `&amp;` → `&`. Runs after tags are stripped, so the input is tag-free. */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  if (typeof document === 'undefined') {
    const map: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
    };
    return s.replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (m, e) => map[e] ?? m);
  }
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
}

/**
 * Article bodies arrive as either HTML or markdown. The TTS backend returns an
 * empty 200 for any text containing "<", so markup must be removed rather than
 * partially stripped — tags first, then markdown markers, then a final scrub of
 * any stray angle brackets (including ones revealed by entity decoding).
 */
function toSpeakableText(input: string): string {
  return decodeEntities(
    input
      .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, '')
      .replace(BLOCK_END, '\n\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[#*_>`]/g, '') // markdown markers read poorly aloud
    .replace(/[<>]/g, ' '); // a lone "<" empties the TTS response
}

/**
 * The most a single synthesis request may carry. Measured on this backend at
 * roughly 150 characters a second, so this bounds one request to about twelve
 * seconds — well inside the request timeout, and short enough that the prefetch
 * of the next piece has time to land.
 */
const MAX_SEGMENT_CHARS = 1800;

/**
 * One request's worth of speech, and where in the article it belongs.
 *
 * A segment used to be just the paragraph's text. It carries its origin now
 * because a paragraph over the cap becomes several segments, and both highlights
 * still have to point at the one paragraph on screen: `blockKey` finds it, and
 * the word window says which of its words this piece actually speaks.
 */
interface Segment {
  text: string;
  /** Key of the whole paragraph, for matching against a rendered block. */
  blockKey: string;
  /** Words of that block this piece covers, as `[from, to)`. */
  wordFrom: number;
  wordTo: number;
}

function segmentize(text: string): Segment[] {
  const paragraphs = toSpeakableText(text)
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);

  const segments: Segment[] = [];
  for (const paragraph of paragraphs) {
    const blockKey = matchKey(paragraph);
    let wordFrom = 0;
    for (const piece of sentenceChunks(paragraph, MAX_SEGMENT_CHARS)) {
      const wordTo = wordFrom + wordOffsets(piece).length;
      segments.push({ text: piece, blockKey, wordFrom, wordTo });
      wordFrom = wordTo;
    }
  }
  return segments;
}

/** Class toggled on the article block currently being spoken. */
const ACTIVE_CLASS = 'read-aloud-active';
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, li';

/**
 * Comparison key for matching a spoken segment to a rendered block. Punctuation
 * and whitespace are dropped so markdown/HTML rendering differences (smart
 * quotes, em-dashes, stripped markers) don't prevent a match.
 *
 * Letters and digits of any script are kept. An earlier `[^a-z0-9]` threw away
 * everything outside ASCII, so a Hindi or Greek paragraph reduced to an empty
 * key and matched nothing — the highlight quietly did not appear on translated
 * articles at all.
 */
const matchKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 60);

/** The rendered block a segment came from, or null if it isn't found. */
function findBlock(root: HTMLElement, key: string): HTMLElement | null {
  if (!key) return null;
  return (
    Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).find((el) => {
      const elKey = matchKey(el.textContent || '');
      return elKey.length > 0 && elKey === key;
    }) ?? null
  );
}

/**
 * Name the word highlight is registered under. Global to the document, so one
 * reader at a time — which is what an article page has.
 */
const WORD_HIGHLIGHT = 'read-aloud-word';

/** Grace before the first word lights, letting the sound actually start. */
const FIRST_WORD_DELAY_MS = 150;

/**
 * How many paragraphs may fail back-to-back before reading stops. Enough to ride
 * out a blip or an unvoiceable paragraph; few enough that a backend which is
 * down is reported rather than worked through to the end of the article.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Whether this browser can paint a range without the DOM being touched. Typed
 * as always present, so both halves are checked at runtime — a browser without
 * the API has neither, and the block highlight carries on alone.
 */
const canHighlightWords = () =>
  typeof CSS !== 'undefined' && typeof Highlight !== 'undefined' && !!CSS.highlights;

/**
 * One Range per word inside `el`, in reading order.
 *
 * The block's text nodes are flattened into a single string so that a word split
 * across an inline tag — `<em>half</em>way` — stays one word, and each offset is
 * mapped back to the node it came from. Ranges may therefore span nodes, which
 * is exactly what Range is for.
 */
function wordRangesIn(el: HTMLElement): Range[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let flat = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const textNode = n as Text;
    nodes.push({ node: textNode, start: flat.length });
    flat += textNode.data;
  }
  if (!nodes.length) return [];

  /** The node holding flat-string offset `at`, and the offset within it. */
  const locate = (at: number) => {
    // Walking backwards finds the last node that starts at or before `at`,
    // which is the one containing it.
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (at >= nodes[i].start) return { node: nodes[i].node, offset: at - nodes[i].start };
    }
    return { node: nodes[0].node, offset: 0 };
  };

  return wordOffsets(flat).map(({ start, end }) => {
    const from = locate(start);
    // `end` is exclusive, so locate the last character and step one past it —
    // asking for `end` itself would land on the following node at offset 0.
    const to = locate(end - 1);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset + 1);
    return range;
  });
}

/** Measured against this backend's output: ~150 spoken words per minute. */
const WORDS_PER_SECOND = 2.5;

/** Length guess for a segment that hasn't been synthesized yet. */
const estimateSeconds = (s: string) =>
  s ? Math.max(1, s.trim().split(/\s+/).length / WORDS_PER_SECOND) : 0;

const formatTime = (s: number) => {
  const safe = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

export default function ReadAloud({
  text,
  lang = 'en-US',
  contentRef,
}: {
  text: string;
  /**
   * Locale of `text`, which decides the neural voice. The backend keeps a voice
   * per locale, so a story translated to Hindi has to be requested as 'hi-IN':
   * the same Devanagari asked for as 'en-US' comes back as an empty 200, which
   * this widget can only report as a failure. Defaults to 'en-US', which is what
   * an untranslated article is.
   */
  lang?: string;
  /** Article body container; its blocks get highlighted as they're read. */
  contentRef?: React.RefObject<HTMLElement | null>;
}) {
  const segments = useRef<Segment[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * Segments synthesized ahead of being needed, by index.
   *
   * Without this the reader waits out a whole round trip at every paragraph
   * break — measured at about 1.4 s against production, which is a silence long
   * enough to sound like a fault. The voice and language each blob was made with
   * ride along, because a reader who switches either one mid-article must not be
   * handed audio prepared under the old choice.
   */
  const prefetched = useRef(new Map<number, { url: string; voice: Voice; lang: string }>());
  /** Indices with a prefetch in flight, so it is never started twice. */
  const prefetching = useRef(new Set<number>());
  /**
   * Consecutive segments that failed. One bad paragraph should not end the
   * article — a dropped connection on a phone is ordinary — but a backend that
   * is down should stop rather than march through every remaining paragraph.
   */
  const failures = useRef(0);
  /** False once unmounted, so in-flight segments never start orphaned audio. */
  const aliveRef = useRef(true);
  const [segIndex, setSegIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [voice, setVoice] = useState<Voice>('female');
  /**
   * Mirrors `voice` for the async paths. `setVoice` does not take effect until
   * the next render, so a fetch started in the same tick as the change — which
   * is exactly what switching voice mid-playback does — would otherwise read the
   * previous render's value and synthesize in the voice the reader just left.
   */
  const voiceRef = useRef<Voice>('female');
  /**
   * Mirrors `lang` for the same reason `voiceRef` mirrors `voice`: `fetchSegment`
   * is built once, so reading the prop through a ref keeps it from synthesizing
   * in the language the article has just left.
   */
  const langRef = useRef(lang);
  /**
   * The voice the blob currently attached to the audio element was synthesized
   * with, or null when nothing is loaded. Resuming is only valid while this
   * still matches the selection.
   */
  const loadedVoiceRef = useRef<Voice | null>(null);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [error, setError] = useState('');
  /** True from first play until stop/finish — keeps the highlight while paused. */
  const [active, setActive] = useState(false);
  /** Media time within the current segment, for the elapsed readout. */
  const [segTime, setSegTime] = useState(0);
  /** Measured duration per segment; unplayed entries stay undefined. */
  const [durations, setDurations] = useState<number[]>([]);

  // changeVoice sets the ref itself, because the re-fetch it triggers runs
  // before this effect does. This keeps the two in step for any other path that
  // may come to set `voice`.
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  /**
   * Drop the synthesized segment attached to the audio element, so the next
   * play re-synthesizes rather than replaying what is loaded.
   */
  const detachLoadedAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      // removeAttribute rather than `src = ''`, which would re-load the page
      // URL as media.
      audio.removeAttribute('src');
      audio.load();
    }
    loadedVoiceRef.current = null;
  }, []);

  /**
   * Throw away everything synthesized ahead. Every blob URL holds its audio in
   * memory until revoked, so dropping the map alone would leak an article's
   * worth of MP3s each time the reader switches voice or language.
   */
  const dropPrefetched = useCallback(() => {
    prefetched.current.forEach(({ url }) => URL.revokeObjectURL(url));
    prefetched.current.clear();
    prefetching.current.clear();
  }, []);

  useEffect(() => {
    segments.current = segmentize(text);
    setDurations([]);
    setSegTime(0);
    // Prepared audio belongs to the previous text and language.
    dropPrefetched();
    failures.current = 0;
    // The body itself changed — translating the article swaps it — so audio
    // synthesized from the previous text is no longer what these segments say.
    // `lang` moves with it, and is listed for the same reason `loadedVoice`
    // exists: audio left attached from the previous language would otherwise be
    // resumed rather than re-synthesized.
    detachLoadedAudio();
    setSegIndex(0);
    setPlaying(false);
    setActive(false);
  }, [text, lang, detachLoadedAudio, dropPrefetched]);

  useEffect(() => {
    aliveRef.current = true;
    const audio = new Audio();
    audioRef.current = audio;
    // Closing or hiding the tab should silence playback immediately, not leave
    // it running in a backgrounded page.
    const silence = () => audio.pause();
    window.addEventListener('pagehide', silence);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('pagehide', silence);
      audio.pause();
      audio.onended = null;
      audio.ontimeupdate = null;
      if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      // Clearing via removeAttribute avoids re-loading the page URL as media,
      // which `audio.src = ''` would do.
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
      dropPrefetched();
    };
  }, [dropPrefetched]);

  // Highlight the article block matching the segment being spoken. The block is
  // located by text rather than by index: the page strips a leading "# title"
  // from the rendered body but not from the text handed to this widget, so the
  // two sequences can be offset by one.
  useEffect(() => {
    const root = contentRef?.current;
    if (!root) return;

    const clear = () => {
      root.querySelectorAll(`.${ACTIVE_CLASS}`).forEach((el) => el.classList.remove(ACTIVE_CLASS));
    };
    clear();
    if (!active) return;

    const seg = segments.current[segIndex];
    if (!seg) return;
    const target = findBlock(root, seg.blockKey);
    if (!target) return;

    target.classList.add(ACTIVE_CLASS);
    const box = target.getBoundingClientRect();
    if (box.top < 80 || box.bottom > window.innerHeight - 40) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return clear;
  }, [segIndex, active, contentRef, text]);

  // Advance the word highlight inside that block, in step with the audio.
  //
  // The backend sends one MP3 per paragraph and no word marks, so the position
  // is estimated and re-estimated at every word from the time the audio has left
  // (see readAloudWords). A timer chain rather than a fixed interval: each word
  // decides how long the next one waits, which is what lets the estimate correct
  // itself instead of accumulating error.
  useEffect(() => {
    if (!canHighlightWords()) return;
    const registry = CSS.highlights;
    const root = contentRef?.current;

    // `active` is false only once reading has stopped or finished, so a pause
    // keeps the current word lit — the same way the block stays lit.
    if (!active) {
      registry.delete(WORD_HIGHLIGHT);
      return;
    }
    if (!playing || !root) return;

    const seg = segments.current[segIndex];
    const block = seg ? findBlock(root, seg.blockKey) : null;
    if (!block || !seg) {
      registry.delete(WORD_HIGHLIGHT);
      return;
    }
    // Only the words this piece speaks. For an ordinary paragraph that is all of
    // them; for one long enough to have been split, it is that piece's share, so
    // the highlight neither races ahead of the audio nor restarts at the top of
    // the paragraph when the next piece begins.
    const ranges = wordRangesIn(block).slice(seg.wordFrom, seg.wordTo);
    if (!ranges.length) {
      registry.delete(WORD_HIGHLIGHT);
      return;
    }

    const audio = audioRef.current;
    // Rejoin the voice where it already is. Resuming from a pause, or seeking
    // into the middle of a paragraph, would otherwise light the first word while
    // the audio spoke the twentieth.
    let index = audio ? wordIndexAt(audio.currentTime, audio.duration, ranges.length) : 0;
    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      if (index >= ranges.length) {
        // The audio outlasted the words — trailing silence, or a paragraph the
        // estimate ran through early. Leave the last word lit rather than
        // blanking the block before it ends.
        return;
      }
      registry.set(WORD_HIGHLIGHT, new Highlight(ranges[index]));
      index += 1;

      const media = audioRef.current;
      const remainingMs =
        media && Number.isFinite(media.duration) && media.duration > 0
          ? (media.duration - media.currentTime) * 1000
          : NaN;
      timer = setTimeout(
        step,
        wordDelayMs(remainingMs, ranges.length - index, media?.playbackRate ?? 1),
      );
    };

    // A beat before the first word: `play()` has resolved but the sound itself
    // is still arriving, and starting flush with it reads as running ahead.
    timer = setTimeout(step, FIRST_WORD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [segIndex, active, playing, contentRef, text]);

  // The highlight is registered on the document, so it has to be withdrawn when
  // the widget goes rather than left painted over an article nobody is reading.
  useEffect(
    () => () => {
      if (canHighlightWords()) CSS.highlights.delete(WORD_HIGHLIGHT);
    },
    [],
  );

  /** Synthesize one segment. Always a round trip — the cache is the caller's. */
  const synthesize = useCallback(
    async (idx: number): Promise<{ url: string; voice: Voice; lang: string } | null> => {
      const seg = segments.current[idx];
      if (!seg) return null;
      // Read the selection at call time, and report back which voice was
      // actually requested: the reader can switch again while this is in
      // flight, and the caller must not label the result with the newer choice.
      const requestedVoice = voiceRef.current;
      const requestedLang = langRef.current;
      const token = getAuthToken();
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: seg.text, voice: requestedVoice, lang: requestedLang }),
      });
      if (!res.ok) throw new Error('TTS request failed');
      const blob = await res.blob();
      // The backend answers 200 with an empty body when it can't synthesize the
      // text; a 0-byte blob would only surface later as a MediaError.
      if (blob.size === 0) throw new Error('TTS returned empty audio');
      return { url: URL.createObjectURL(blob), voice: requestedVoice, lang: requestedLang };
    },
    [],
  );

  /**
   * Start synthesizing a segment that has not been asked for yet, so the audio
   * is waiting when the current one ends. Failures are swallowed: this is work
   * done on spec, and the real attempt will report anything that is wrong.
   */
  const prefetch = useCallback(
    (idx: number) => {
      if (idx >= segments.current.length) return;
      if (prefetched.current.has(idx) || prefetching.current.has(idx)) return;
      prefetching.current.add(idx);
      void synthesize(idx)
        .then((made) => {
          // Unmounted, or the reader moved on to another article, while it was
          // in flight — the blob would otherwise be held for the page's life.
          if (!made) return;
          if (!aliveRef.current || !prefetching.current.has(idx)) {
            URL.revokeObjectURL(made.url);
            return;
          }
          prefetched.current.set(idx, made);
        })
        .catch(() => {})
        .finally(() => prefetching.current.delete(idx));
    },
    [synthesize],
  );

  /** A segment's audio: the prepared one when it still fits, else a fresh one. */
  const fetchSegment = useCallback(
    async (idx: number): Promise<{ url: string; voice: Voice } | null> => {
      const ready = prefetched.current.get(idx);
      if (ready) {
        prefetched.current.delete(idx);
        // Prepared under the choices still in force? Then it is what would have
        // been requested anyway. Otherwise it is the wrong voice or the wrong
        // language, and is dropped rather than played.
        if (ready.voice === voiceRef.current && ready.lang === langRef.current) return ready;
        URL.revokeObjectURL(ready.url);
      }
      return synthesize(idx);
    },
    [synthesize],
  );

  const playSegment = useCallback(
    async (idx: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (idx >= segments.current.length) {
        setPlaying(false);
        setActive(false);
        setSegIndex(0);
        setSegTime(0);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const fetched = await fetchSegment(idx);
        if (!fetched) {
          setPlaying(false);
          return;
        }
        const { url, voice: fetchedVoice } = fetched;
        // The widget may have unmounted while the segment was in flight —
        // starting playback now would leave audio running with no way to stop.
        if (!aliveRef.current || audioRef.current !== audio) {
          URL.revokeObjectURL(url);
          return;
        }
        if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
        audio.src = url;
        loadedVoiceRef.current = fetchedVoice;
        audio.playbackRate = SPEEDS[speedIdx];
        audio.onended = () => {
          setSegIndex((i) => {
            const next = i + 1;
            void playSegment(next);
            return next;
          });
        };
        audio.ontimeupdate = () => {
          setSegTime(audio.currentTime);
          // Replace this segment's estimate with its real length once known.
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            setDurations((prev) => {
              if (prev[idx] === audio.duration) return prev;
              const next = prev.slice();
              next[idx] = audio.duration;
              return next;
            });
          }
        };
        await audio.play();
        setPlaying(true);
        setActive(true);
        setSegIndex(idx);
        failures.current = 0;
        // Prepare the next paragraph while this one plays. Started only once
        // playback is under way, so it never competes with the audio the reader
        // is actually waiting for.
        prefetch(idx + 1);
      } catch {
        // One paragraph failing is not the article failing. A dropped request on
        // a phone, or a paragraph this backend cannot voice, should cost that
        // paragraph and no more — the old behaviour stopped the read entirely
        // and left the reader to start again.
        failures.current += 1;
        if (failures.current < MAX_CONSECUTIVE_FAILURES && idx + 1 < segments.current.length) {
          setSegIndex(idx + 1);
          void playSegment(idx + 1);
          return;
        }
        // Several in a row is the backend being down, not a blip. Stop, and say so.
        failures.current = 0;
        setError('Unable to read this article aloud right now.');
        setPlaying(false);
      } finally {
        setLoading(false);
      }
    },
    [fetchSegment, prefetch, speedIdx],
  );

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const action = playAction({
      playing,
      hasLoadedAudio: !!audio.src,
      loadedVoice: loadedVoiceRef.current,
      selectedVoice: voice,
      segIndex,
    });
    if (action.kind === 'pause') {
      audio.pause();
      setPlaying(false);
    } else if (action.kind === 'resume') {
      void audio.play();
      setPlaying(true);
    } else {
      void playSegment(action.segment);
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    // Detach the segment as well as pausing it. Leaving it attached is what made
    // a voice change after Stop have no effect: the next Play saw a non-empty
    // `src` and simply replayed it, so the new voice was never requested. It
    // also left the audio out of step with `segIndex`, which resets to 0 here
    // while the element still held a later segment.
    detachLoadedAudio();
    // Reading restarts from the top, so audio prepared for a later paragraph is
    // no longer what comes next.
    dropPrefetched();
    failures.current = 0;
    setPlaying(false);
    setActive(false);
    setSegIndex(0);
    setSegTime(0);
  };

  const changeVoice = (v: Voice) => {
    if (v === voice) return;
    // Update the ref first: the re-fetch below runs before `setVoice` has taken
    // effect, and it reads the voice from the ref.
    voiceRef.current = v;
    setVoice(v);
    // Everything prepared ahead is in the voice being left. `fetchSegment` would
    // reject it on use anyway; dropping it here frees the audio now and lets the
    // next paragraph be prepared in the voice the reader actually chose.
    dropPrefetched();
    if (playing) {
      // Re-fetch the current segment in the new voice.
      void playSegment(segIndex);
    }
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  };

  const segCount = segments.current.length;
  const lengthOf = (i: number) => durations[i] ?? estimateSeconds(segments.current[i]?.text || '');
  // Whole-article clock: measured where a segment has played, estimated ahead of
  // that, so the total settles toward the true length as playback proceeds.
  let totalSeconds = 0;
  for (let i = 0; i < segCount; i++) totalSeconds += lengthOf(i);
  let elapsedSeconds = segTime;
  for (let i = 0; i < segIndex && i < segCount; i++) elapsedSeconds += lengthOf(i);
  const percent = totalSeconds > 0 ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : 0;

  /** Seek by clicking the bar. Lands on a paragraph boundary unless the target
   *  falls inside the segment already loaded, which can be scrubbed exactly. */
  const seekTo = (fraction: number) => {
    if (!segCount) return;
    const target = fraction * totalSeconds;
    let acc = 0;
    for (let i = 0; i < segCount; i++) {
      const len = lengthOf(i);
      if (target < acc + len || i === segCount - 1) {
        const audio = audioRef.current;
        if (i === segIndex && audio?.src && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.max(0, Math.min(target - acc, audio.duration));
        } else {
          void playSegment(i);
        }
        return;
      }
      acc += len;
    }
  };

  return (
    <section className={styles.widget}>
      <div className={styles.readAloudHeader}>
        <span className={styles.readAloudTitle}>Read Aloud</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      </div>
      <div className={styles.player}>
        <div className={styles.controls}>
          <button
            className={`${styles.ttsBtn} ${styles.ttsBtnPrimary}`}
            onClick={toggle}
            disabled={loading}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button className={styles.ttsBtn} onClick={stop} aria-label="Stop">
            <svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
          </button>
          <button className={styles.speedBtn} onClick={cycleSpeed} aria-label="Playback speed">
            {SPEEDS[speedIdx]}x
          </button>

          <div className={styles.voiceGroup}>
            <button
              className={`${styles.voiceBtn} ${voice === 'female' ? styles.active : ''}`}
              onClick={() => changeVoice('female')}
              aria-label="Female voice"
              aria-pressed={voice === 'female'}
              title="Female voice"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="4.2" r="2.6" />
                <path d="M12 7.4c2.2 0 3.4 1.3 4 3.2l1.4 4.4c.2.6-.2 1.1-.8 1.1H7.4c-.6 0-1-.5-.8-1.1L8 10.6c.6-1.9 1.8-3.2 4-3.2z" />
                <rect x="9.6" y="16.4" width="1.9" height="5.2" rx=".9" />
                <rect x="12.5" y="16.4" width="1.9" height="5.2" rx=".9" />
              </svg>
            </button>
            <button
              className={`${styles.voiceBtn} ${voice === 'male' ? styles.active : ''}`}
              onClick={() => changeVoice('male')}
              aria-label="Male voice"
              aria-pressed={voice === 'male'}
              title="Male voice"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="4.2" r="2.6" />
                <rect x="8.6" y="7.6" width="6.8" height="7.8" rx="1.6" />
                <rect x="9.4" y="14.6" width="2.1" height="7" rx="1" />
                <rect x="12.5" y="14.6" width="2.1" height="7" rx="1" />
              </svg>
            </button>
          </div>
        </div>

        <div
          className={styles.progress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            seekTo((e.clientX - rect.left) / rect.width);
          }}
        >
          <div className={styles.progressFill} style={{ width: `${percent}%` }} />
        </div>

        <div className={styles.timeRow}>
          {loading ? <span>Loading…</span> : null}
          <span className={styles.timeTotal}>
            <span className={styles.timeElapsed}>{formatTime(elapsedSeconds)}</span>
            {' / '}
            {formatTime(totalSeconds)}
          </span>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
      </div>
    </section>
  );
}

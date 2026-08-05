'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/authStorage';
import { playAction, type Voice } from '@/lib/readAloudPlayback';
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

function segmentize(text: string): string[] {
  return toSpeakableText(text)
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.length > 3500 ? s.slice(0, 3500) : s));
}

/** Class toggled on the article block currently being spoken. */
const ACTIVE_CLASS = 'read-aloud-active';
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, li';

/**
 * Comparison key for matching a spoken segment to a rendered block. Punctuation
 * and whitespace are dropped so markdown/HTML rendering differences (smart
 * quotes, em-dashes, stripped markers) don't prevent a match.
 */
const matchKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);

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
  contentRef,
}: {
  text: string;
  /** Article body container; its blocks get highlighted as they're read. */
  contentRef?: React.RefObject<HTMLElement | null>;
}) {
  const segments = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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

  useEffect(() => {
    segments.current = segmentize(text);
    setDurations([]);
    setSegTime(0);
    // The body itself changed — translating the article swaps it — so audio
    // synthesized from the previous text is no longer what these segments say.
    detachLoadedAudio();
    setSegIndex(0);
    setPlaying(false);
    setActive(false);
  }, [text, detachLoadedAudio]);

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
    };
  }, []);

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
    const key = matchKey(seg);
    if (!key) return;

    const target = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).find((el) => {
      const elKey = matchKey(el.textContent || '');
      return elKey.length > 0 && elKey === key;
    });
    if (!target) return;

    target.classList.add(ACTIVE_CLASS);
    const box = target.getBoundingClientRect();
    if (box.top < 80 || box.bottom > window.innerHeight - 40) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return clear;
  }, [segIndex, active, contentRef, text]);

  const fetchSegment = useCallback(
    async (idx: number): Promise<{ url: string; voice: Voice } | null> => {
      const seg = segments.current[idx];
      if (!seg) return null;
      // Read the selection at call time, and report back which voice was
      // actually requested: the reader can switch again while this is in
      // flight, and the caller must not label the result with the newer choice.
      const requestedVoice = voiceRef.current;
      const token = getAuthToken();
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: seg, voice: requestedVoice, lang: 'en-US' }),
      });
      if (!res.ok) throw new Error('TTS request failed');
      const blob = await res.blob();
      // The backend answers 200 with an empty body when it can't synthesize the
      // text; a 0-byte blob would only surface later as a MediaError.
      if (blob.size === 0) throw new Error('TTS returned empty audio');
      return { url: URL.createObjectURL(blob), voice: requestedVoice };
    },
    [],
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
      } catch {
        setError('Unable to read this article aloud right now.');
        setPlaying(false);
      } finally {
        setLoading(false);
      }
    },
    [fetchSegment, speedIdx],
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
  const lengthOf = (i: number) => durations[i] ?? estimateSeconds(segments.current[i] || '');
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

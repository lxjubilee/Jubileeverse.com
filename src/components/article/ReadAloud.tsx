'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/authStorage';
import styles from './widgets.module.css';

/**
 * Read Aloud (TTS) widget. Streams the article aloud via `POST /api/tts`
 * (returns binary audio/mpeg; `voice` is a gender: 'female' | 'male').
 * The text is split into paragraph segments played sequentially, with
 * play/pause/stop, voice + speed controls, and a seekable progress bar.
 */
const SPEEDS = [1, 1.25, 1.5, 2] as const;

function segmentize(text: string): string[] {
  return text
    .replace(/[#*_>`]/g, '') // strip markdown markers for cleaner speech
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.length > 3500 ? s.slice(0, 3500) : s));
}

export default function ReadAloud({ text }: { text: string }) {
  const segments = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [segIndex, setSegIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [voice, setVoice] = useState<'female' | 'male'>('female');
  const [speedIdx, setSpeedIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    segments.current = segmentize(text);
  }, [text]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  const fetchSegment = useCallback(
    async (idx: number): Promise<string | null> => {
      const seg = segments.current[idx];
      if (!seg) return null;
      const token = getAuthToken();
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: seg, voice, lang: 'en-US' }),
      });
      if (!res.ok) throw new Error('TTS request failed');
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    [voice],
  );

  const playSegment = useCallback(
    async (idx: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (idx >= segments.current.length) {
        setPlaying(false);
        setSegIndex(0);
        setProgress(0);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const url = await fetchSegment(idx);
        if (!url) {
          setPlaying(false);
          return;
        }
        if (audio.src) URL.revokeObjectURL(audio.src);
        audio.src = url;
        audio.playbackRate = SPEEDS[speedIdx];
        audio.onended = () => {
          setSegIndex((i) => {
            const next = i + 1;
            void playSegment(next);
            return next;
          });
        };
        audio.ontimeupdate = () => {
          if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
        };
        await audio.play();
        setPlaying(true);
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
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else if (audio.src) {
      void audio.play();
      setPlaying(true);
    } else {
      void playSegment(0);
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setSegIndex(0);
    setProgress(0);
  };

  const changeVoice = (v: 'female' | 'male') => {
    if (v === voice) return;
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

  const total = segments.current.length || 1;

  return (
    <section className={styles.widget}>
      <div className={styles.widgetTitle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
        Read Aloud
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
          <button className={styles.optionBtn} onClick={cycleSpeed} style={{ flex: '0 0 auto', minWidth: 48 }}>
            {SPEEDS[speedIdx]}×
          </button>
        </div>

        <div className={styles.progress} onClick={(e) => {
          const audio = audioRef.current;
          if (!audio || !audio.duration) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
        }}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>

        <div className={styles.meta}>
          <span>{loading ? 'Loading…' : `Paragraph ${Math.min(segIndex + 1, total)} of ${total}`}</span>
        </div>

        <div className={styles.optionRow}>
          <button
            className={`${styles.optionBtn} ${voice === 'female' ? styles.active : ''}`}
            onClick={() => changeVoice('female')}
          >
            Female
          </button>
          <button
            className={`${styles.optionBtn} ${voice === 'male' ? styles.active : ''}`}
            onClick={() => changeVoice('male')}
          >
            Male
          </button>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
      </div>
    </section>
  );
}

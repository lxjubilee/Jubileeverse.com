'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  prayers,
  getCategoryLabel,
  FILTER_CATEGORIES,
  POPULAR_INDICES,
  RECOMMENDED_INDICES,
  MOBILE_POPULAR_INDICES,
  MOBILE_RECOMMENDED_INDICES,
  FAVORITES_STORAGE_KEY,
  type Prayer,
  type PrayerCategory,
} from './prayers';
import styles from './prayer.module.css';

type FilterValue = 'all' | PrayerCategory;
type VoiceGender = 'female' | 'male';
type AccordionSection = 'prayers' | 'favorites' | 'popular' | 'recommended';

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5];

const badgeClass: Record<PrayerCategory, string> = {
  morning: styles.badgeMorning,
  evening: styles.badgeEvening,
  healing: styles.badgeHealing,
  comfort: styles.badgeComfort,
  gratitude: styles.badgeGratitude,
  protection: styles.badgeProtection,
  guidance: styles.badgeGuidance,
  family: styles.badgeFamily,
};

const catBannerClass: Record<PrayerCategory, string> = {
  morning: styles.catMorning,
  evening: styles.catEvening,
  healing: styles.catHealing,
  comfort: styles.catComfort,
  gratitude: styles.catGratitude,
  protection: styles.catProtection,
  guidance: styles.catGuidance,
  family: styles.catFamily,
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/* ---- localStorage favorites (same key + shape as the original) ---- */
function getFavorites(): number[] {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]') as number[];
  } catch {
    return [];
  }
}

function saveFavorites(favs: number[]): void {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favs));
}

/* ---- Reusable badge ---- */
function CategoryBadge({ category }: { category: PrayerCategory }) {
  return (
    <span className={`${styles.prayerItemBadge} ${badgeClass[category]}`}>
      {getCategoryLabel(category).toUpperCase()}
    </span>
  );
}

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill={filled ? 'var(--accent)' : 'none'}
    stroke="currentColor"
    strokeWidth={2}
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

export default function PrayerPage() {
  // ---- core player state ----
  const [currentPrayerIdx, setCurrentPrayerIdx] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentFilter, setCurrentFilter] = useState<FilterValue>('all');
  const [mobileFilter, setMobileFilter] = useState<FilterValue>('all');
  const [selectedVoiceGender, setSelectedVoiceGender] = useState<VoiceGender>('female');
  const [speedIdx, setSpeedIdx] = useState(1);
  const [speakingLine, setSpeakingLine] = useState<number>(-1);
  const [progressPct, setProgressPct] = useState(0);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [totalTime, setTotalTime] = useState('0:00');
  const [following, setFollowing] = useState(false);
  const [volumePct, setVolumePct] = useState(70);
  const [preMuteVolume, setPreMuteVolume] = useState(70);

  // ---- favorites (re-derived on demand) ----
  const [favorites, setFavorites] = useState<number[]>([]);

  // ---- ui panels ----
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [libraryExpanded, setLibraryExpanded] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<AccordionSection | null>('prayers');

  // ---- refs for layout (auto-scroll the speaking line / reset on change) ----
  const mainContentRef = useRef<HTMLElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

  // ---- refs for the speech engine (mutable, not driving render) ----
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalDurationRef = useRef(0);
  const totalPrayerCharsRef = useRef(0);
  const spokenAbsCharIdxRef = useRef(0);
  const charBaseOffsetRef = useRef(0);
  const pausedAtLineIdxRef = useRef(0);
  const pausedCharWithinLineRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  const speechStartTimeRef = useRef(0);
  const speechRateRef = useRef(1);
  const volumeRef = useRef(70);
  const isPlayingRef = useRef(false);

  // keep refs synced with state used inside speech callbacks
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    speechRateRef.current = SPEED_OPTIONS[speedIdx];
  }, [speedIdx]);
  useEffect(() => {
    volumeRef.current = volumePct;
  }, [volumePct]);

  // Auto-scroll the currently-spoken line into view (mirrors the original).
  useEffect(() => {
    if (speakingLine < 0) return;
    const el = lineRefs.current[speakingLine];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [speakingLine]);

  // Reset the center content scroll position to top when a new prayer loads.
  useEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollTop = 0;
    }
  }, [currentPrayerIdx]);

  const refreshFavorites = useCallback(() => {
    setFavorites(getFavorites());
  }, []);

  const clearProgressTimer = () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  // ============================================================
  // TEXT-TO-SPEECH ENGINE
  // ============================================================
  const estimateDuration = useCallback((lines: string[]): number => {
    const totalChars = lines.join(' ').length;
    return totalChars / 15 / speechRateRef.current;
  }, []);

  const getSelectedVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    const enVoices = voices.filter((v) => v.lang.startsWith('en'));
    const find = (re: RegExp) => enVoices.find((v) => re.test(v.name));

    if (selectedVoiceGender === 'female') {
      return (
        find(/Zira/i) ||
        find(/Samantha/i) ||
        find(/Karen/i) ||
        enVoices.find((v) => /Female/i.test(v.name) && /Natural/i.test(v.name)) ||
        find(/Female/i) ||
        find(/Google US English/i) ||
        find(/Natural/i) ||
        enVoices.find((v) => v.lang === 'en-US') ||
        null
      );
    }
    return (
      find(/David/i) ||
      find(/Mark/i) ||
      find(/Daniel/i) ||
      find(/James/i) ||
      enVoices.find((v) => /Male/i.test(v.name) && /Natural/i.test(v.name)) ||
      find(/Male/i) ||
      find(/Google UK English Male/i) ||
      enVoices.find((v) => v.lang === 'en-GB') ||
      null
    );
  }, [selectedVoiceGender]);

  const updateProgress = useCallback(() => {
    if (!isPlayingRef.current || totalPrayerCharsRef.current <= 0) return;
    const pct = Math.min(100, (spokenAbsCharIdxRef.current / totalPrayerCharsRef.current) * 100);
    setProgressPct(pct);
    const estimatedTime = (pct / 100) * totalDurationRef.current;
    setCurrentTime(formatTime(estimatedTime));
    setTotalTime(formatTime(totalDurationRef.current));
  }, []);

  const speakLines = useCallback(
    (prayer: Prayer, fromLine: number, isResume: boolean, charOffset = 0) => {
      window.speechSynthesis.cancel();
      clearProgressTimer();

      const linesToSpeak = prayer.lines.slice(fromLine);
      if (linesToSpeak.length === 0) return;
      let text = linesToSpeak.join('\n');
      if (charOffset > 0) text = text.substring(charOffset);

      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = speechRateRef.current;
      utt.pitch = 1;
      utt.volume = volumeRef.current / 100;
      const voice = getSelectedVoice();
      if (voice) utt.voice = voice;
      utteranceRef.current = utt;

      totalDurationRef.current = estimateDuration(prayer.lines);
      const remainingDuration = estimateDuration(linesToSpeak);

      totalPrayerCharsRef.current = prayer.lines.join('\n').length;
      let baseChars = 0;
      for (let i = 0; i < fromLine; i++) baseChars += prayer.lines[i].length + 1;
      charBaseOffsetRef.current = baseChars + charOffset;
      spokenAbsCharIdxRef.current = charBaseOffsetRef.current;

      // remainingDuration informs the progress display; elapsed reset on a fresh start
      void remainingDuration;
      if (!isResume) {
        elapsedBeforePauseRef.current = 0;
      }
      speechStartTimeRef.current = Date.now();

      setSpeakingLine(fromLine);

      // Build line-break map for the (possibly sliced) text.
      let charCount = 0;
      const lineBreaks: { start: number; end: number; lineIdx: number; lineCharBase: number }[] = [];
      linesToSpeak.forEach((line, i) => {
        const effectiveLen = i === 0 && charOffset > 0 ? line.length - charOffset : line.length;
        const lineCharBase = i === 0 && charOffset > 0 ? charOffset : 0;
        lineBreaks.push({ start: charCount, end: charCount + effectiveLen, lineIdx: fromLine + i, lineCharBase });
        charCount += effectiveLen + 1;
      });

      utt.onboundary = (e: SpeechSynthesisEvent) => {
        if (e.name === 'word') {
          const charIdx = e.charIndex;
          spokenAbsCharIdxRef.current = charBaseOffsetRef.current + charIdx;
          for (let i = lineBreaks.length - 1; i >= 0; i--) {
            if (charIdx >= lineBreaks[i].start) {
              setSpeakingLine(lineBreaks[i].lineIdx);
              pausedAtLineIdxRef.current = lineBreaks[i].lineIdx;
              pausedCharWithinLineRef.current = lineBreaks[i].lineCharBase + (charIdx - lineBreaks[i].start);
              break;
            }
          }
        }
      };

      utt.onend = () => {
        if (isPlayingRef.current) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          setIsPaused(false);
          elapsedBeforePauseRef.current = 0;
          pausedAtLineIdxRef.current = 0;
          pausedCharWithinLineRef.current = 0;
          setSpeakingLine(-1);
          clearProgressTimer();
          setProgressPct(100);
          const t = formatTime(totalDurationRef.current);
          setCurrentTime(t);
          setTotalTime(t);
        }
      };

      window.speechSynthesis.speak(utt);
      progressTimerRef.current = setInterval(updateProgress, 200);
    },
    [estimateDuration, getSelectedVoice, updateProgress],
  );

  const stopPrayerPlayback = useCallback(() => {
    // Detach handlers so the cancel() below cannot fire a stale "finished" onend.
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onboundary = null;
    }
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setIsPaused(false);
    pausedAtLineIdxRef.current = 0;
    pausedCharWithinLineRef.current = 0;
    elapsedBeforePauseRef.current = 0;
    spokenAbsCharIdxRef.current = 0;
    charBaseOffsetRef.current = 0;
    clearProgressTimer();
    setSpeakingLine(-1);
    setProgressPct(0);
    setCurrentTime('0:00');
  }, []);

  const pausePrayerPlayback = useCallback(() => {
    elapsedBeforePauseRef.current += (Date.now() - speechStartTimeRef.current) / 1000;
    window.speechSynthesis.cancel();
    setIsPaused(true);
    clearProgressTimer();
  }, []);

  // ============================================================
  // SELECTION & PLAYBACK CONTROLS
  // ============================================================
  const selectPrayer = useCallback(
    (idx: number) => {
      if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        setMobileSidebarOpen(false);
      }
      // stop any active/paused playback
      if (isPlayingRef.current || isPaused) {
        stopPrayerPlayback();
        isPlayingRef.current = false;
        setIsPlaying(false);
        setIsPaused(false);
      }
      setCurrentPrayerIdx(idx);
      setProgressPct(0);
      setCurrentTime('0:00');
      setTotalTime('0:00');
      setSpeakingLine(-1);
      setFollowing(false);
    },
    [isPaused, stopPrayerPlayback],
  );

  const playPrayer = useCallback(
    (idx: number) => {
      stopPrayerPlayback();
      setCurrentPrayerIdx(idx);
      isPlayingRef.current = true;
      setIsPlaying(true);
      speakLines(prayers[idx], 0, false);
    },
    [speakLines, stopPrayerPlayback],
  );

  const resumePrayerPlayback = useCallback(() => {
    if (currentPrayerIdx < 0) return;
    setIsPaused(false);
    speakLines(prayers[currentPrayerIdx], pausedAtLineIdxRef.current, true, pausedCharWithinLineRef.current);
  }, [currentPrayerIdx, speakLines]);

  const togglePlay = useCallback(() => {
    if (currentPrayerIdx === -1) {
      if (prayers.length > 0) playPrayer(0);
      return;
    }
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      pausePrayerPlayback();
    } else if (isPaused) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      resumePrayerPlayback();
    } else {
      playPrayer(currentPrayerIdx);
    }
  }, [currentPrayerIdx, isPaused, pausePrayerPlayback, playPrayer, resumePrayerPlayback]);

  const toggleBannerPlay = useCallback(
    (idx: number) => {
      if ((isPlayingRef.current || isPaused) && currentPrayerIdx === idx) {
        togglePlay();
      } else {
        playPrayer(idx);
      }
    },
    [currentPrayerIdx, isPaused, playPrayer, togglePlay],
  );

  const prevPrayer = useCallback(() => {
    if (currentPrayerIdx <= 0) return;
    const newIdx = currentPrayerIdx - 1;
    selectPrayer(newIdx);
    playPrayer(newIdx);
  }, [currentPrayerIdx, playPrayer, selectPrayer]);

  const nextPrayer = useCallback(() => {
    if (currentPrayerIdx >= prayers.length - 1) return;
    const newIdx = currentPrayerIdx + 1;
    selectPrayer(newIdx);
    playPrayer(newIdx);
  }, [currentPrayerIdx, playPrayer, selectPrayer]);

  const setVoiceGender = useCallback(
    (gender: VoiceGender) => {
      setSelectedVoiceGender(gender);
      if (isPlayingRef.current && currentPrayerIdx >= 0) {
        // restart current prayer with the new voice
        setTimeout(() => playPrayer(currentPrayerIdx), 0);
      }
    },
    [currentPrayerIdx, playPrayer],
  );

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEED_OPTIONS.length;
    setSpeedIdx(next);
    speechRateRef.current = SPEED_OPTIONS[next];
    if (isPlayingRef.current && currentPrayerIdx >= 0) {
      setTimeout(() => playPrayer(currentPrayerIdx), 0);
    }
  }, [currentPrayerIdx, playPrayer, speedIdx]);

  // ============================================================
  // FAVORITES
  // ============================================================
  const toggleFavorite = useCallback(
    (idx: number, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      let favs = getFavorites();
      favs = favs.includes(idx) ? favs.filter((i) => i !== idx) : [...favs, idx];
      saveFavorites(favs);
      setFavorites(favs);
    },
    [],
  );

  const removeFavorite = useCallback((idx: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const favs = getFavorites().filter((i) => i !== idx);
    saveFavorites(favs);
    setFavorites(favs);
  }, []);

  const toggleLike = useCallback(() => {
    if (currentPrayerIdx >= 0) toggleFavorite(currentPrayerIdx);
  }, [currentPrayerIdx, toggleFavorite]);

  // ============================================================
  // VOLUME / PROGRESS SEEK
  // ============================================================
  // Apply a volume value (0..1) from a pointer position; restart speech so the
  // new volume takes effect on the in-flight utterance (matches click behavior).
  const applyVolumeFromClientX = useCallback(
    (clientX: number, rect: DOMRect) => {
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newVol = pct * 100;
      setVolumePct(newVol);
      volumeRef.current = newVol;
      if (isPlayingRef.current && utteranceRef.current && currentPrayerIdx >= 0) {
        elapsedBeforePauseRef.current += (Date.now() - speechStartTimeRef.current) / 1000;
        speakLines(prayers[currentPrayerIdx], pausedAtLineIdxRef.current, true, pausedCharWithinLineRef.current);
      }
    },
    [currentPrayerIdx, speakLines],
  );

  const handleVolumeClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      applyVolumeFromClientX(e.clientX, e.currentTarget.getBoundingClientRect());
    },
    [applyVolumeFromClientX],
  );

  // mousedown + document-level drag for the volume bar (in addition to click).
  const handleVolumeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      applyVolumeFromClientX(e.clientX, rect);
      const onMove = (ev: globalThis.MouseEvent) => applyVolumeFromClientX(ev.clientX, rect);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [applyVolumeFromClientX],
  );

  const toggleMute = useCallback(() => {
    if (volumePct > 0) {
      setPreMuteVolume(volumePct);
      setVolumePct(0);
      volumeRef.current = 0;
    } else {
      setVolumePct(preMuteVolume);
      volumeRef.current = preMuteVolume;
    }
    if (isPlayingRef.current && utteranceRef.current && currentPrayerIdx >= 0) {
      elapsedBeforePauseRef.current += (Date.now() - speechStartTimeRef.current) / 1000;
      speakLines(prayers[currentPrayerIdx], pausedAtLineIdxRef.current, true, pausedCharWithinLineRef.current);
    }
  }, [currentPrayerIdx, preMuteVolume, speakLines, volumePct]);

  // Seek to the line under the pointer and (re)start speech there.
  const seekProgressToClientX = useCallback(
    (clientX: number, rect: DOMRect) => {
      if (currentPrayerIdx < 0) return;
      const prayer = prayers[currentPrayerIdx];
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetLine = Math.floor(pct * prayer.lines.length);
      const clampedLine = Math.min(targetLine, prayer.lines.length - 1);

      elapsedBeforePauseRef.current = estimateDuration(prayer.lines.slice(0, clampedLine));
      pausedAtLineIdxRef.current = clampedLine;
      pausedCharWithinLineRef.current = 0;

      if (isPlayingRef.current) {
        speakLines(prayer, clampedLine, true);
      } else {
        isPlayingRef.current = true;
        setIsPlaying(true);
        setIsPaused(false);
        speakLines(prayer, clampedLine, true);
      }
    },
    [currentPrayerIdx, estimateDuration, speakLines],
  );

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      seekProgressToClientX(e.clientX, e.currentTarget.getBoundingClientRect());
    },
    [seekProgressToClientX],
  );

  // mousedown + document-level drag for the progress bar (in addition to click).
  // During the drag we only update the visual fill (cheap); the actual seek /
  // speech-restart is committed once on mouseup to avoid choppy restarts.
  const handleProgressMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (currentPrayerIdx < 0) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      let lastClientX = e.clientX;
      const previewPct = (clientX: number) => {
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        setProgressPct(pct * 100);
      };
      previewPct(lastClientX);
      const onMove = (ev: globalThis.MouseEvent) => {
        lastClientX = ev.clientX;
        previewPct(lastClientX);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        seekProgressToClientX(lastClientX, rect);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [currentPrayerIdx, seekProgressToClientX],
  );

  // ============================================================
  // INIT — load voices, select initial prayer (?prayer= query param)
  // ============================================================
  useEffect(() => {
    refreshFavorites();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    const params = new URLSearchParams(window.location.search);
    const prayerParam = params.get('prayer');
    let initial = 0;
    if (prayerParam !== null) {
      const idx = parseInt(prayerParam, 10);
      if (idx >= 0 && idx < prayers.length) initial = idx;
    }
    setCurrentPrayerIdx(initial);
    setFollowing(false);

    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      clearProgressTimer();
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // DERIVED
  // ============================================================
  const current = currentPrayerIdx >= 0 ? prayers[currentPrayerIdx] : null;
  const filteredPrayers =
    currentFilter === 'all' ? prayers : prayers.filter((p) => p.category === currentFilter);
  const mobileFilteredPrayers =
    mobileFilter === 'all' ? prayers : prayers.filter((p) => p.category === mobileFilter);
  const validMobilePopular = MOBILE_POPULAR_INDICES.filter((i) => prayers[i]);
  const validMobileRecommended = MOBILE_RECOMMENDED_INDICES.filter((i) => prayers[i]);
  const isCurrentFavorite = currentPrayerIdx >= 0 && favorites.includes(currentPrayerIdx);

  const toggleAccordion = (section: AccordionSection) =>
    setOpenAccordion((cur) => (cur === section ? null : section));

  // ============================================================
  // RENDER HELPERS
  // ============================================================
  const renderPrayerItem = (idx: number, opts: { forceFav?: boolean } = {}) => {
    const prayer = prayers[idx];
    if (!prayer) return null;
    const isFav = opts.forceFav ?? favorites.includes(idx);
    return (
      <div
        key={idx}
        className={`${styles.prayerItem} ${idx === currentPrayerIdx ? styles.active : ''}`}
        onClick={() => selectPrayer(idx)}
      >
        <button
          className={`${styles.prayerItemFav} ${isFav ? styles.favorited : ''}`}
          onClick={(e) => toggleFavorite(idx, e)}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <HeartIcon filled={isFav} />
        </button>
        <img className={styles.prayerItemArt} src={prayer.image} alt={prayer.name} loading="lazy" />
        <div className={styles.prayerItemInfo}>
          <div className={styles.prayerItemName}>{prayer.name}</div>
          <div className={styles.prayerItemMeta}>
            <CategoryBadge category={prayer.category} /> {prayer.duration}
          </div>
        </div>
      </div>
    );
  };

  const renderDiscoverCard = (idx: number) => {
    const prayer = prayers[idx];
    if (!prayer) return null;
    return (
      <div key={idx} className={styles.discoverCard} onClick={() => selectPrayer(idx)}>
        <img className={styles.discoverCardArt} src={prayer.image} alt={prayer.name} loading="lazy" />
        <div className={styles.discoverCardInfo}>
          <div className={styles.discoverCardName}>{prayer.name}</div>
          <div className={styles.discoverCardCat}>{getCategoryLabel(prayer.category)}</div>
          <div className={styles.discoverCardDuration}>{prayer.duration}</div>
        </div>
      </div>
    );
  };

  const PlayIcon = () =>
    isPlaying ? (
      <>
        <rect x="6" y="4" width="4" height="16" fill="currentColor" />
        <rect x="14" y="4" width="4" height="16" fill="currentColor" />
      </>
    ) : (
      <polygon points="5 3 19 12 5 21 5 3" />
    );

  return (
    <div className={styles.page}>
      {/* Mobile hamburger */}
      <button
        className={`${styles.hamburgerBtn} ${mobileSidebarOpen ? styles.active : ''}`}
        onClick={() => setMobileSidebarOpen((v) => !v)}
        aria-label="Toggle prayer list"
      >
        <div className={styles.hamburgerIcon}>
          <span />
          <span />
          <span />
        </div>
      </button>

      {/* Mobile sidebar overlay */}
      <div
        className={`${styles.sidebarOverlay} ${mobileSidebarOpen ? styles.active : ''}`}
        onClick={() => setMobileSidebarOpen(false)}
      />

      {/* Three-column layout */}
      <div className={styles.prayerLayout}>
        {/* Left Sidebar — Prayer List */}
        <aside className={`${styles.prayerSidebar} ${mobileSidebarOpen ? styles.active : ''}`}>
          <div className={styles.prayerSidebarHeader}>
            <div className={styles.prayerSidebarTitle}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                <path d="M12 6v6l4 2" />
              </svg>
              Prayers
            </div>
          </div>
          <div className={styles.prayerFilters}>
            <button
              className={`${styles.filterChip} ${currentFilter === 'all' ? styles.active : ''}`}
              onClick={() => setCurrentFilter('all')}
            >
              All
            </button>
            {FILTER_CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`${styles.filterChip} ${currentFilter === cat ? styles.active : ''}`}
                onClick={() => setCurrentFilter(cat)}
              >
                {getCategoryLabel(cat)}
              </button>
            ))}
          </div>
          <div className={styles.prayerList}>
            {filteredPrayers.map((p) => renderPrayerItem(prayers.indexOf(p)))}
          </div>

          {/* Mobile Accordion */}
          <div className={styles.mobileAccordion}>
            {/* Prayers */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('prayers')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  Prayers
                </div>
                <span className={styles.accordionBadge}>{mobileFilteredPrayers.length}</span>
                <svg
                  className={`${styles.accordionToggle} ${openAccordion === 'prayers' ? styles.expanded : ''}`}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'prayers' ? styles.expanded : ''}`}>
                <div className={styles.accordionFilters}>
                  <button
                    className={`${styles.filterChip} ${mobileFilter === 'all' ? styles.active : ''}`}
                    onClick={() => setMobileFilter('all')}
                  >
                    All
                  </button>
                  {FILTER_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      className={`${styles.filterChip} ${mobileFilter === cat ? styles.active : ''}`}
                      onClick={() => setMobileFilter(cat)}
                    >
                      {getCategoryLabel(cat)}
                    </button>
                  ))}
                </div>
                <div className={styles.accordionList}>
                  {mobileFilteredPrayers.length === 0 ? (
                    <div className={styles.accordionEmpty}>No prayers found</div>
                  ) : (
                    mobileFilteredPrayers.map((p) => renderPrayerItem(prayers.indexOf(p)))
                  )}
                </div>
              </div>
            </div>

            {/* Favorite Prayers */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('favorites')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={2}>
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  Favorite Prayers
                </div>
                <span className={styles.accordionBadge}>{favorites.filter((i) => prayers[i]).length}</span>
                <svg
                  className={`${styles.accordionToggle} ${openAccordion === 'favorites' ? styles.expanded : ''}`}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'favorites' ? styles.expanded : ''}`}>
                <div className={styles.accordionList}>
                  {favorites.filter((i) => prayers[i]).length === 0 ? (
                    <div className={styles.accordionEmpty}>
                      No favorite prayers yet
                      <br />
                      <span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                        Tap the heart icon to save prayers
                      </span>
                    </div>
                  ) : (
                    favorites.filter((i) => prayers[i]).map((idx) => renderPrayerItem(idx, { forceFav: true }))
                  )}
                </div>
              </div>
            </div>

            {/* Most Popular */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('popular')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                    <polyline points="17 6 23 6 23 12" />
                  </svg>
                  Most Popular
                </div>
                <span className={styles.accordionBadge}>{validMobilePopular.length}</span>
                <svg
                  className={`${styles.accordionToggle} ${openAccordion === 'popular' ? styles.expanded : ''}`}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'popular' ? styles.expanded : ''}`}>
                <div className={styles.accordionList}>{validMobilePopular.map((idx) => renderPrayerItem(idx))}</div>
              </div>
            </div>

            {/* Recommended For You */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('recommended')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  Recommended For You
                </div>
                <span className={styles.accordionBadge}>{validMobileRecommended.length}</span>
                <svg
                  className={`${styles.accordionToggle} ${openAccordion === 'recommended' ? styles.expanded : ''}`}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'recommended' ? styles.expanded : ''}`}>
                <div className={styles.accordionList}>
                  {validMobileRecommended.map((idx) => renderPrayerItem(idx))}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Center — Prayer Content */}
        <main className={styles.mainContent} ref={mainContentRef}>
          {!current ? (
            <div className={styles.emptyState}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                <path d="M12 6v6l4 2" />
              </svg>
              <h3>Select a prayer</h3>
              <p>Choose a prayer from the list to begin</p>
            </div>
          ) : (
            <>
              <div className={`${styles.prayerBanner} ${catBannerClass[current.category]}`}>
                <img className={styles.prayerBannerArt} src={current.image} alt={current.name} />
                <div className={styles.prayerBannerInfo}>
                  <div className={styles.prayerBannerLabel}>
                    <CategoryBadge category={current.category} /> Prayer
                  </div>
                  <h1 className={styles.prayerBannerTitle}>{current.name}</h1>
                  <div className={styles.prayerBannerDesc}>{current.description}</div>
                  <div className={styles.prayerBannerMeta}>
                    <span>{current.author}</span>
                    <span className={styles.prayerBannerDot} />
                    <span>{current.duration} read</span>
                    <span className={styles.prayerBannerDot} />
                    <span>{current.lines.length} lines</span>
                  </div>
                </div>
              </div>

              <div className={styles.prayerActions}>
                <button
                  className={styles.btnPlayLarge}
                  onClick={() => toggleBannerPlay(currentPrayerIdx)}
                  title="Play"
                >
                  <svg viewBox="0 0 24 24">
                    <PlayIcon />
                  </svg>
                </button>
                <div className={styles.durationBadge}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  {current.duration}
                </div>
                <button
                  className={`${styles.btnFollow} ${following ? styles.following : ''}`}
                  onClick={() => setFollowing((v) => !v)}
                >
                  {following ? 'Saved' : 'Save'}
                </button>
                <div className={styles.voiceSelector}>
                  <span className={styles.voiceSelectorLabel}>Choose Prayer Voice</span>
                  <button
                    className={`${styles.voiceBtn} ${selectedVoiceGender === 'female' ? styles.active : ''}`}
                    onClick={() => setVoiceGender('female')}
                    title="Female voice"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="8" r="5" />
                      <path d="M20 21a8 8 0 0 0-16 0" />
                      <path d="M12 13v2" />
                    </svg>
                    Female
                  </button>
                  <button
                    className={`${styles.voiceBtn} ${selectedVoiceGender === 'male' ? styles.active : ''}`}
                    onClick={() => setVoiceGender('male')}
                    title="Male voice"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="8" r="5" />
                      <path d="M20 21a8 8 0 0 0-16 0" />
                    </svg>
                    Male
                  </button>
                </div>
              </div>

              <div className={styles.scriptureSection}>
                <div className={styles.scriptureCard}>
                  <div className={styles.scriptureLabel}>Scripture</div>
                  <div className={styles.scriptureText}>{current.scripture.text}</div>
                  <div className={styles.scriptureRef}>— {current.scripture.ref}</div>
                </div>
              </div>

              <div className={styles.prayerTextSection}>
                <div className={styles.prayerTextTitle}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
                  </svg>
                  Prayer Text
                </div>
                <div className={styles.prayerTextBody}>
                  {current.lines.map((line, i) => (
                    <div
                      key={i}
                      ref={(el) => {
                        lineRefs.current[i] = el;
                      }}
                      className={`${styles.prayerLine} ${i === speakingLine ? styles.speaking : ''}`}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </main>

        {/* Right Sidebar — Discover */}
        <aside className={styles.discoverSidebar}>
          <div className={styles.librarySection}>
            <div className={styles.libraryHeader} onClick={() => setLibraryExpanded((v) => !v)}>
              <div className={styles.libraryTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                Your Library
              </div>
              <svg
                className={`${styles.libraryToggle} ${libraryExpanded ? styles.expanded : ''}`}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
            <div className={`${styles.libraryContent} ${libraryExpanded ? styles.expanded : ''}`}>
              {favorites.filter((i) => prayers[i]).length === 0 ? (
                <div className={styles.libraryEmpty}>
                  <div className={styles.libraryEmptyIcon}>♡</div>
                  <div>No favorite prayers yet</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Click the heart icon to save prayers</div>
                </div>
              ) : (
                <>
                  <div className={styles.playlistHeader}>Favorite Prayers</div>
                  {favorites
                    .filter((i) => prayers[i])
                    .map((idx) => {
                      const prayer = prayers[idx];
                      return (
                        <div key={idx} className={styles.discoverCard} onClick={() => selectPrayer(idx)}>
                          <img
                            className={styles.discoverCardArt}
                            src={prayer.image}
                            alt={prayer.name}
                            loading="lazy"
                          />
                          <div className={styles.discoverCardInfo}>
                            <div className={styles.discoverCardName}>{prayer.name}</div>
                            <div className={styles.discoverCardCat}>{getCategoryLabel(prayer.category)}</div>
                          </div>
                          <button
                            className={styles.discoverRemoveBtn}
                            onClick={(e) => removeFavorite(idx, e)}
                            title="Remove from favorites"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                </>
              )}
            </div>
          </div>
          <div className={styles.discoverDivider} />
          <div className={styles.discoverTitle}>Most Popular</div>
          {POPULAR_INDICES.map((idx) => renderDiscoverCard(idx))}
          <div className={styles.discoverDivider} />
          <div className={styles.discoverSectionTitle}>Recommended For You</div>
          {RECOMMENDED_INDICES.map((idx) => renderDiscoverCard(idx))}
        </aside>
      </div>

      {/* Sticky Footer Player */}
      <div className={styles.prayerPlayer}>
        {/* Left — Prayer Info */}
        <div className={styles.playerPrayerInfo}>
          <img
            className={styles.playerPrayerArt}
            src={current ? current.image : 'https://images.unsplash.com/photo-1507692049790-de58290a4334?w=120&h=120&fit=crop'}
            alt=""
          />
          <div className={styles.playerPrayerText}>
            <div className={styles.playerPrayerName}>{current ? current.name : 'No prayer selected'}</div>
            <div className={styles.playerPrayerCategory}>
              {current ? `${getCategoryLabel(current.category)} Prayer` : '-'}
            </div>
          </div>
          <button
            className={styles.playerLikeBtn}
            onClick={toggleLike}
            title={isCurrentFavorite ? 'Remove from favorites' : 'Add to favorites'}
            style={{ color: isCurrentFavorite ? 'var(--accent)' : undefined }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill={isCurrentFavorite ? 'var(--accent)' : 'none'}
              stroke={isCurrentFavorite ? 'var(--accent)' : 'currentColor'}
              strokeWidth={2}
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>

        {/* Center — Controls */}
        <div className={styles.playerControls}>
          <div className={styles.playerButtons}>
            <button className={styles.playerBtnSecondary} onClick={prevPrayer} title="Previous">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
              </svg>
            </button>
            <button className={styles.playerBtnPlay} onClick={togglePlay} title="Play">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <PlayIcon />
              </svg>
            </button>
            <button className={styles.playerBtnSecondary} onClick={nextPrayer} title="Next">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 18h2V6h-2v12zM6 18l8.5-6L6 6v12z" />
              </svg>
            </button>
          </div>
          <div className={styles.playerProgressRow}>
            <span className={styles.playerTime}>{currentTime}</span>
            <div
              className={styles.progressBar}
              onClick={handleProgressClick}
              onMouseDown={handleProgressMouseDown}
            >
              <div className={styles.progressFill} style={{ width: `${progressPct}%` }}>
                <div className={styles.progressKnob} />
              </div>
            </div>
            <span className={styles.playerTime}>{totalTime}</span>
          </div>
        </div>

        {/* Right — Speed & Volume */}
        <div className={styles.playerRight}>
          <button className={styles.speedBtn} onClick={cycleSpeed} title="Playback speed">
            {SPEED_OPTIONS[speedIdx]}x
          </button>
          <button className={styles.volumeBtn} title="Volume" onClick={toggleMute}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              {volumePct <= 0 ? (
                <>
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </>
              ) : volumePct < 40 ? (
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              ) : (
                <>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </>
              )}
            </svg>
          </button>
          <div
            className={styles.volumeBar}
            onClick={handleVolumeClick}
            onMouseDown={handleVolumeMouseDown}
          >
            <div className={styles.volumeFill} style={{ width: `${volumePct}%` }}>
              <div className={styles.volumeKnob} />
            </div>
          </div>
        </div>
      </div>

      {/* Favorites Overlay + Panel (opened programmatically; kept for parity) */}
      <div
        className={`${styles.favoritesOverlay} ${favoritesOpen ? styles.visible : ''}`}
        onClick={() => setFavoritesOpen(false)}
      />
      <div className={`${styles.favoritesPanel} ${favoritesOpen ? styles.open : ''}`}>
        <div className={styles.favoritesPanelHeader}>
          <div className={styles.favoritesPanelTitle}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth={2}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            Favorite Prayers
          </div>
          <button className={styles.favoritesPanelClose} onClick={() => setFavoritesOpen(false)} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.favoritesPanelList}>
          {favorites.filter((i) => prayers[i]).length === 0 ? (
            <div className={styles.favoritesEmpty}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              <p>
                No favorite prayers yet.
                <br />
                Tap the heart icon next to any prayer to add it here.
              </p>
            </div>
          ) : (
            favorites
              .filter((i) => prayers[i])
              .map((idx) => {
                const prayer = prayers[idx];
                return (
                  <div
                    key={idx}
                    className={styles.favPanelItem}
                    onClick={() => {
                      setFavoritesOpen(false);
                      selectPrayer(idx);
                    }}
                  >
                    <img className={styles.favPanelItemArt} src={prayer.image} alt={prayer.name} loading="lazy" />
                    <div className={styles.favPanelItemInfo}>
                      <div className={styles.favPanelItemName}>{prayer.name}</div>
                      <div className={styles.favPanelItemMeta}>
                        <CategoryBadge category={prayer.category} /> {prayer.duration}
                      </div>
                    </div>
                    <button
                      className={styles.favPanelRemove}
                      onClick={(e) => removeFavorite(idx, e)}
                      title="Remove from favorites"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}

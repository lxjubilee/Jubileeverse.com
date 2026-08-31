'use client';

/**
 * Music / Albums module — converted from the original static `music.html`.
 *
 * The original page synthesizes audio procedurally with the Web Audio API
 * (there are NO external audio file/stream URLs in the source). That synth
 * engine *is* the page's real audio playback, so it is preserved faithfully
 * here, driven by React state/refs. A real <audio> element would have nothing
 * to play, so we keep the Web Audio engine instead.
 *
 * The shared site chrome (header / nav / footer) is supplied by the (site)
 * layout, so the original page's own <header> and "Back to Home" link are
 * intentionally not rendered.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import styles from './music.module.css';

// ============================================================================
// DATA STRUCTURES
// ============================================================================

interface Track {
  title: string;
  /** "m:ss" */
  duration: string;
}

interface Album {
  name: string;
  artist: string;
  image: string;
  year: number;
  listeners: string;
  tracks: Track[];
}

/** Per-album procedural-audio recipe used by the Web Audio synth engine. */
interface AlbumAudio {
  chords: number[][];
  bpm: number;
  wave: OscillatorType;
}

// ============================================================================
// ALBUM & TRACK DATA (verbatim from music.html)
// ============================================================================

const albums: Album[] = [
  {
    name: 'Thriller',
    artist: 'Michael Jackson',
    image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=400&fit=crop',
    year: 1982,
    listeners: '8.5M monthly listeners',
    tracks: [
      { title: "Wanna Be Startin' Somethin'", duration: '6:03' },
      { title: 'Baby Be Mine', duration: '4:20' },
      { title: 'The Girl Is Mine', duration: '3:42' },
      { title: 'Thriller', duration: '5:57' },
      { title: 'Beat It', duration: '4:18' },
      { title: 'Billie Jean', duration: '4:54' },
      { title: 'Human Nature', duration: '4:06' },
      { title: 'P.Y.T. (Pretty Young Thing)', duration: '3:59' },
      { title: 'The Lady in My Life', duration: '5:00' },
    ],
  },
  {
    name: '21',
    artist: 'Adele',
    image: 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=400&h=400&fit=crop',
    year: 2011,
    listeners: '52M monthly listeners',
    tracks: [
      { title: 'Rolling in the Deep', duration: '3:48' },
      { title: 'Rumour Has It', duration: '3:43' },
      { title: 'Turning Tables', duration: '4:10' },
      { title: "Don't You Remember", duration: '3:03' },
      { title: 'Set Fire to the Rain', duration: '4:02' },
      { title: "He Won't Go", duration: '4:37' },
      { title: 'Take It All', duration: '3:48' },
      { title: "I'll Be Waiting", duration: '4:01' },
      { title: 'One and Only', duration: '5:48' },
      { title: 'Lovesong', duration: '5:16' },
      { title: 'Someone Like You', duration: '4:45' },
    ],
  },
  {
    name: '÷ (Divide)',
    artist: 'Ed Sheeran',
    image: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&h=400&fit=crop',
    year: 2017,
    listeners: '78M monthly listeners',
    tracks: [
      { title: 'Eraser', duration: '3:47' },
      { title: 'Castle on the Hill', duration: '4:21' },
      { title: 'Dive', duration: '3:58' },
      { title: 'Shape of You', duration: '3:53' },
      { title: 'Perfect', duration: '4:23' },
      { title: 'Galway Girl', duration: '2:50' },
      { title: 'Happier', duration: '3:27' },
      { title: 'New Man', duration: '3:09' },
      { title: "Hearts Don't Break Around Here", duration: '4:08' },
      { title: 'What Do I Know?', duration: '3:57' },
      { title: 'How Would You Feel (Paean)', duration: '4:40' },
      { title: 'Supermarket Flowers', duration: '3:41' },
    ],
  },
  {
    name: "1989 (Taylor's Version)",
    artist: 'Taylor Swift',
    image: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=400&h=400&fit=crop',
    year: 2023,
    listeners: '93M monthly listeners',
    tracks: [
      { title: "Welcome to New York (Taylor's Version)", duration: '3:32' },
      { title: "Blank Space (Taylor's Version)", duration: '3:51' },
      { title: "Style (Taylor's Version)", duration: '3:50' },
      { title: "Out of the Woods (Taylor's Version)", duration: '3:55' },
      { title: "All You Had to Do Was Stay (Taylor's Version)", duration: '3:13' },
      { title: "Shake It Off (Taylor's Version)", duration: '3:39' },
      { title: "I Wish You Would (Taylor's Version)", duration: '3:27' },
      { title: "Bad Blood (Taylor's Version)", duration: '3:31' },
      { title: "Wildest Dreams (Taylor's Version)", duration: '3:40' },
      { title: "How You Get the Girl (Taylor's Version)", duration: '4:07' },
      { title: "This Love (Taylor's Version)", duration: '4:10' },
      { title: "I Know Places (Taylor's Version)", duration: '3:15' },
      { title: "Clean (Taylor's Version)", duration: '4:30' },
    ],
  },
  {
    name: 'After Hours',
    artist: 'The Weeknd',
    image: 'https://images.unsplash.com/photo-1477233534935-f5e6fe7c1159?w=400&h=400&fit=crop',
    year: 2020,
    listeners: '112M monthly listeners',
    tracks: [
      { title: 'Alone Again', duration: '4:10' },
      { title: 'Too Late', duration: '3:59' },
      { title: 'Hardest to Love', duration: '3:31' },
      { title: 'Scared to Live', duration: '3:10' },
      { title: 'Snowchild', duration: '4:07' },
      { title: 'Escape from LA', duration: '5:55' },
      { title: 'Heartless', duration: '3:18' },
      { title: 'Faith', duration: '4:43' },
      { title: 'Blinding Lights', duration: '3:20' },
      { title: 'In Your Eyes', duration: '3:57' },
      { title: 'Save Your Tears', duration: '3:35' },
      { title: 'Repeat After Me (Interlude)', duration: '3:15' },
      { title: 'After Hours', duration: '6:01' },
      { title: 'Until I Bleed Out', duration: '3:10' },
    ],
  },
  {
    name: 'Fine Line',
    artist: 'Harry Styles',
    image: 'https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=400&h=400&fit=crop',
    year: 2019,
    listeners: '49M monthly listeners',
    tracks: [
      { title: 'Golden', duration: '3:28' },
      { title: 'Watermelon Sugar', duration: '2:54' },
      { title: 'Adore You', duration: '3:27' },
      { title: 'Lights Up', duration: '2:52' },
      { title: 'Cherry', duration: '4:11' },
      { title: 'Falling', duration: '4:00' },
      { title: 'To Be So Lonely', duration: '3:13' },
      { title: 'She', duration: '5:59' },
      { title: 'Sunflower, Vol. 6', duration: '4:42' },
      { title: 'Canyon Moon', duration: '3:10' },
      { title: 'Treat People with Kindness', duration: '3:36' },
      { title: 'Fine Line', duration: '6:18' },
    ],
  },
  {
    name: 'Happier Than Ever',
    artist: 'Billie Eilish',
    image: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=400&h=400&fit=crop',
    year: 2021,
    listeners: '99M monthly listeners',
    tracks: [
      { title: 'Getting Older', duration: '4:04' },
      { title: "I Didn't Change My Number", duration: '2:38' },
      { title: 'Billie Bossa Nova', duration: '3:16' },
      { title: 'my future', duration: '3:30' },
      { title: 'Oxytocin', duration: '3:30' },
      { title: 'GOLDWING', duration: '2:31' },
      { title: 'Lost Cause', duration: '3:32' },
      { title: "Halley's Comet", duration: '3:53' },
      { title: 'Not My Responsibility', duration: '3:47' },
      { title: 'OverHeated', duration: '3:34' },
      { title: 'Everybody Dies', duration: '3:13' },
      { title: 'Your Power', duration: '4:05' },
      { title: 'NDA', duration: '3:15' },
      { title: 'Therefore I Am', duration: '2:54' },
      { title: 'Happier Than Ever', duration: '4:58' },
      { title: 'Male Fantasy', duration: '3:14' },
    ],
  },
  {
    name: 'Midnights',
    artist: 'Taylor Swift',
    image: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=400&h=400&fit=crop',
    year: 2022,
    listeners: '93M monthly listeners',
    tracks: [
      { title: 'Lavender Haze', duration: '3:22' },
      { title: 'Maroon', duration: '3:38' },
      { title: 'Anti-Hero', duration: '3:20' },
      { title: 'Snow On The Beach (feat. Lana Del Rey)', duration: '4:16' },
      { title: "You're On Your Own, Kid", duration: '3:14' },
      { title: 'Midnight Rain', duration: '2:54' },
      { title: 'Question...?', duration: '3:30' },
      { title: 'Vigilante Shit', duration: '2:44' },
      { title: 'Bejeweled', duration: '3:14' },
      { title: 'Labyrinth', duration: '4:07' },
      { title: 'Karma', duration: '3:24' },
      { title: 'Sweet Nothing', duration: '3:08' },
      { title: 'Mastermind', duration: '3:11' },
    ],
  },
];

// Each album: 4 chords (MIDI notes), BPM, waveform for arpeggio.
const ALBUM_AUDIO: AlbumAudio[] = [
  { chords: [[48, 52, 55, 59], [50, 54, 57, 62], [45, 48, 52, 57], [48, 52, 55, 59]], bpm: 118, wave: 'square' },
  { chords: [[53, 57, 60, 64], [48, 52, 55, 60], [55, 59, 62, 67], [53, 57, 60, 64]], bpm: 68, wave: 'sine' },
  { chords: [[50, 54, 57, 62], [55, 59, 62, 67], [47, 50, 54, 59], [50, 54, 57, 62]], bpm: 95, wave: 'triangle' },
  { chords: [[52, 56, 59, 64], [57, 61, 64, 69], [54, 57, 61, 66], [52, 56, 59, 64]], bpm: 120, wave: 'sawtooth' },
  { chords: [[45, 48, 52, 57], [50, 54, 57, 62], [47, 51, 54, 59], [45, 48, 52, 57]], bpm: 102, wave: 'square' },
  { chords: [[48, 52, 55, 60], [53, 57, 60, 65], [55, 59, 62, 67], [48, 52, 55, 60]], bpm: 110, wave: 'triangle' },
  { chords: [[51, 55, 58, 63], [56, 60, 63, 68], [53, 57, 60, 65], [51, 55, 58, 63]], bpm: 76, wave: 'sine' },
  { chords: [[54, 58, 61, 66], [59, 62, 66, 71], [56, 59, 63, 68], [54, 58, 61, 66]], bpm: 108, wave: 'sawtooth' },
];

const CHORD_ORDERS: number[][] = [
  [0, 1, 2, 3], [0, 2, 1, 3], [2, 0, 3, 1], [0, 3, 1, 2], [1, 0, 2, 3],
  [3, 2, 1, 0], [0, 1, 3, 2], [2, 3, 0, 1], [0, 2, 3, 1], [1, 2, 0, 3],
];

const ARP_PATTERNS: number[][] = [[0, 1, 2, 3], [0, 2, 1, 3], [3, 2, 1, 0], [0, 3, 1, 2]];

const POPULAR_INDICES = [5, 6, 4, 1];
const VIRAL_INDICES = [7, 3, 0, 2];

const DEFAULT_PLAYER_ART =
  'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=120&h=120&fit=crop';

// ============================================================================
// HELPERS
// ============================================================================

function midiFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function durationToSeconds(duration: string): number {
  const parts = duration.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function albumTotalDuration(album: Album): { min: number; sec: number } {
  const totalSeconds = album.tracks.reduce((acc, t) => acc + durationToSeconds(t.duration), 0);
  return { min: Math.floor(totalSeconds / 60), sec: totalSeconds % 60 };
}

interface ActiveAudioConfig {
  chords: number[][];
  chordOrder: number[];
  beat: number;
  wave: OscillatorType;
  arpPattern: number[];
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function MusicPage() {
  // --- Playback / selection state ---
  const [currentAlbumIdx, setCurrentAlbumIdx] = useState<number>(-1);
  const [currentTrackIdx, setCurrentTrackIdx] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [following, setFollowing] = useState(true); // original starts as "Following"
  const [activeFilter, setActiveFilter] = useState<'albums' | 'playlists'>('albums');

  // --- Progress / volume state ---
  const [elapsed, setElapsed] = useState(0);
  const [volume, setVolume] = useState(0.7);

  // --- Mobile UI state ---
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [expandedAccordion, setExpandedAccordion] = useState<'albums' | 'popular' | null>('albums');

  // --- Web Audio engine refs (do not trigger re-render) ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const schedulerIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioBeatRef = useRef(0);
  const audioNextTimeRef = useRef(0);
  const audioConfigRef = useRef<ActiveAudioConfig | null>(null);
  const preMuteVolumeRef = useRef(0.7);

  // --- Progress timer + a live mirror of isPlaying for callbacks/intervals ---
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPlayingRef = useRef(false);
  const elapsedRef = useRef(0);
  const mainContentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  const currentAlbum = currentAlbumIdx >= 0 ? albums[currentAlbumIdx] : null;
  const currentTrack =
    currentAlbum && currentTrackIdx >= 0 ? currentAlbum.tracks[currentTrackIdx] : null;
  const currentTrackTotalSec = currentTrack ? durationToSeconds(currentTrack.duration) : 0;

  // ==========================================================================
  // WEB AUDIO ENGINE
  // ==========================================================================

  const setAudioVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    if (masterGainRef.current) masterGainRef.current.gain.value = clamped;
  }, []);

  const initAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      masterGainRef.current = gain;
    }
    if (audioCtxRef.current.state === 'suspended') void audioCtxRef.current.resume();
  }, [volume]);

  const synthNote = useCallback(
    (freq: number, start: number, dur: number, wave: OscillatorType, vol: number) => {
      const ctx = audioCtxRef.current;
      const master = masterGainRef.current;
      if (!ctx || !master) return;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const flt = ctx.createBiquadFilter();
      osc.type = wave;
      osc.frequency.value = freq;
      flt.type = 'lowpass';
      flt.frequency.value = 2000;
      flt.Q.value = 0.7;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(vol, start + 0.05);
      env.gain.linearRampToValueAtTime(vol * 0.8, start + dur * 0.6);
      env.gain.linearRampToValueAtTime(0.001, start + dur);
      osc.connect(flt);
      flt.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    },
    [],
  );

  const audioSchedule = useCallback(() => {
    const ctx = audioCtxRef.current;
    const cfg = audioConfigRef.current;
    if (!isPlayingRef.current || !ctx || !cfg) return;
    const { chords, chordOrder, beat, wave, arpPattern } = cfg;

    while (audioNextTimeRef.current < ctx.currentTime + 0.3) {
      const ci = chordOrder[Math.floor(audioBeatRef.current / 4) % 4];
      const chord = chords[ci];
      const bib = audioBeatRef.current % 4;

      // Pad chord on first beat of each bar
      if (bib === 0) {
        synthNote(midiFreq(chord[0] - 12), audioNextTimeRef.current, beat * 3.8, 'sine', 0.12);
        chord.forEach((n) => synthNote(midiFreq(n), audioNextTimeRef.current, beat * 3.8, 'sine', 0.05));
      }

      // Arpeggio melody on each beat
      const arpIdx = arpPattern[bib];
      synthNote(midiFreq(chord[arpIdx] + 12), audioNextTimeRef.current, beat * 0.6, wave, 0.07);

      // Higher accent on beats 2 and 4
      if (bib === 1 || bib === 3) {
        const acIdx = arpPattern[(bib + 1) % 4];
        synthNote(midiFreq(chord[acIdx] + 24), audioNextTimeRef.current + beat * 0.25, beat * 0.3, 'sine', 0.025);
      }

      audioNextTimeRef.current += beat;
      audioBeatRef.current += 1;
    }
  }, [synthNote]);

  const stopAudioPlayback = useCallback(() => {
    if (schedulerIdRef.current) {
      clearInterval(schedulerIdRef.current);
      schedulerIdRef.current = null;
    }
  }, []);

  const startAudioPlayback = useCallback(
    (albumIdx: number, trackIdx: number) => {
      initAudioCtx();
      stopAudioPlayback();
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const cfg = ALBUM_AUDIO[albumIdx];
      audioConfigRef.current = {
        chords: cfg.chords,
        chordOrder: CHORD_ORDERS[trackIdx % CHORD_ORDERS.length],
        beat: 60 / cfg.bpm,
        wave: cfg.wave,
        arpPattern: ARP_PATTERNS[trackIdx % ARP_PATTERNS.length],
      };
      audioBeatRef.current = 0;
      audioNextTimeRef.current = ctx.currentTime + 0.1;
      schedulerIdRef.current = setInterval(audioSchedule, 50);
    },
    [audioSchedule, initAudioCtx, stopAudioPlayback],
  );

  const resumeAudioPlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !audioConfigRef.current) return;
    if (ctx.state === 'suspended') void ctx.resume();
    audioNextTimeRef.current = ctx.currentTime + 0.1;
    schedulerIdRef.current = setInterval(audioSchedule, 50);
  }, [audioSchedule]);

  // Keep the live gain node in sync with React volume state.
  useEffect(() => {
    setAudioVolume(volume);
  }, [volume, setAudioVolume]);

  // ==========================================================================
  // PLAYBACK CONTROLS
  // ==========================================================================

  const clearProgressTimer = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // Use a ref-routed nextTrack so the progress interval always sees the latest.
  const nextTrackRef = useRef<() => void>(() => {});

  const playTrack = useCallback(
    (albumIdx: number, trackIdx: number) => {
      setCurrentAlbumIdx(albumIdx);
      setCurrentTrackIdx(trackIdx);
      setIsPlaying(true);
      isPlayingRef.current = true;

      const track = albums[albumIdx].tracks[trackIdx];
      const totalSec = durationToSeconds(track.duration);

      // Reset progress
      setElapsed(0);
      elapsedRef.current = 0;

      clearProgressTimer();
      progressIntervalRef.current = setInterval(() => {
        if (!isPlayingRef.current) return;
        const next = elapsedRef.current + 1;
        elapsedRef.current = next;
        setElapsed(next);
        if (next >= totalSec) {
          nextTrackRef.current();
        }
      }, 1000);

      startAudioPlayback(albumIdx, trackIdx);
    },
    [clearProgressTimer, startAudioPlayback],
  );

  const nextTrack = useCallback(() => {
    if (currentAlbumIdx < 0) return;
    const album = albums[currentAlbumIdx];
    let newIdx: number;
    if (isShuffled) {
      newIdx = Math.floor(Math.random() * album.tracks.length);
    } else {
      newIdx = currentTrackIdx + 1;
      if (newIdx >= album.tracks.length) {
        if (isRepeating) {
          newIdx = 0;
        } else {
          clearProgressTimer();
          stopAudioPlayback();
          setIsPlaying(false);
          isPlayingRef.current = false;
          return;
        }
      }
    }
    playTrack(currentAlbumIdx, newIdx);
  }, [currentAlbumIdx, currentTrackIdx, isShuffled, isRepeating, clearProgressTimer, stopAudioPlayback, playTrack]);

  useEffect(() => {
    nextTrackRef.current = nextTrack;
  }, [nextTrack]);

  const prevTrack = useCallback(() => {
    if (currentAlbumIdx < 0) return;
    const album = albums[currentAlbumIdx];
    let newIdx = currentTrackIdx - 1;
    if (newIdx < 0) newIdx = album.tracks.length - 1;
    playTrack(currentAlbumIdx, newIdx);
  }, [currentAlbumIdx, currentTrackIdx, playTrack]);

  const togglePlay = useCallback(() => {
    if (currentTrackIdx === -1) {
      if (currentAlbumIdx >= 0) playTrack(currentAlbumIdx, 0);
      return;
    }
    setIsPlaying((prev) => {
      const next = !prev;
      isPlayingRef.current = next;
      if (next) resumeAudioPlayback();
      else stopAudioPlayback();
      return next;
    });
  }, [currentTrackIdx, currentAlbumIdx, playTrack, resumeAudioPlayback, stopAudioPlayback]);

  const selectAlbum = useCallback((idx: number) => {
    setCurrentAlbumIdx(idx);
    if (mainContentRef.current) mainContentRef.current.scrollTop = 0;
  }, []);

  const toggleBannerPlay = useCallback(
    (idx: number) => {
      if (isPlaying && currentAlbumIdx === idx) {
        togglePlay();
      } else {
        playTrack(idx, 0);
      }
    },
    [isPlaying, currentAlbumIdx, togglePlay, playTrack],
  );

  const shufflePlay = useCallback(
    (albumIdx: number) => {
      setIsShuffled(true);
      const album = albums[albumIdx];
      const randomTrack = Math.floor(Math.random() * album.tracks.length);
      playTrack(albumIdx, randomTrack);
    },
    [playTrack],
  );

  const toggleShuffle = useCallback(() => setIsShuffled((v) => !v), []);
  const toggleRepeat = useCallback(() => setIsRepeating((v) => !v), []);
  const toggleLike = useCallback(() => setIsLiked((v) => !v), []);
  const toggleFollow = useCallback(() => setFollowing((v) => !v), []);

  const seekTrack = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (currentTrackIdx < 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const next = Math.floor(pct * currentTrackTotalSec);
      elapsedRef.current = next;
      setElapsed(next);
    },
    [currentTrackIdx, currentTrackTotalSec],
  );

  const handleVolumeClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(pct);
  }, []);

  const toggleMute = useCallback(() => {
    setVolume((prev) => {
      if (prev > 0) {
        preMuteVolumeRef.current = prev;
        return 0;
      }
      return preMuteVolumeRef.current;
    });
  }, []);

  // ==========================================================================
  // INITIALIZATION — honor ?album= query param, default to first album.
  // ==========================================================================

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const params = new URLSearchParams(window.location.search);
    const albumParam = params.get('album');
    if (albumParam !== null) {
      const idx = parseInt(albumParam, 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < albums.length) {
        selectAlbum(idx);
        playTrack(idx, 0);
      } else {
        selectAlbum(0);
      }
    } else {
      selectAlbum(0);
    }
  }, [selectAlbum, playTrack]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (schedulerIdRef.current) clearInterval(schedulerIdRef.current);
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== 'closed') void ctx.close();
    };
  }, []);

  // ==========================================================================
  // DERIVED VALUES
  // ==========================================================================

  const progressPct = currentTrackTotalSec
    ? Math.min((elapsed / currentTrackTotalSec) * 100, 100)
    : 0;

  const playerArt = currentAlbum ? currentAlbum.image : DEFAULT_PLAYER_ART;
  const playerTrackName = currentTrack ? currentTrack.title : 'No track selected';
  const playerArtist = currentAlbum && currentTrack ? currentAlbum.artist : '-';
  const playerDurationLabel = currentTrack ? currentTrack.duration : '0:00';

  const totals = useMemo(
    () => (currentAlbum ? albumTotalDuration(currentAlbum) : null),
    [currentAlbum],
  );

  const toggleAccordion = useCallback((section: 'albums' | 'popular') => {
    setExpandedAccordion((prev) => (prev === section ? null : section));
  }, []);

  // SVG icons reused in multiple controls
  const playIconSvg = <polygon points="5 3 19 12 5 21 5 3" />;
  const pauseIconSvg = (
    <>
      <rect x="6" y="4" width="4" height="16" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" fill="currentColor" />
    </>
  );

  // ==========================================================================
  // RENDER HELPERS
  // ==========================================================================

  const renderAlbumItem = (idx: number, keyPrefix: string) => {
    const album = albums[idx];
    return (
      <div
        key={`${keyPrefix}${idx}`}
        className={`${styles.albumItem} ${idx === currentAlbumIdx ? styles.active : ''}`}
        onClick={() => {
          selectAlbum(idx);
          closeMobileSidebar();
        }}
      >
        <img className={styles.albumItemArt} src={album.image} alt={album.name} loading="lazy" />
        <div className={styles.albumItemInfo}>
          <div className={styles.albumItemName}>{album.name}</div>
          <div className={styles.albumItemArtist}>Album &bull; {album.artist}</div>
        </div>
      </div>
    );
  };

  const renderPopularCard = (idx: number) => {
    const album = albums[idx];
    return (
      <div key={`pop${idx}`} className={styles.popularCard} onClick={() => selectAlbum(idx)}>
        <img className={styles.popularCardArt} src={album.image} alt={album.name} loading="lazy" />
        <div className={styles.popularCardInfo}>
          <div className={styles.popularCardName}>{album.name}</div>
          <div className={styles.popularCardArtist}>{album.artist}</div>
          <div className={styles.popularCardListeners}>{album.listeners}</div>
        </div>
      </div>
    );
  };

  const closeMobileSidebar = () => setMobileSidebarOpen(false);

  // Lock body scroll while the mobile sidebar is open (matches the original).
  useEffect(() => {
    document.body.style.overflow = mobileSidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileSidebarOpen]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <main className="main-content">
      <div className={styles.musicApp}>
        {/* Mobile hamburger */}
        <button
          className={`${styles.hamburgerBtn} ${mobileSidebarOpen ? styles.active : ''}`}
          onClick={() => setMobileSidebarOpen((v) => !v)}
          aria-label="Toggle library"
          type="button"
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
          onClick={closeMobileSidebar}
        />

        <div className={styles.musicLayout}>
          {/* Left Sidebar - Library */}
          <aside className={`${styles.librarySidebar} ${mobileSidebarOpen ? styles.active : ''}`}>
            {/* Desktop sidebar */}
            <div className={styles.libraryHeader}>
              <div className={styles.libraryTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                Your Library
              </div>
              <button className={styles.libraryAddBtn} title="Create playlist" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
            <div className={styles.libraryFilters}>
              <button
                className={`${styles.filterChip} ${activeFilter === 'albums' ? styles.active : ''}`}
                onClick={() => setActiveFilter('albums')}
                type="button"
              >
                Albums
              </button>
              <button
                className={`${styles.filterChip} ${activeFilter === 'playlists' ? styles.active : ''}`}
                onClick={() => setActiveFilter('playlists')}
                type="button"
              >
                Playlists
              </button>
            </div>
            <div className={styles.librarySearch}>
              <span className={styles.librarySearchLabel}>Recents</span>
              <span className={styles.librarySort}>
                Recents
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </div>
            <div className={styles.albumList} role="list">
              {albums.map((_, idx) => renderAlbumItem(idx, 'album'))}
            </div>

            {/* Mobile accordion */}
            <div className={styles.mobileAccordion}>
              <div className={styles.accordionSection}>
                <div className={styles.accordionHeader} onClick={() => toggleAccordion('albums')}>
                  <div className={styles.accordionTitle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                    Albums
                  </div>
                  <span className={styles.accordionBadge}>{albums.length}</span>
                  <svg
                    className={`${styles.accordionToggle} ${expandedAccordion === 'albums' ? styles.expanded : ''}`}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                <div className={`${styles.accordionContent} ${expandedAccordion === 'albums' ? styles.expanded : ''}`}>
                  <div>{albums.map((_, idx) => renderAlbumItem(idx, 'mAlbum'))}</div>
                </div>
              </div>
              <div className={styles.accordionSection}>
                <div className={styles.accordionHeader} onClick={() => toggleAccordion('popular')}>
                  <div className={styles.accordionTitle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    Popular
                  </div>
                  <svg
                    className={`${styles.accordionToggle} ${expandedAccordion === 'popular' ? styles.expanded : ''}`}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                <div className={`${styles.accordionContent} ${expandedAccordion === 'popular' ? styles.expanded : ''}`}>
                  <div>{POPULAR_INDICES.map((idx) => renderAlbumItem(idx, 'mPop'))}</div>
                </div>
              </div>
            </div>
          </aside>

          {/* Center - Album Content */}
          <main className={styles.mainContent} ref={mainContentRef}>
            {currentAlbum ? (
              <>
                <div className={styles.albumBanner}>
                  <img className={styles.albumBannerArt} src={currentAlbum.image} alt={currentAlbum.name} />
                  <div className={styles.albumBannerInfo}>
                    <div className={styles.albumBannerLabel}>Album</div>
                    <h1 className={styles.albumBannerTitle}>{currentAlbum.name}</h1>
                    <div className={styles.albumBannerMeta}>
                      <span className={styles.albumBannerArtist}>{currentAlbum.artist}</span>
                      <span className={styles.albumBannerDot} />
                      <span>{currentAlbum.year}</span>
                      <span className={styles.albumBannerDot} />
                      <span>
                        {currentAlbum.tracks.length} songs, {totals?.min} min {totals?.sec} sec
                      </span>
                    </div>
                    <div className={styles.albumBannerListeners}>{currentAlbum.listeners}</div>
                  </div>
                </div>
                <div className={styles.albumActions}>
                  <button
                    className={styles.btnPlayLarge}
                    onClick={() => toggleBannerPlay(currentAlbumIdx)}
                    title="Play"
                    type="button"
                  >
                    <svg viewBox="0 0 24 24">
                      {isPlaying && currentAlbumIdx >= 0 ? pauseIconSvg : playIconSvg}
                    </svg>
                  </button>
                  <button
                    className={styles.btnShuffle}
                    onClick={() => shufflePlay(currentAlbumIdx)}
                    title="Shuffle play"
                    type="button"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="16 3 21 3 21 8" />
                      <line x1="4" y1="20" x2="21" y2="3" />
                      <polyline points="21 16 21 21 16 21" />
                      <line x1="15" y1="15" x2="21" y2="21" />
                      <line x1="4" y1="4" x2="9" y2="9" />
                    </svg>
                  </button>
                  <button
                    className={`${styles.btnFollow} ${following ? styles.following : ''}`}
                    onClick={toggleFollow}
                    type="button"
                  >
                    {following ? 'Following' : 'Follow'}
                  </button>
                  <button className={styles.btnMore} title="More options" type="button">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>
                </div>
                <div className={styles.trackList}>
                  <div className={styles.trackHeader}>
                    <span>#</span>
                    <span>Title</span>
                    <span style={{ textAlign: 'right' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </span>
                  </div>
                  {currentAlbum.tracks.map((track, ti) => {
                    const playing = currentAlbumIdx >= 0 && currentTrackIdx === ti;
                    return (
                      <div
                        key={ti}
                        className={`${styles.trackRow} ${playing ? styles.playing : ''}`}
                        onClick={() => playTrack(currentAlbumIdx, ti)}
                      >
                        <div className={styles.trackNum}>
                          <span className={styles.trackNumText}>{ti + 1}</span>
                          <span className={styles.trackNumPlay}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                          </span>
                        </div>
                        <div className={styles.trackInfo}>
                          <div className={styles.trackTitle}>{track.title}</div>
                        </div>
                        <div className={styles.trackDuration}>{track.duration}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
                </svg>
                <h3>Select an album</h3>
                <p>Choose an album from your library to start listening</p>
              </div>
            )}
          </main>

          {/* Right Sidebar - Popular */}
          <aside className={styles.popularSidebar}>
            <div className={styles.popularTitle}>Popular Albums</div>
            {POPULAR_INDICES.map((idx) => renderPopularCard(idx))}
            <div className={styles.popularDivider} />
            <div className={styles.popularSectionTitle}>Viral Worship</div>
            {VIRAL_INDICES.map((idx) => renderPopularCard(idx))}
          </aside>
        </div>

        {/* Sticky Footer Player */}
        <div className={styles.musicPlayer}>
          {/* Left - Track Info */}
          <div className={styles.playerTrackInfo}>
            <img className={styles.playerTrackArt} src={playerArt} alt="" />
            <div className={styles.playerTrackText}>
              <div className={styles.playerTrackName}>{playerTrackName}</div>
              <div className={styles.playerTrackArtist}>{playerArtist}</div>
            </div>
            <button
              className={`${styles.playerTrackLike} ${isLiked ? styles.liked : ''}`}
              onClick={toggleLike}
              title="Like"
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={isLiked ? 'var(--accent)' : 'none'}
                stroke={isLiked ? 'var(--accent)' : 'currentColor'}
                strokeWidth="2"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          </div>

          {/* Center - Controls */}
          <div className={styles.playerControls}>
            <div className={styles.playerButtons}>
              <button
                className={`${styles.playerBtn} ${isShuffled ? styles.active : ''}`}
                onClick={toggleShuffle}
                title="Shuffle"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 3 21 3 21 8" />
                  <line x1="4" y1="20" x2="21" y2="3" />
                  <polyline points="21 16 21 21 16 21" />
                  <line x1="15" y1="15" x2="21" y2="21" />
                  <line x1="4" y1="4" x2="9" y2="9" />
                </svg>
              </button>
              <button className={styles.playerBtn} onClick={prevTrack} title="Previous" type="button">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                </svg>
              </button>
              <button className={styles.playerBtnPlay} onClick={togglePlay} title="Play" type="button">
                <svg viewBox="0 0 24 24" fill="currentColor">{isPlaying ? pauseIconSvg : playIconSvg}</svg>
              </button>
              <button className={styles.playerBtn} onClick={nextTrack} title="Next" type="button">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
              </button>
              <button
                className={`${styles.playerBtn} ${isRepeating ? styles.active : ''}`}
                onClick={toggleRepeat}
                title="Repeat"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </button>
            </div>
            <div className={styles.playerProgress}>
              <span className={styles.playerTime}>{formatTime(elapsed)}</span>
              <div className={styles.progressBar} onClick={seekTrack}>
                <div className={styles.progressFill} style={{ width: `${progressPct}%` }}>
                  <div className={styles.progressKnob} />
                </div>
              </div>
              <span className={styles.playerTime}>{playerDurationLabel}</span>
            </div>
          </div>

          {/* Right - Volume */}
          <div className={styles.playerVolume}>
            <button className={styles.playerExtraBtn} title="Queue" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            <button className={styles.volumeBtn} title="Volume" onClick={toggleMute} type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {volume > 0 ? <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /> : null}
              </svg>
            </button>
            <div className={styles.volumeBar} onClick={handleVolumeClick}>
              <div className={styles.volumeFill} style={{ width: `${volume * 100}%` }}>
                <div className={styles.volumeKnob} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

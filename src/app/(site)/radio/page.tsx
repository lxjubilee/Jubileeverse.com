'use client';

/**
 * RADIO — live Christian radio streaming page.
 *
 * Faithful conversion of the original static radio.html. Provides:
 *  - A station directory (left sidebar) with genre/category filter chips.
 *  - A center pane with the selected station banner, now-playing, follow,
 *    play button and schedule.
 *  - A discover sidebar (right) with "Your Library" (favorites + follows),
 *    Trending and Recommended stations.
 *  - A mobile accordion (Stations / Favourites / Follows / Trending /
 *    Recommended) behind a hamburger-toggled slide-in sidebar.
 *  - A sticky footer player (now-playing, play/pause, live indicator, volume,
 *    mute) driven by a real <audio> element controlled through a ref.
 *
 * Favorites/follows mirror the original behaviour exactly: when signed in they
 * persist to the backend; otherwise they fall back to localStorage so the page
 * stays usable for anonymous visitors.
 *
 * API (exact methods/paths from the original):
 *   GET    /api/radio/favorites
 *   POST   /api/radio/favorites            { station_id, station_name, station_category, station_image }
 *   DELETE /api/radio/favorites/:stationId
 *   GET    /api/radio/follows
 *   POST   /api/radio/follows              { station_id, station_name, station_category, station_image }
 *   DELETE /api/radio/follows/:stationId
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  stations,
  getStationId,
  TRENDING_INDICES,
  RECOMMENDED_INDICES,
  CATEGORY_BADGE_LABEL,
  type Station,
  type StationCategory,
} from './stations';
import styles from './radio.module.css';

type FilterValue = StationCategory | 'all';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'podcast', label: 'Podcasts' },
  { value: 'music', label: 'Music' },
  { value: 'religious', label: 'Religious' },
];

/** Server shape for a saved favorite/follow row. */
interface SavedStation {
  station_id: string;
  station_name: string;
  station_category: string;
  station_image: string;
}

interface FavoritesResponse {
  success?: boolean;
  favorites?: SavedStation[];
}

interface FollowsResponse {
  success?: boolean;
  follows?: SavedStation[];
}

const FAVORITES_STORAGE_KEY = 'jubileeVerseFavorites';
const FOLLOWS_STORAGE_KEY = 'jubileeVerseFollows';

const BADGE_CLASS: Record<StationCategory, string> = {
  live: styles.badgeLive,
  podcast: styles.badgePodcast,
  music: styles.badgeMusic,
  religious: styles.badgeReligious,
};

const BANNER_CAT_CLASS: Record<StationCategory, string> = {
  live: styles.catLive,
  podcast: styles.catPodcast,
  music: styles.catMusic,
  religious: styles.catReligious,
};

type AccordionKey = 'stations' | 'favorites' | 'follows' | 'trending' | 'recommended';

// --- Small presentational helpers ------------------------------------------

function CategoryBadge({ category }: { category: StationCategory }) {
  return (
    <span className={`${styles.stationItemBadge} ${BADGE_CLASS[category]}`}>
      {CATEGORY_BADGE_LABEL[category]}
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function FollowIcon({ following }: { following: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      {following ? <line x1="23" y1="11" x2="17" y2="11" /> : <path d="M20 8v6M23 11h-6" />}
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------

export default function RadioPage() {
  const { isAuthenticated } = useAuth();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const didInit = useRef(false);

  const [currentStationIdx, setCurrentStationIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFilter, setCurrentFilter] = useState<FilterValue>('all');

  // Sets of station ids ("station-N") for O(1) lookup, matching the original.
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [follows, setFollows] = useState<Set<string>>(new Set());

  const [volume, setVolume] = useState(0.7);
  const preMuteVolume = useRef(0.7);

  // Mobile UI state.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<AccordionKey | null>('stations');
  const [libraryExpanded, setLibraryExpanded] = useState(true);

  const currentStation: Station | undefined = stations[currentStationIdx];

  // Lock body scroll while the mobile sidebar is open (matches the original).
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  // --- localStorage helpers (anonymous fallback) ---------------------------

  const saveFavoritesToLocal = useCallback((set: Set<string>) => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...set]));
    } catch {
      /* ignore quota errors */
    }
  }, []);

  const saveFollowsToLocal = useCallback((set: Set<string>) => {
    try {
      localStorage.setItem(FOLLOWS_STORAGE_KEY, JSON.stringify([...set]));
    } catch {
      /* ignore quota errors */
    }
  }, []);

  const loadFavoritesFromLocal = useCallback((): Set<string> => {
    try {
      const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  }, []);

  const loadFollowsFromLocal = useCallback((): Set<string> => {
    try {
      const stored = localStorage.getItem(FOLLOWS_STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  }, []);

  // --- Load favorites + follows -------------------------------------------

  const loadUserFavorites = useCallback(async () => {
    if (isAuthenticated) {
      try {
        const data = await api.get<FavoritesResponse>('/api/radio/favorites');
        if (data.success && data.favorites) {
          setFavorites(new Set(data.favorites.map((f) => f.station_id)));
          return;
        }
      } catch {
        // fall back to localStorage on error
      }
    }
    setFavorites(loadFavoritesFromLocal());
  }, [isAuthenticated, loadFavoritesFromLocal]);

  const loadUserFollows = useCallback(async () => {
    if (isAuthenticated) {
      try {
        const data = await api.get<FollowsResponse>('/api/radio/follows');
        if (data.success && data.follows) {
          setFollows(new Set(data.follows.map((f) => f.station_id)));
          return;
        }
      } catch {
        // fall back to localStorage on error
      }
    }
    setFollows(loadFollowsFromLocal());
  }, [isAuthenticated, loadFollowsFromLocal]);

  // Initial load + reaction to auth changes.
  useEffect(() => {
    void loadUserFavorites();
    void loadUserFollows();
  }, [loadUserFavorites, loadUserFollows]);

  // Honor ?station=<idx> on first mount (and autoplay, as the original did).
  // Read from window.location directly (client-only) to mirror the original and
  // avoid the useSearchParams() Suspense requirement.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const param = new URLSearchParams(window.location.search).get('station');
    if (param !== null) {
      const idx = parseInt(param, 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < stations.length) {
        setCurrentStationIdx(idx);
        playStation(idx);
        return;
      }
    }
    setCurrentStationIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Toggle favorite / follow -------------------------------------------

  const toggleFavorite = useCallback(
    async (stationIdx: number) => {
      const station = stations[stationIdx];
      const stationId = getStationId(stationIdx);
      const wasFavorited = favorites.has(stationId);

      // Optimistic update.
      const next = new Set(favorites);
      if (wasFavorited) next.delete(stationId);
      else next.add(stationId);
      setFavorites(next);

      if (isAuthenticated) {
        try {
          if (wasFavorited) {
            await api.delete(`/api/radio/favorites/${encodeURIComponent(stationId)}`);
          } else {
            await api.post('/api/radio/favorites', {
              station_id: stationId,
              station_name: station.name,
              station_category: station.category,
              station_image: station.image,
            });
          }
          await loadUserFavorites();
        } catch {
          setFavorites(favorites); // revert
          alert('Failed to update favorites. Please try again.');
        }
      } else {
        saveFavoritesToLocal(next);
      }
    },
    [favorites, isAuthenticated, loadUserFavorites, saveFavoritesToLocal],
  );

  const toggleFollow = useCallback(
    async (stationIdx: number) => {
      const station = stations[stationIdx];
      const stationId = getStationId(stationIdx);
      const wasFollowed = follows.has(stationId);

      const next = new Set(follows);
      if (wasFollowed) next.delete(stationId);
      else next.add(stationId);
      setFollows(next);

      if (isAuthenticated) {
        try {
          if (wasFollowed) {
            await api.delete(`/api/radio/follows/${encodeURIComponent(stationId)}`);
          } else {
            await api.post('/api/radio/follows', {
              station_id: stationId,
              station_name: station.name,
              station_category: station.category,
              station_image: station.image,
            });
          }
          await loadUserFollows();
        } catch {
          setFollows(follows); // revert
          alert('Failed to update follows. Please try again.');
        }
      } else {
        saveFollowsToLocal(next);
      }
    },
    [follows, isAuthenticated, loadUserFollows, saveFollowsToLocal],
  );

  // --- Playback ------------------------------------------------------------

  /**
   * Fully tear down the <audio> element so a LIVE stream cannot replay stale
   * buffered audio on resume. Mirrors the original's `new Audio()`-per-play by
   * pausing, dropping the source and calling load() to reset the media element.
   */
  const tearDownStream = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.src = '';
    audio.load();
  }, []);

  /**
   * Point the audio element at a station's live stream and start it fresh. We
   * reset the element first (load) so it reconnects to the live edge rather
   * than resuming a stale buffer.
   */
  const startStream = useCallback((streamUrl: string) => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    audio.src = streamUrl;
    audio.load();
    void audio.play().catch(() => {
      /* stream may be unreachable / blocked — ignore like the original */
    });
  }, []);

  const playStation = useCallback(
    (idx: number) => {
      const station = stations[idx];
      if (!station) return;
      setCurrentStationIdx(idx);
      setIsPlaying(true);
      // Tear down any prior stream before reconnecting live.
      tearDownStream();
      startStream(station.streamUrl);
    },
    [startStream, tearDownStream],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      // Fully stop: a LIVE stream resumed from a paused <audio> would replay
      // stale buffered audio, so tear the element down instead of pausing.
      tearDownStream();
      setIsPlaying(false);
    } else {
      // Reconnect the currently-selected station's live stream from scratch.
      const station = stations[currentStationIdx];
      if (station) {
        tearDownStream();
        startStream(station.streamUrl);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, currentStationIdx, startStream, tearDownStream]);

  const toggleBannerPlay = useCallback(
    (idx: number) => {
      if (isPlaying && currentStationIdx === idx) {
        togglePlay();
      } else {
        playStation(idx);
      }
    },
    [isPlaying, currentStationIdx, playStation, togglePlay],
  );

  // Select a station (banner + player info) without auto-starting audio.
  const selectStation = useCallback((idx: number) => {
    setCurrentStationIdx(idx);
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, []);

  // Keep the audio element volume in sync.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const handleVolumeClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (pct > 0) preMuteVolume.current = pct;
    setVolume(pct);
  }, []);

  const toggleMute = useCallback(() => {
    setVolume((v) => {
      if (v > 0) {
        preMuteVolume.current = v;
        return 0;
      }
      return preMuteVolume.current || 0.7;
    });
  }, []);

  const togglePlayerLike = useCallback(() => {
    if (currentStationIdx >= 0 && currentStationIdx < stations.length) {
      void toggleFavorite(currentStationIdx);
    }
  }, [currentStationIdx, toggleFavorite]);

  // --- Derived lists -------------------------------------------------------

  const filteredStations = useMemo(
    () =>
      currentFilter === 'all'
        ? stations.map((s, i) => ({ station: s, idx: i }))
        : stations
            .map((s, i) => ({ station: s, idx: i }))
            .filter(({ station }) => station.category === currentFilter),
    [currentFilter],
  );

  const favoriteList = useMemo(
    () =>
      [...favorites]
        .map((id) => {
          const idx = parseInt(id.replace('station-', ''), 10);
          return { idx, station: stations[idx] };
        })
        .filter((f): f is { idx: number; station: Station } => Boolean(f.station)),
    [favorites],
  );

  const followList = useMemo(
    () =>
      [...follows]
        .map((id) => {
          const idx = parseInt(id.replace('station-', ''), 10);
          return { idx, station: stations[idx] };
        })
        .filter((f): f is { idx: number; station: Station } => Boolean(f.station)),
    [follows],
  );

  const currentStationId = getStationId(currentStationIdx);
  const currentIsFavorited = favorites.has(currentStationId);
  const currentIsFollowed = follows.has(currentStationId);

  const toggleAccordion = (key: AccordionKey) => {
    setOpenAccordion((prev) => (prev === key ? null : key));
  };

  // --- Reusable station-row renderer (used by sidebar + mobile lists) ------

  const renderStationRow = (
    idx: number,
    station: Station,
    options: {
      showFollow?: boolean;
      activeHeartOnly?: boolean;
      activeFollowOnly?: boolean;
      showListeners?: boolean;
    } = {},
  ) => {
    const id = getStationId(idx);
    const isFav = options.activeHeartOnly ? true : favorites.has(id);
    const isFollowing = options.activeFollowOnly ? true : follows.has(id);
    return (
      <div
        key={`${id}-${station.name}`}
        className={`${styles.stationItem} ${idx === currentStationIdx ? styles.active : ''}`}
        onClick={() => selectStation(idx)}
      >
        <img className={styles.stationItemArt} src={station.image} alt={station.name} loading="lazy" />
        <div className={styles.stationItemInfo}>
          <div className={styles.stationItemName}>{station.name}</div>
          <div className={styles.stationItemCategory}>
            <CategoryBadge category={station.category} />
            {options.showListeners ? (
              <span className={styles.stationItemListeners}>{station.listeners}</span>
            ) : null}
          </div>
        </div>
        <div className={styles.stationItemActions}>
          <button
            className={`${styles.stationHeartBtn} ${isFav ? styles.favorited : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              void toggleFavorite(idx);
            }}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          >
            <HeartIcon filled={isFav} />
          </button>
          {options.showFollow !== false ? (
            <button
              className={`${styles.stationFollowBtn} ${isFollowing ? styles.following : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                void toggleFollow(idx);
              }}
              title={isFollowing ? 'Unfollow' : 'Follow'}
            >
              {options.activeFollowOnly ? <TrashIcon /> : <FollowIcon following={isFollowing} />}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  // --- Render --------------------------------------------------------------

  return (
    <div className={styles.radio}>
      {/* Hidden audio engine, controlled via ref. */}
      <audio ref={audioRef} crossOrigin="anonymous" preload="none" />

      {/* Mobile hamburger + overlay */}
      <button
        className={`${styles.hamburgerBtn} ${sidebarOpen ? styles.active : ''}`}
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label="Toggle station list"
      >
        <div className={styles.hamburgerIcon}>
          <span />
          <span />
          <span />
        </div>
      </button>
      <div
        className={`${styles.sidebarOverlay} ${sidebarOpen ? styles.active : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div className={styles.radioLayout}>
        {/* ===== Left Sidebar — Stations ===== */}
        <aside className={`${styles.stationSidebar} ${sidebarOpen ? styles.active : ''}`}>
          {/* Desktop structure */}
          <div className={styles.stationHeader}>
            <div className={styles.stationTitle}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="2" />
                <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
                <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
              </svg>
              Radio Stations
            </div>
          </div>
          <div className={styles.stationFilters}>
            {FILTERS.map((f) => (
              <button
                key={f.value}
                className={`${styles.filterChip} ${currentFilter === f.value ? styles.active : ''}`}
                onClick={() => setCurrentFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className={styles.stationList}>
            {filteredStations.map(({ station, idx }) =>
              renderStationRow(idx, station, { showFollow: false, showListeners: true }),
            )}
          </div>

          {/* Mobile accordion */}
          <div className={styles.mobileAccordion}>
            {/* Stations */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('stations')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="2" />
                    <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
                    <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
                  </svg>
                  Radio Stations
                </div>
                <span className={styles.accordionBadge}>{filteredStations.length}</span>
                <span className={`${styles.accordionToggle} ${openAccordion === 'stations' ? styles.expanded : ''}`}>
                  <ChevronIcon />
                </span>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'stations' ? styles.expanded : ''}`}>
                <div className={styles.accordionFilters}>
                  {FILTERS.map((f) => (
                    <button
                      key={f.value}
                      className={`${styles.filterChip} ${currentFilter === f.value ? styles.active : ''}`}
                      onClick={() => setCurrentFilter(f.value)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className={styles.accordionList}>
                  {filteredStations.map(({ station, idx }) => renderStationRow(idx, station))}
                </div>
              </div>
            </div>

            {/* Favourite Channels */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('favorites')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  Favourite Channels
                </div>
                <span className={styles.accordionBadge}>{favoriteList.length}</span>
                <span className={`${styles.accordionToggle} ${openAccordion === 'favorites' ? styles.expanded : ''}`}>
                  <ChevronIcon />
                </span>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'favorites' ? styles.expanded : ''}`}>
                <div className={styles.accordionList}>
                  {favoriteList.length === 0 ? (
                    <div className={styles.accordionEmpty}>
                      No favorite channels yet
                      <span className={styles.accordionEmptyHint}>Tap the heart icon to save stations</span>
                    </div>
                  ) : (
                    favoriteList.map(({ idx, station }) =>
                      renderStationRow(idx, station, { showFollow: false, activeHeartOnly: true }),
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Followed Stations */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('follows')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <path d="M20 8v6M23 11h-6" />
                  </svg>
                  Followed Stations
                </div>
                <span className={styles.accordionBadge}>{followList.length}</span>
                <span className={`${styles.accordionToggle} ${openAccordion === 'follows' ? styles.expanded : ''}`}>
                  <ChevronIcon />
                </span>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'follows' ? styles.expanded : ''}`}>
                <div className={styles.accordionList}>
                  {followList.length === 0 ? (
                    <div className={styles.accordionEmpty}>
                      No followed stations yet
                      <span className={styles.accordionEmptyHint}>Tap the follow button to track stations</span>
                    </div>
                  ) : (
                    followList.map(({ idx, station }) =>
                      renderStationRow(idx, station, { showFollow: true, activeFollowOnly: true }),
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Trending */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('trending')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                    <polyline points="17 6 23 6 23 12" />
                  </svg>
                  Trending Stations
                </div>
                <span className={styles.accordionBadge}>{TRENDING_INDICES.length}</span>
                <span className={`${styles.accordionToggle} ${openAccordion === 'trending' ? styles.expanded : ''}`}>
                  <ChevronIcon />
                </span>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'trending' ? styles.expanded : ''}`}>
                <div className={styles.accordionList}>
                  {TRENDING_INDICES.map((idx) => renderStationRow(idx, stations[idx]))}
                </div>
              </div>
            </div>

            {/* Recommended */}
            <div className={styles.accordionSection}>
              <div className={styles.accordionHeader} onClick={() => toggleAccordion('recommended')}>
                <div className={styles.accordionTitle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  Recommended For You
                </div>
                <span className={styles.accordionBadge}>{RECOMMENDED_INDICES.length}</span>
                <span className={`${styles.accordionToggle} ${openAccordion === 'recommended' ? styles.expanded : ''}`}>
                  <ChevronIcon />
                </span>
              </div>
              <div className={`${styles.accordionContent} ${openAccordion === 'recommended' ? styles.expanded : ''}`}>
                <div className={styles.accordionList}>
                  {RECOMMENDED_INDICES.map((idx) => renderStationRow(idx, stations[idx]))}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ===== Center — Station Content ===== */}
        <main className={styles.mainContent}>
          {currentStation ? (
            <>
              <div className={`${styles.stationBanner} ${BANNER_CAT_CLASS[currentStation.category]}`}>
                <img className={styles.stationBannerArt} src={currentStation.image} alt={currentStation.name} />
                <div className={styles.stationBannerInfo}>
                  <div className={styles.stationBannerLabel}>
                    <CategoryBadge category={currentStation.category} /> Radio Station
                  </div>
                  <h1 className={styles.stationBannerTitle}>{currentStation.name}</h1>
                  <div className={styles.stationBannerDesc}>{currentStation.description}</div>
                  <div className={styles.stationBannerMeta}>
                    <span>{currentStation.listeners}</span>
                    <span className={styles.stationBannerDot} />
                    <span>
                      {currentStation.category === 'live' || currentStation.category === 'music'
                        ? '24/7 Broadcast'
                        : 'On Demand'}
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.stationActions}>
                <button
                  className={styles.btnPlayLarge}
                  onClick={() => toggleBannerPlay(currentStationIdx)}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24">
                      <rect x="6" y="4" width="4" height="16" fill="currentColor" />
                      <rect x="14" y="4" width="4" height="16" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </button>
                <div className={styles.liveBadge}>
                  <span className={styles.liveDot} />
                  {currentStation.category === 'live' ? 'LIVE NOW' : 'ON AIR'}
                </div>
                <button
                  className={`${styles.btnFollow} ${currentIsFollowed ? styles.following : ''}`}
                  onClick={() => void toggleFollow(currentStationIdx)}
                >
                  {currentIsFollowed ? 'Following' : 'Follow'}
                </button>
              </div>

              <div className={styles.nowPlayingSection}>
                <div className={styles.nowPlayingCard}>
                  <div className={styles.nowPlayingLabel}>Now Playing</div>
                  <div className={styles.nowPlayingShow}>{currentStation.currentShow.name}</div>
                  <div className={styles.nowPlayingHost}>Hosted by {currentStation.currentShow.host}</div>
                  <div className={styles.nowPlayingTime}>{currentStation.currentShow.time}</div>
                </div>
              </div>

              <div className={styles.scheduleSection}>
                <div className={styles.scheduleTitle}>
                  {currentStation.category === 'podcast' || currentStation.category === 'religious'
                    ? 'Recent Episodes'
                    : "Today's Schedule"}
                </div>
                {currentStation.schedule.map((item, i) => (
                  <div className={styles.scheduleRow} key={`${item.time}-${i}`}>
                    <div className={styles.scheduleTime}>{item.time}</div>
                    <div className={styles.scheduleInfo}>
                      <div className={styles.scheduleShow}>{item.show}</div>
                      <div className={styles.scheduleDesc}>{item.desc}</div>
                    </div>
                    <div className={styles.scheduleHost}>{item.host}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="2" />
                <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
                <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
              </svg>
              <h3>Select a station</h3>
              <p>Choose a radio station from the list to start listening</p>
            </div>
          )}
        </main>

        {/* ===== Right Sidebar — Discover ===== */}
        <aside className={styles.discoverSidebar}>
          {/* Your Library */}
          <div className={styles.librarySection}>
            <div className={styles.libraryHeader} onClick={() => setLibraryExpanded((v) => !v)}>
              <div className={styles.libraryTitle}>Your Library</div>
              <span className={`${styles.libraryToggle} ${libraryExpanded ? styles.expanded : ''}`}>
                <ChevronIcon />
              </span>
            </div>

            {/* Favorites */}
            <div className={`${styles.libraryContent} ${libraryExpanded ? styles.expanded : ''}`}>
              {favoriteList.length === 0 ? (
                <div className={styles.libraryEmpty}>
                  <div className={styles.libraryEmptyIcon}>♡</div>
                  <div>No favorite channels yet</div>
                  <div className={styles.libraryEmptyHint}>Click the heart icon to save stations</div>
                </div>
              ) : (
                <>
                  <div className={styles.playlistHeader}>Favorite Channels</div>
                  {favoriteList.map(({ idx, station }) => (
                    <div key={`fav-${idx}`} className={styles.discoverCard} onClick={() => selectStation(idx)}>
                      <img className={styles.discoverCardArt} src={station.image} alt={station.name} loading="lazy" />
                      <div className={styles.discoverCardInfo}>
                        <div className={styles.discoverCardName}>{station.name}</div>
                        <div className={styles.discoverCardCat}>{capitalize(station.category)}</div>
                      </div>
                      <button
                        className={styles.discoverRemoveBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFavorite(idx);
                        }}
                        title="Remove from favorites"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Follows */}
            <div className={`${styles.libraryContent} ${libraryExpanded ? styles.expanded : ''}`}>
              {followList.length === 0 ? (
                <div className={styles.libraryEmpty}>
                  <div className={styles.libraryEmptyIcon}>➕</div>
                  <div>No followed stations yet</div>
                  <div className={styles.libraryEmptyHint}>Click Follow button on station page</div>
                </div>
              ) : (
                <>
                  <div className={styles.playlistHeader}>Followed Stations</div>
                  {followList.map(({ idx, station }) => (
                    <div key={`follow-${idx}`} className={styles.discoverCard} onClick={() => selectStation(idx)}>
                      <img className={styles.discoverCardArt} src={station.image} alt={station.name} loading="lazy" />
                      <div className={styles.discoverCardInfo}>
                        <div className={styles.discoverCardName}>{station.name}</div>
                        <div className={styles.discoverCardCat}>{capitalize(station.category)}</div>
                      </div>
                      <button
                        className={styles.discoverRemoveBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFollow(idx);
                        }}
                        title="Unfollow"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className={styles.discoverDivider} />
          <div className={styles.discoverTitle}>Trending Stations</div>
          {TRENDING_INDICES.map((idx) => (
            <DiscoverCard key={`trend-${idx}`} station={stations[idx]} onSelect={() => selectStation(idx)} />
          ))}

          <div className={styles.discoverDivider} />
          <div className={styles.discoverSectionTitle}>Recommended For You</div>
          {RECOMMENDED_INDICES.map((idx) => (
            <DiscoverCard key={`rec-${idx}`} station={stations[idx]} onSelect={() => selectStation(idx)} />
          ))}
        </aside>
      </div>

      {/* ===== Sticky Footer Player ===== */}
      <div className={styles.radioPlayer}>
        {/* Left — station info */}
        <div className={styles.playerStationInfo}>
          <img
            className={styles.playerStationArt}
            src={currentStation?.image || 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=120&h=120&fit=crop'}
            alt=""
          />
          <div className={styles.playerStationText}>
            <div className={styles.playerStationName}>{currentStation?.name || 'No station selected'}</div>
            <div className={styles.playerStationShow}>{currentStation?.currentShow.name || '-'}</div>
          </div>
          <button
            className={`${styles.playerLikeBtn} ${currentIsFavorited ? styles.favorited : ''}`}
            onClick={togglePlayerLike}
            title={currentIsFavorited ? 'Remove from favorites' : 'Add to favorites'}
          >
            <HeartIcon filled={currentIsFavorited} />
          </button>
        </div>

        {/* Center — controls */}
        <div className={styles.playerControls}>
          <div className={styles.playerButtons}>
            <div className={`${styles.playerLiveIndicator} ${isPlaying ? '' : styles.inactive}`}>
              <span className={styles.playerLiveDot} />
              LIVE
            </div>
            <button className={styles.playerBtnPlay} onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? (
                <svg viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" fill="currentColor" />
                  <rect x="14" y="4" width="4" height="16" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>
            <div className={styles.playerSpacer} />
          </div>
        </div>

        {/* Right — volume */}
        <div className={styles.playerVolume}>
          <button className={styles.volumeBtn} onClick={toggleMute} title="Volume">
            {volume === 0 ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
          <div className={styles.volumeBar} onClick={handleVolumeClick}>
            <div className={styles.volumeFill} style={{ width: `${volume * 100}%` }}>
              <div className={styles.volumeKnob} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscoverCard({ station, onSelect }: { station: Station; onSelect: () => void }) {
  return (
    <div className={styles.discoverCard} onClick={onSelect}>
      <img className={styles.discoverCardArt} src={station.image} alt={station.name} loading="lazy" />
      <div className={styles.discoverCardInfo}>
        <div className={styles.discoverCardName}>{station.name}</div>
        <div className={styles.discoverCardCat}>{capitalize(station.category)}</div>
        <div className={styles.discoverCardListeners}>{station.listeners}</div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import HeroCarousel, { type HeroStatus } from '@/components/content/HeroCarousel';
import WeatherCard from '@/components/home/WeatherCard';
import FinanceCard from '@/components/home/FinanceCard';
import SportsCard from '@/components/home/SportsCard';
import LocalNewsCard, { type LocalNewsItem } from '@/components/home/LocalNewsCard';
import StoryCard from '@/components/content/StoryCard';
import { PREFS_CHANGED_EVENT } from '@/components/layout/PersonalizePopup';
import { api, handleImgError, resolveImageUrl } from '@/lib/api';
import { storeSelectedArticle, trackView } from '@/lib/article';
import { getGeoLocation } from '@/lib/geo';
import { useAuth } from '@/lib/auth';
import {
  articleTypeOf,
  fetchCounts,
  fetchUserReactions,
  reactionKey,
  type ReactionCounts,
  type ReactionType,
} from '@/lib/reactions';
import type { HomepagePlacement, Story } from '@/lib/types';
import styles from './home.module.css';

interface PlacementResponse extends HomepagePlacement {
  topicCards?: Story[];
}

const PREFS_KEY = 'jubileeVersePrefs';

interface FeedPrefs {
  following: string[];
  blocked: string[];
}

function readPrefs(): FeedPrefs {
  try {
    const data = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      following: Array.isArray(data.following) ? data.following : [],
      blocked: Array.isArray(data.blocked) ? data.blocked : [],
    };
  } catch {
    return { following: [], blocked: [] };
  }
}

/** Topic/category slug a story belongs to, lower-cased for matching. */
function storySlug(story: Story): string {
  return String(story.topic || story.category || '').toLowerCase();
}

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [hero, setHero] = useState<Story[]>([]);
  const [sidebar, setSidebar] = useState<Story[]>([]);
  const [feed, setFeed] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroStatus, setHeroStatus] = useState<HeroStatus>('loading');

  // Newsletter
  const [email, setEmail] = useState('');
  const [nlMsg, setNlMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [nlSubmitting, setNlSubmitting] = useState(false);

  // Local news — auto-resolved from the same location the weather card uses.
  const [localItems, setLocalItems] = useState<LocalNewsItem[]>([]);
  const [localLabel, setLocalLabel] = useState('');
  const [localLoading, setLocalLoading] = useState(true);
  const didLoad = useRef(false);
  const lastPlacementLoad = useRef(0); // ms epoch of the last successful feed load

  // Reactions (batched once for the whole feed)
  const [counts, setCounts] = useState<Record<string, ReactionCounts>>({});
  const [mine, setMine] = useState<Record<string, ReactionType>>({});

  // Personalization prefs
  const [prefs, setPrefs] = useState<FeedPrefs>({ following: [], blocked: [] });
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Build the header search index from whatever stories we have.
  const buildSearchIndex = useCallback((stories: Story[]) => {
    try {
      const items = stories
        .filter((s) => s.id != null)
        .map((s) => ({
          id: s.id,
          title: s.headline || s.title || '',
          category: s.topic || s.category || '',
          image: resolveImageUrl(s),
        }));
      sessionStorage.setItem('jubileeSearchIndex', JSON.stringify(items));
      // Full stories (with article bodies) power Related Stories/Articles on the
      // article page, where clicking a related card needs real content.
      sessionStorage.setItem('jubileeFeedStories', JSON.stringify(stories));
    } catch {
      /* ignore */
    }
  }, []);

  // ---- Local news -----------------------------------------------------------

  const fetchLocalNews = useCallback(
    async (params: Record<string, string>, label: string) => {
      try {
        // NOTE: no `limit` param — the backend caps at 12. The backend also
        // widens to nearby cities when the exact location has no stories.
        const qs = new URLSearchParams(params).toString();
        const data = await api.get<{
          success?: boolean;
          location?: { city?: string; region?: string; country?: string; nearby?: boolean };
          stories?: LocalNewsItem[];
        }>(`/api/local-news?${qs}`, { auth: false });
        setLocalItems(data.stories || []);
        // Prefer the backend-resolved location name (may be a nearby city).
        setLocalLabel(data.location?.city || label);
      } catch {
        setLocalItems([]);
      } finally {
        setLocalLoading(false);
      }
    },
    [],
  );

  // ---- Initial data load ----------------------------------------------------

  // `silent` (used by the 6-hour auto-refresh) swaps content in place without
  // flashing the skeletons, and keeps the existing feed on error.
  const loadPlacement = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setLoading(true);
        setHeroStatus('loading');
      }
      try {
        const data = await api.get<PlacementResponse>('/api/homepage-placement');
        const heroStories = (data.hero || []).slice(0, 5);
        const sidebarStories = data.sidebar || [];
        const topicCards = (data.topicCards || []).filter((s) => s.cached_image_path || s.image_url);
        setHero(heroStories);
        setSidebar(sidebarStories);
        setFeed(topicCards);
        buildSearchIndex([...heroStories, ...sidebarStories, ...topicCards]);
        setHeroStatus(heroStories.length ? 'ready' : 'empty');
        lastPlacementLoad.current = Date.now();
      } catch {
        if (!silent) setHeroStatus('error');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [buildSearchIndex],
  );

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;

    // Seed prefs + hidden stories before the feed renders.
    setPrefs(readPrefs());
    try {
      const rawHidden = localStorage.getItem('jubileeVerseHidden');
      if (rawHidden) setHidden(new Set(JSON.parse(rawHidden) as string[]));
    } catch {
      /* ignore */
    }

    // Local news: reuse the same location the weather card resolves (no prompt),
    // then load stories for that area. getGeoLocation never rejects — it falls
    // back to IP/default — so this always resolves to a usable lat/lon.
    void (async () => {
      const geo = await getGeoLocation();
      await fetchLocalNews({ lat: String(geo.lat), lon: String(geo.lon) }, geo.city);
    })();

    void loadPlacement();
  }, [loadPlacement, fetchLocalNews]);

  // ---- Auto-refresh every 6 hours (PST 12AM/6AM/12PM/6PM) -------------------
  // The backend regenerates the locked portal layout at those PST boundaries, so
  // re-fetch shortly after each one (plus when a backgrounded tab refocuses) to
  // keep a long-open page up to date.
  useEffect(() => {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    // ms until the next PST 6-hour boundary (+90s so the backend has regenerated).
    const msUntilNextBoundary = (): number => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date());
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
      let hour = get('hour');
      if (hour === 24) hour = 0; // en-US can emit "24" at midnight
      const msIntoCycle = ((hour % 6) * 3600 + get('minute') * 60 + get('second')) * 1000;
      return SIX_HOURS - msIntoCycle + 90_000;
    };

    boundaryTimer = setTimeout(() => {
      void loadPlacement({ silent: true });
      interval = setInterval(() => void loadPlacement({ silent: true }), SIX_HOURS);
    }, msUntilNextBoundary());

    // A returning visitor gets fresh content immediately — but not on every flick.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastPlacementLoad.current > 5 * 60 * 1000) {
        void loadPlacement({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (boundaryTimer) clearTimeout(boundaryTimer);
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadPlacement]);

  // ---- Reactions: one batched fetch for the whole feed ----------------------

  useEffect(() => {
    if (feed.length === 0) return;
    const keys = feed.map((s) => reactionKey(s.id, articleTypeOf(s)));
    let cancelled = false;
    (async () => {
      try {
        const c = await fetchCounts(keys);
        if (!cancelled) setCounts(c);
      } catch {
        /* ignore */
      }
      if (isAuthenticated) {
        try {
          const r = await fetchUserReactions(keys);
          if (!cancelled) setMine(r);
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feed, isAuthenticated]);

  // ---- Personalization: re-read prefs when the popup saves ------------------

  useEffect(() => {
    const reread = () => setPrefs(readPrefs());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === PREFS_KEY) reread();
    };
    window.addEventListener(PREFS_CHANGED_EVENT, reread);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PREFS_CHANGED_EVENT, reread);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Filter out blocked topics; surface followed topics first.
  const visibleFeed = useMemo(() => {
    const blocked = new Set(prefs.blocked.map((s) => s.toLowerCase()));
    const following = new Set(prefs.following.map((s) => s.toLowerCase()));
    const filtered = feed.filter(
      (s) => !blocked.has(storySlug(s)) && !hidden.has(String(s.id)),
    );
    if (following.size === 0) return filtered;
    return [...filtered].sort((a, b) => {
      const af = following.has(storySlug(a)) ? 0 : 1;
      const bf = following.has(storySlug(b)) ? 0 : 1;
      return af - bf;
    });
  }, [feed, prefs, hidden]);

  const openStory = (story: Story) => {
    storeSelectedArticle(story);
    trackView(story.id);
    router.push(`/article/${story.id}`);
  };

  const hideStory = useCallback((id: string | number) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(String(id));
      try {
        localStorage.setItem('jubileeVerseHidden', JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const subscribe = async () => {
    if (!email.trim()) {
      setNlMsg({ text: 'Please enter your email.', ok: false });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setNlMsg({ text: 'Please enter a valid email address.', ok: false });
      return;
    }
    setNlSubmitting(true);
    setNlMsg(null);
    try {
      await api.post('/api/newsletter/subscribe', { email: email.trim() }, { auth: false });
      setNlMsg({ text: 'Thanks for subscribing!', ok: true });
      setEmail('');
    } catch {
      setNlMsg({ text: 'Subscription failed. Please try again.', ok: false });
    } finally {
      setNlSubmitting(false);
    }
  };

  return (
    <main className="main-content">
      {/* Hero bento */}
      <div className={styles.heroBento}>
        <section className={styles.heroContainer}>
          <HeroCarousel stories={hero} status={heroStatus} onRetry={() => void loadPlacement()} />
        </section>
        <div className={styles.heroSidebar}>
          {sidebar.map((story) => {
            const img = resolveImageUrl(story);
            return (
              <div key={story.id} className={styles.heroSidebarCard} onClick={() => openStory(story)}>
                {img ? <img src={img} alt={story.headline || ''} onError={handleImgError} /> : null}
                <div className={styles.heroSidebarOverlay}>
                  <span className={styles.heroSidebarCategory}>{story.topic || 'Faith'}</span>
                  <h3 className={styles.heroSidebarTitle}>{story.headline || story.title}</h3>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Local news — auto-resolved, article-card format. Hidden entirely when
          neither local nor nearby stories are available. */}
      {localLoading ? (
        <section>
          <div className="section-header">
            <h2 className="section-title">Local News</h2>
          </div>
          <div className="content-grid" style={{ justifyContent: 'flex-start' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="content-card skeleton" style={{ height: 304 }} />
            ))}
          </div>
        </section>
      ) : localItems.length > 0 ? (
        <section>
          <div className="section-header">
            <h2 className="section-title">Local News{localLabel ? ` — ${localLabel}` : ''}</h2>
          </div>
          <div className="content-grid" style={{ justifyContent: 'flex-start' }}>
            {localItems.map((item, i) => (
              <LocalNewsCard key={item.link || i} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Current events feed */}
      <section>
        <div className="section-header">
          <h2 className="section-title">Current Events</h2>
        </div>
        <div className="content-grid">
          {loading && feed.length === 0
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="content-card skeleton" style={{ height: 304 }} />
              ))
            : visibleFeed.map((story) => {
                const type = articleTypeOf(story);
                const key = reactionKey(story.id, type);
                return (
                  <StoryCard
                    key={story.id}
                    story={story}
                    showReactions
                    articleType={type}
                    initialCounts={counts[key]}
                    initialMine={mine[key] ?? null}
                    showActions
                    onHide={hideStory}
                  />
                );
              })}

          {/* In-feed widget cards (weather / markets / sports) */}
          {!loading && feed.length > 0 ? (
            <>
              <WeatherCard />
              <FinanceCard />
              <SportsCard />
            </>
          ) : null}

          {/* Newsletter card mixed into the grid */}
          {!loading && feed.length > 0 ? (
            <div className={styles.newsletterCard}>
              <h3 className={styles.newsletterTitle}>Stay Inspired</h3>
              <p className={styles.newsletterDesc}>
                Get uplifting Christian news and devotionals delivered to your inbox.
              </p>
              {nlMsg ? (
                <div className={`${styles.newsletterMsg} ${nlMsg.ok ? styles.success : styles.error}`}>
                  {nlMsg.text}
                </div>
              ) : null}
              <input
                className={styles.newsletterInput}
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className={styles.newsletterBtn} onClick={subscribe} disabled={nlSubmitting}>
                {nlSubmitting ? 'Subscribing…' : 'Subscribe'}
              </button>
            </div>
          ) : null}
        </div>
        {!loading && visibleFeed.length === 0 ? (
          <div className="empty-state">No stories available right now. Please check back soon.</div>
        ) : null}
      </section>
    </main>
  );
}

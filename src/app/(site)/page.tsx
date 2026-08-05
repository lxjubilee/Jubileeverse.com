'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import HeroCarousel, { type HeroStatus } from '@/components/content/HeroCarousel';
import WeatherCard from '@/components/home/WeatherCard';
import FinanceCard from '@/components/home/FinanceCard';
import SportsCard from '@/components/home/SportsCard';
import StoryCard from '@/components/content/StoryCard';
import { api, handleImgError, resolveImageUrl } from '@/lib/api';
import {
  addHidden,
  onPrefsChanged,
  readHidden,
  readPrefs,
  topicSlugOf,
  type FeedPrefs,
} from '@/lib/feedPrefs';
import {
  storeSelectedArticle,
  trackView,
  storyHref,
  trackingIdOf,
} from '@/lib/article';
import { useAuth } from '@/lib/auth';
import { isFeatured } from '@/lib/featuredLayout';
import { interleaveFeed } from '@/lib/homeFeed';
import {
  fetchSlugCounts,
  fetchUserSlugReactions,
  reactionSlugOf,
  type ReactionCounts,
  type ReactionType,
} from '@/lib/reactions';
import type { HomepagePlacement, Story } from '@/lib/types';
import styles from './home.module.css';

interface PlacementResponse extends HomepagePlacement {
  topicCards?: Story[];
  /** Faith-based category articles, already rotated across the five categories. */
  categoryCards?: Story[];
  /** Grid cards available across the whole 30-day window. */
  total?: number;
  /** Whether another page follows this one. */
  hasMore?: boolean;
}

/**
 * The four in-feed cards — Weather, Markets, Sports and the "Stay Inspired"
 * newsletter — are switched off for now.
 *
 * Rendering only: the components, their data fetching, the newsletter state and
 * its /api/newsletter/subscribe handler, and the card styles are all untouched,
 * so flipping this back to `true` restores them exactly as they were.
 *
 * They sat at the end of the feed grid, which is a centred flex wrap, so their
 * absence simply reflows the last row — no gap, no layout change.
 */
const SHOW_IN_FEED_CARDS = false;

/** Topic/category slug a story belongs to, lower-cased for matching. */
const storySlug = topicSlugOf;

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [hero, setHero] = useState<Story[]>([]);
  const [sidebar, setSidebar] = useState<Story[]>([]);
  const [feed, setFeed] = useState<Story[]>([]);
  // Faith-based articles woven through the feed, one after every four stories.
  const [categoryCards, setCategoryCards] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroStatus, setHeroStatus] = useState<HeroStatus>('loading');

  // Newsletter
  const [email, setEmail] = useState('');
  const [nlMsg, setNlMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [nlSubmitting, setNlSubmitting] = useState(false);

  const didLoad = useRef(false);
  const lastPlacementLoad = useRef(0); // ms epoch of the last successful feed load

  // Paging through the 30-day window.
  //
  // The feed is a month deep — roughly 1,800 articles at full production — and
  // sending it in one response would be about a megabyte of JSON and 1,800
  // cards in the DOM before the reader has scrolled past the first row. Pages
  // arrive as the end of the grid comes into view, so nothing about the layout
  // changes: there is no button and no visible control, only cards that are
  // already there by the time they are reached.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const nextOffset = useRef(0);
  // Guards against a second request while one is in flight. State would settle
  // a render too late and the observer can fire twice in the same frame.
  const fetchingMore = useRef(false);
  // Everything handed to the search index so far. The index is written whole
  // each time, so appending a page has to rebuild it from the running total —
  // passing just the new page would drop every earlier one out of search.
  const indexedStories = useRef<Story[]>([]);

  // Reactions (batched per page of the feed)
  const [counts, setCounts] = useState<Record<string, ReactionCounts>>({});
  const [mine, setMine] = useState<Record<string, ReactionType>>({});
  /**
   * Slugs whose PUBLIC totals have been requested, so an appended page asks only
   * for its own. Nothing here depends on who is reading: the counts are the same
   * for everybody, signed in or not.
   */
  const requestedCounts = useRef<Set<string>>(new Set());
  /**
   * Slugs whose PERSONAL reaction has been requested. Tracked apart from the
   * totals because the answer belongs to whoever is signed in at the time — it
   * is cleared on sign-in and sign-out so the next reader is asked afresh
   * instead of inheriting the previous one's highlights.
   */
  const requestedMine = useRef<Set<string>>(new Set());
  /**
   * Which page each card arrived on.
   *
   * The followed-topics-first ordering below is applied WITHIN a page rather
   * than across the whole accumulated feed. Sorting the lot would let a
   * followed-topic card from page three jump above cards from page one — the
   * reader would watch the story they were reading slide down the screen.
   */
  const pageOfStory = useRef<Map<string, number>>(new Map());
  /** Pages fetched so far, page one included. */
  const pagesLoaded = useRef(0);

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
          // Carried so a search result can link to /<slug> rather than
          // falling back to /article/<id>, which cannot resolve a news article.
          slug: s.slug,
          date: s.date,
        }));
      sessionStorage.setItem('jubileeSearchIndex', JSON.stringify(items));
      // Full stories (with article bodies) power Related Stories/Articles on the
      // article page, where clicking a related card needs real content.
      sessionStorage.setItem('jubileeFeedStories', JSON.stringify(stories));
    } catch {
      /* ignore */
    }
  }, []);

  // ---- Initial data load ----------------------------------------------------

  // `silent` (used by the 6-hour auto-refresh) swaps content in place without
  // flashing the skeletons, and keeps the existing feed on error.
  const loadPlacement = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      // A silent refresh replaces the feed with page one. That was harmless
      // when the feed WAS one page; now it would delete everything a reader has
      // scrolled through. Leave a paged-through feed alone — it refreshes on
      // the next real navigation.
      if (silent && pagesLoaded.current > 1) return;

      if (!silent) {
        setLoading(true);
        setHeroStatus('loading');
      }
      try {
        // The daily news bundle on the CDN, not PostgreSQL. /news-feed is a
        // Next route handler that reads R2 server-side (the CDN sends no CORS
        // headers) and returns the same hero/sidebar/topicCards envelope this
        // page has always consumed.
        const data = await api.get<PlacementResponse>('/news-feed');
        const heroStories = (data.hero || []).slice(0, 5);
        const sidebarStories = data.sidebar || [];
        const topicCards = (data.topicCards || []).filter((s) => s.cached_image_path || s.image_url);
        const categories = (data.categoryCards || []).filter((s) => s.cached_image_path || s.image_url);
        setHero(heroStories);
        setSidebar(sidebarStories);
        setFeed(topicCards);
        setCategoryCards(categories);
        // Count what the SERVER sent, not what survived the image filter: the
        // offset is an index into the server's grid, and advancing it by the
        // filtered length would silently re-request the dropped cards.
        nextOffset.current = (data.topicCards || []).length;
        setHasMore(Boolean(data.hasMore));
        // A full (re)load starts the window over, so let the reaction counts be
        // fetched afresh rather than kept from the previous page-0.
        requestedCounts.current.clear();
        requestedMine.current.clear();
        pagesLoaded.current = 1;
        pageOfStory.current = new Map(topicCards.map((s) => [String(s.id), 0]));
        indexedStories.current = [...heroStories, ...sidebarStories, ...topicCards, ...categories];
        buildSearchIndex(indexedStories.current);
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

  /**
   * Append the next page of the 30-day window.
   *
   * Additive only: hero and sidebar are a fixed region and the server sends
   * them on the first page alone, so nothing already on screen moves.
   */
  const loadMore = useCallback(async () => {
    if (fetchingMore.current) return;
    fetchingMore.current = true;
    setLoadingMore(true);
    try {
      const data = await api.get<PlacementResponse>(`/news-feed?offset=${nextOffset.current}`);
      const more = (data.topicCards || []).filter((s) => s.cached_image_path || s.image_url);
      const moreCategories = (data.categoryCards || []).filter(
        (s) => s.cached_image_path || s.image_url,
      );

      const returned = (data.topicCards || []).length;
      nextOffset.current += returned;
      // An empty page with `hasMore` still set would leave the offset where it
      // was and re-request the same page forever. Trust the count over the flag.
      setHasMore(returned > 0 && Boolean(data.hasMore));

      const pageIndex = pagesLoaded.current;
      pagesLoaded.current += 1;
      for (const s of more) pageOfStory.current.set(String(s.id), pageIndex);

      if (more.length) {
        // Dedupe on id. A page boundary that shifts between requests — a run
        // publishing mid-scroll — would otherwise repeat a card, and React
        // would warn about the duplicate key.
        setFeed((prev) => {
          const seen = new Set(prev.map((s) => String(s.id)));
          return [...prev, ...more.filter((s) => !seen.has(String(s.id)))];
        });
        setCategoryCards((prev) => {
          const seen = new Set(prev.map((s) => String(s.id)));
          return [...prev, ...moreCategories.filter((s) => !seen.has(String(s.id)))];
        });
        indexedStories.current = [...indexedStories.current, ...more, ...moreCategories];
        buildSearchIndex(indexedStories.current);
      }
    } catch {
      // Leave hasMore alone: a transient failure should let the next scroll
      // retry rather than permanently ending the feed.
    } finally {
      fetchingMore.current = false;
      setLoadingMore(false);
    }
  }, [buildSearchIndex]);

  // Append when the end of the grid comes into view. `rootMargin` starts the
  // request while the sentinel is still a screen away, so the cards are usually
  // in place before the reader arrives at them.
  //
  // Re-created whenever the feed grows. An IntersectionObserver only reports
  // CHANGES, so on a tall viewport where the sentinel stays in view after a
  // page lands, no further callback would ever fire and paging would stall
  // until the reader happened to scroll. Re-observing forces a fresh check.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) void loadMore(); },
      { rootMargin: '800px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore, feed.length]);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;

    // Seed prefs + hidden stories before the feed renders.
    setPrefs(readPrefs());
    setHidden(readHidden());

    void loadPlacement();
  }, [loadPlacement]);

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

  // ---- Reactions -----------------------------------------------------------
  //
  // Two separate fetches, because the two halves answer to different things.
  //
  // The TOTALS are public: every reader sees the same number, so they are read
  // without an Authorization header and without waiting to find out who — if
  // anyone — is signed in. A like cast by one reader is therefore still on the
  // card for a visitor who has never signed in at all.
  //
  // The PERSONAL reaction is the signed-in reader's own, and is the only part
  // that highlights a button. Keeping it in the same effect as the totals is
  // what used to make signing in on the page do nothing: the shared "already
  // requested" set was full, so the effect returned early and the highlight
  // only appeared after a full reload — and signing out left the previous
  // reader's highlights on screen.

  // Public totals — deliberately not keyed on `isAuthenticated`.
  useEffect(() => {
    const stories = [...feed, ...categoryCards];
    if (stories.length === 0) return;
    // Keyed on the article's slug, which is what StoryCard posts a reaction
    // with and what the reaction is stored against in the database.
    //
    // Only slugs we have not already asked about. This effect re-runs on every
    // appended page, and over a 30-day window re-requesting the whole feed each
    // time would make the last page ask for ~1,800 slugs and the run of pages
    // quadratic. Each page now costs one request for its own cards.
    const slugs = stories
      .map(reactionSlugOf)
      .filter((s) => s && !requestedCounts.current.has(s));
    if (slugs.length === 0) return;
    for (const s of slugs) requestedCounts.current.add(s);

    let cancelled = false;
    (async () => {
      try {
        const c = await fetchSlugCounts(slugs);
        if (!cancelled) setCounts((prev) => ({ ...prev, ...c }));
      } catch {
        // Let a later page retry these rather than leaving them permanently
        // unfetched because one request failed.
        for (const s of slugs) requestedCounts.current.delete(s);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feed, categoryCards]);

  // The reader's own reactions — what restores the highlighted Like/Dislike
  // after a refresh, a new session or on a different device.
  useEffect(() => {
    // Signed out there is no personal selection to show, and none to guess at.
    // Drop whatever the previous reader had highlighted rather than leaving it
    // on the cards, and forget what was asked for so signing back in re-asks.
    // The totals above are untouched, so the counts stay on screen.
    if (!isAuthenticated) {
      requestedMine.current.clear();
      // Returning `prev` when it is already empty keeps this from re-rendering
      // itself forever.
      setMine((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const stories = [...feed, ...categoryCards];
    if (stories.length === 0) return;
    const slugs = stories
      .map(reactionSlugOf)
      .filter((s) => s && !requestedMine.current.has(s));
    if (slugs.length === 0) return;
    for (const s of slugs) requestedMine.current.add(s);

    let cancelled = false;
    (async () => {
      try {
        const r = await fetchUserSlugReactions(slugs);
        if (!cancelled) setMine((prev) => ({ ...prev, ...r }));
      } catch {
        for (const s of slugs) requestedMine.current.delete(s);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feed, categoryCards, isAuthenticated]);

  // ---- Personalization: re-read prefs when the popup saves ------------------

  useEffect(() => onPrefsChanged(() => setPrefs(readPrefs())), []);

  // Filter out blocked topics; surface followed topics first.
  const visibleFeed = useMemo(() => {
    const blocked = new Set(prefs.blocked.map((s) => s.toLowerCase()));
    const following = new Set(prefs.following.map((s) => s.toLowerCase()));
    const filtered = feed.filter(
      (s) => !blocked.has(storySlug(s)) && !hidden.has(String(s.id)),
    );
    if (following.size === 0) return filtered;
    // Page first, followed second. Sorting on `following` alone would reorder
    // across page boundaries and move cards the reader has already scrolled
    // past; within a page it does exactly what it always did.
    return [...filtered].sort((a, b) => {
      const pa = pageOfStory.current.get(String(a.id)) ?? 0;
      const pb = pageOfStory.current.get(String(b.id)) ?? 0;
      if (pa !== pb) return pa - pb;
      const af = following.has(storySlug(a)) ? 0 : 1;
      const bf = following.has(storySlug(b)) ? 0 : 1;
      return af - bf;
    });
  }, [feed, prefs, hidden]);

  // The faith-based inserts answer to the same block/hide prefs as everything
  // else in the grid. They are filtered but never re-sorted: their order is the
  // category rotation the feed route already fixed.
  const visibleCategoryCards = useMemo(() => {
    const blocked = new Set(prefs.blocked.map((s) => s.toLowerCase()));
    return categoryCards.filter(
      (s) => !blocked.has(storySlug(s)) && !hidden.has(String(s.id)),
    );
  }, [categoryCards, prefs.blocked, hidden]);

  // What the grid actually renders: the current-events feed with one faith-based
  // article after every fourth card. Weaving last means the feed's own filtering
  // and following-first ordering are untouched — inserts only land between
  // cards that survived them.
  const displayFeed = useMemo(
    () => interleaveFeed(visibleFeed, visibleCategoryCards),
    [visibleFeed, visibleCategoryCards],
  );

  const openStory = (story: Story) => {
    storeSelectedArticle(story);
    trackView(trackingIdOf(story));
    router.push(storyHref(story));
  };

  const hideStory = useCallback((id: string | number) => {
    setHidden((prev) => addHidden(id, prev));
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
      {/* Hero bento — wrapper snaps its width to the Current Events card columns */}
      <div className={styles.heroRow}>
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
      </div>

      {/* Current events feed */}
      <section>
        <div className="section-header">
          <h2 className="section-title">Current Events</h2>
        </div>
        {/* `feed` only widens the featured cards; the column math, centring and
            width caps stay with the shared .content-grid. */}
        <div className={`content-grid ${styles.feed}`}>
          {loading && feed.length === 0
            ? Array.from({ length: 8 }).map((_, i) => (
                // Two full rows in the featured pattern, so the skeletons stand
                // exactly where the cards that replace them will.
                <div
                  key={i}
                  className={`content-card skeleton${isFeatured(i) ? ` ${styles.featured}` : ''}`}
                  style={{ height: 304 }}
                />
              ))
            : displayFeed.map((story, i) => {
                const slug = reactionSlugOf(story);
                return (
                  <StoryCard
                    key={story.id}
                    story={story}
                    className={isFeatured(i) ? styles.featured : undefined}
                    showReactions
                    initialCounts={counts[slug]}
                    initialMine={mine[slug] ?? null}
                    showActions
                    showRegenerate={false}
                    onHide={hideStory}
                  />
                );
              })}

          {/* Cards for the next page, in the same skeleton the initial load
              uses so the grid never changes shape while it fills. */}
          {loadingMore
            ? Array.from({ length: 4 }).map((_, i) => (
                // Numbered on from the last real card, so the incoming row keeps
                // the pattern rather than restarting it.
                <div
                  key={`more-${i}`}
                  className={`content-card skeleton${
                    isFeatured(displayFeed.length + i) ? ` ${styles.featured}` : ''
                  }`}
                  style={{ height: 304 }}
                />
              ))
            : null}

          {/* In-feed widget cards (weather / markets / sports) */}
          {SHOW_IN_FEED_CARDS && !loading && feed.length > 0 ? (
            <>
              <WeatherCard />
              <FinanceCard />
              <SportsCard />
            </>
          ) : null}

          {/* Newsletter card mixed into the grid */}
          {SHOW_IN_FEED_CARDS && !loading && feed.length > 0 ? (
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
        {/* Paging sentinel. Deliberately empty and unstyled: it occupies no
            space and adds no control, so the page looks exactly as it did —
            crossing it simply means the next page is already on its way. */}
        {hasMore ? <div ref={sentinelRef} aria-hidden="true" /> : null}
        {!loading && visibleFeed.length === 0 ? (
          <div className="empty-state">No stories available right now. Please check back soon.</div>
        ) : null}
      </section>
    </main>
  );
}

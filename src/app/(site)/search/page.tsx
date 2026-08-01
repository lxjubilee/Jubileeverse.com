'use client';

/* ============================================================================
   Search results page — faithful port of the original static search.html.

   Data source: the homepage writes a prebuilt search index to
   sessionStorage["jubileeSearchIndex"] (see (site)/page.tsx -> buildSearchIndex).
   Each index entry is { id, title, category, image }. This page reads that
   index and filters it client-side, exactly like the original search.html
   (which read the same sessionStorage key). The original's HTML-scraping
   fallback (fetchSearchIndex) targeted the OLD static homepage markup and is
   obsolete here, so it is not reproduced; instead we show the original's
   "Unable to load content" state when no index is present.

   Filtering mirrors the original runSearch(): case-insensitive substring match
   over title + category (+ summary when present). A category <select> filter is
   layered on top, populated from the categories actually present in the index.

   Clicking a result hands the story off via storeSelectedArticle() and
   navigates via storyHref(): /<slug> for CDN news, /article/[id] otherwise.
   ============================================================================ */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, resolveImageUrl } from '@/lib/api';
import { storeSelectedArticle, storyHref } from '@/lib/article';
import type { Story } from '@/lib/types';
import styles from './search.module.css';

/** Shape of an entry in sessionStorage["jubileeSearchIndex"]. */
interface SearchIndexItem {
  id?: number | string;
  title?: string;
  category?: string;
  image?: string;
  /** Some legacy entries carried a summary; kept optional for parity. */
  summary?: string;
  /** CDN news: slug + day, so the result can link to /<slug>. */
  slug?: string;
  date?: string;
}

const ALL_CATEGORIES = '__all__';

function loadSearchIndex(): SearchIndexItem[] | null {
  try {
    const stored = sessionStorage.getItem('jubileeSearchIndex');
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as SearchIndexItem[]) : null;
  } catch {
    return null;
  }
}

/** Build a minimal Story from an index entry for the article hand-off. */
function toStory(item: SearchIndexItem): Story {
  return {
    id: item.id ?? '',
    headline: item.title || '',
    title: item.title || '',
    topic: item.category || '',
    category: item.category || '',
    image_url: item.image || null,
    isCurrentEvent: true,
    slug: item.slug,
    date: item.date,
  };
}

/** Highlight the matched query inside a title (escaped via React text nodes). */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!text) return '';
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Capturing group keeps the matched text in the split output (odd indices).
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  const lower = q.toLowerCase();
  return parts.map((part, i) =>
    part.toLowerCase() === lower ? (
      <span key={i} className={styles.matchHighlight}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Fisher–Yates shuffle (matches the original's More Good News picker). */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function SearchInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [index, setIndex] = useState<SearchIndexItem[] | null>(null);
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);

  // Load the prebuilt index from sessionStorage once on mount. On a DIRECT visit
  // (no homepage-built index), fall back to building one from the placement feed
  // so /search?q=... works without first loading the home page.
  useEffect(() => {
    const local = loadSearchIndex();
    if (local && local.length > 0) {
      setIndex(local);
      setIndexLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Same CDN feed the Home page builds its index from. Kept in step with
        // it deliberately: pointing this at the old PostgreSQL endpoint would
        // make a cold /search?q= visit return different results from a search
        // started on the Home page.
        const data = await api.get<{ hero?: Story[]; sidebar?: Story[]; topicCards?: Story[] }>(
          '/news-feed',
          { auth: false },
        );
        const stories = [...(data.hero || []), ...(data.sidebar || []), ...(data.topicCards || [])];
        const items: SearchIndexItem[] = stories
          .filter((s) => s.id != null)
          .map((s) => ({
            id: s.id,
            title: s.headline || s.title || '',
            category: s.topic || s.category || '',
            image: resolveImageUrl(s),
          }));
        if (!cancelled) {
          setIndex(items.length > 0 ? items : null);
          try {
            sessionStorage.setItem('jubileeSearchIndex', JSON.stringify(items));
          } catch {
            /* ignore quota */
          }
        }
      } catch {
        if (!cancelled) setIndex(null);
      } finally {
        if (!cancelled) setIndexLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep page title in sync with the active query (original set document.title).
  useEffect(() => {
    if (submittedQuery) {
      document.title = `"${submittedQuery}" - Search - JubileeVerse`;
    } else {
      document.title = 'Search - JubileeVerse';
    }
  }, [submittedQuery]);

  // Distinct categories present in the index, for the filter dropdown.
  const categories = useMemo(() => {
    if (!index) return [];
    const set = new Set<string>();
    for (const item of index) {
      const c = (item.category || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [index]);

  // Results: substring match over title/category/summary, then category filter.
  const results = useMemo(() => {
    if (!index) return [];
    const q = submittedQuery.trim().toLowerCase();
    return index.filter((item) => {
      if (categoryFilter !== ALL_CATEGORIES && (item.category || '') !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const title = (item.title || '').toLowerCase();
      const category = (item.category || '').toLowerCase();
      const summary = (item.summary || '').toLowerCase();
      return title.includes(q) || category.includes(q) || summary.includes(q);
    });
  }, [index, submittedQuery, categoryFilter]);

  // More Good News: index entries NOT in results, with image + title, shuffled.
  // Reshuffled only when the underlying result set/category changes.
  const moreSignature = `${submittedQuery}|${categoryFilter}|${index?.length ?? 0}`;
  const moreItemsRef = useRef<{ sig: string; items: SearchIndexItem[] }>({ sig: '', items: [] });
  const moreItems = useMemo(() => {
    if (!index) return [];
    if (moreItemsRef.current.sig === moreSignature) return moreItemsRef.current.items;
    const resultTitles = new Set(results.map((r) => r.title));
    const candidates = index.filter(
      (item) => !resultTitles.has(item.title) && item.image && item.title,
    );
    const picked = shuffle(candidates).slice(0, 10);
    moreItemsRef.current = { sig: moreSignature, items: picked };
    return picked;
    // results/index are the inputs encoded by moreSignature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreSignature]);

  const openItem = (item: SearchIndexItem) => {
    const story = toStory(item);
    storeSelectedArticle(story);
    router.push(storyHref(story));
  };

  const runSearch = () => {
    setSubmittedQuery(query);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch();
  };

  // ---- Render states ----------------------------------------------------- //

  const searchControls = (
    <form className={styles.searchBar} onSubmit={onSubmit}>
      <input
        className={styles.searchInput}
        type="search"
        placeholder="Search JubileeVerse…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search query"
        autoComplete="off"
      />
      {categories.length > 0 ? (
        <select
          className={styles.filterSelect}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
        >
          <option value={ALL_CATEGORIES}>All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : null}
      <button type="submit" className={styles.searchBtn}>
        Search
      </button>
    </form>
  );

  let body: React.ReactNode;

  if (!indexLoaded) {
    // Loading the index (mirrors original "Searching..." spinner).
    body = (
      <div className={styles.searchLoading}>
        <div className={styles.searchLoadingSpinner} />
        <span>Searching…</span>
      </div>
    );
  } else if (index === null) {
    // No index in sessionStorage — original showed "Unable to load content".
    body = (
      <div className={styles.noResults}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <h3>Unable to load content</h3>
        <p>
          Please go to the{' '}
          <Link href="/">homepage</Link> and search from there.
        </p>
      </div>
    );
  } else if (results.length === 0) {
    // No matches (original "No results found").
    body = (
      <div className={styles.noResults}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <h3>No results found</h3>
        <p>
          {submittedQuery ? (
            <>
              We couldn&apos;t find anything matching &quot;<strong>{submittedQuery}</strong>&quot;.
              <br />
            </>
          ) : (
            <>No content matched the current filter.<br /></>
          )}
          Try a different search term from the <Link href="/">homepage</Link>.
        </p>
      </div>
    );
  } else {
    body = (
      <>
        <div className={styles.resultsHeading}>
          <span>
            Found <strong>{results.length}</strong> result{results.length !== 1 ? 's' : ''}
            {submittedQuery ? (
              <>
                {' '}for &quot;<span className={styles.query}>{submittedQuery}</span>&quot;
              </>
            ) : null}
          </span>
          <Link href="/" className={styles.btnBackHome}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Home
          </Link>
        </div>
        <ul className={styles.resultList}>
          {results.map((item, idx) => (
            <li
              key={`${item.id ?? idx}-${idx}`}
              className={styles.resultItem}
              onClick={() => openItem(item)}
            >
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.resultItemImg} src={item.image} alt="" loading="lazy" />
              ) : (
                <span className={styles.resultItemImg} aria-hidden="true" />
              )}
              <div className={styles.resultItemInfo}>
                <div className={styles.resultItemTitle}>
                  {highlightMatch(item.title || '', submittedQuery.trim())}
                </div>
                <div className={styles.resultItemMeta}>
                  <span className={styles.resultItemCategory}>{item.category || ''}</span>
                </div>
              </div>
              <svg className={styles.resultItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <main className="main-content">
      <div className={styles.resultsContainer}>
        {searchControls}
        {body}
      </div>

      {indexLoaded && index !== null && moreItems.length > 0 ? (
        <div className={styles.moreGoodNews}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>More Good News</h2>
          </div>
          <div className={styles.moreGrid}>
            {moreItems.map((item, idx) => (
              <article
                key={`${item.id ?? idx}-more-${idx}`}
                className={styles.moreCard}
                onClick={() => openItem(item)}
              >
                <div className={styles.moreCardImage}>
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.title || ''} loading="lazy" />
                  ) : null}
                </div>
                <div className={styles.moreCardBody}>
                  <span className={styles.moreCardCategory}>{item.category || ''}</span>
                  <h3 className={styles.moreCardTitle}>{item.title || ''}</h3>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <main className="main-content">
          <div className={styles.resultsContainer}>
            <div className={styles.searchLoading}>
              <div className={styles.searchLoadingSpinner} />
              <span>Searching…</span>
            </div>
          </div>
        </main>
      }
    >
      <SearchInner />
    </Suspense>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { storeSelectedArticle } from '@/lib/article';
import type { Story } from '@/lib/types';
import styles from './hopeRestored.module.css';

/** Shape returned by GET /api/portal/hope-restored (`{ articles: [...] }`). */
interface PortalArticle {
  id: number | string;
  title?: string;
  summary?: string;
  image?: string;
  category?: string;
}

interface HopeRestoredResponse {
  articles?: PortalArticle[];
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

/**
 * Strip markdown noise and clamp the summary, mirroring cleanSummary() from the
 * original hope-restored.html.
 */
function cleanSummary(text?: string): string {
  if (!text) return '';
  return text
    .replace(/^#+\s*[^\n]*\n+/gm, '') // strip markdown headings
    .replace(/\*\*/g, '') // strip bold markers
    .replace(/\*/g, '') // strip italic markers
    .trim()
    .slice(0, 200);
}

/** Map a portal article onto the shared Story shape for the article hand-off. */
function toStory(a: PortalArticle): Story {
  return {
    id: a.id,
    title: a.title,
    headline: a.title,
    excerpt: a.summary,
    image_url: a.image ?? null,
    topic: a.category || 'Hope Restored',
    category: a.category || 'Hope Restored',
    isCurrentEvent: false,
  };
}

export default function HopeRestoredPage() {
  const router = useRouter();
  const [articles, setArticles] = useState<PortalArticle[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  // Track images that failed to load so we can drop those cards (mirrors the
  // original's onerror -> this.closest('.article-card').remove()).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const didLoad = useRef(false);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    (async () => {
      try {
        const data = await api.get<HopeRestoredResponse>('/api/portal/hope-restored', {
          auth: false,
        });
        const list = (data.articles || []).filter((a) => a.image && a.title);
        if (list.length === 0) {
          setState('empty');
          return;
        }
        setArticles(list);
        setState('ready');
      } catch (err) {
        console.error('Hope Restored load error:', err);
        setState('error');
      }
    })();
  }, []);

  const openArticle = (a: PortalArticle) => {
    storeSelectedArticle(toStory(a));
    router.push(`/article/${a.id}`);
  };

  const visible = articles.filter((a) => !hiddenIds.has(String(a.id)));

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroEyebrow}>JubileeVerse · Faith Portal</div>
        <h1 className={styles.heroTitle}>
          Hope <span className={styles.anchor}>Restored</span>
        </h1>
        <p className={styles.heroSub}>
          When everything feels broken, grace finds a way. Stories of renewal,
          redemption, and the God who rebuilds what we thought was lost forever.
        </p>
      </section>

      {/* ── Article Grid ──────────────────────────────────── */}
      <main className={styles.page}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Stories of Renewal</h2>
          <span className={styles.sectionCount}>
            {state === 'ready' && visible.length > 0
              ? `${visible.length} article${visible.length !== 1 ? 's' : ''}`
              : ''}
          </span>
        </div>

        {state === 'loading' ? (
          <div className={styles.stateBox}>
            <div className={styles.spinner} />
            <p>Loading stories…</p>
          </div>
        ) : null}

        {state === 'empty' || (state === 'ready' && visible.length === 0) ? (
          <div className={styles.stateBox}>
            <p>No stories found. Check back soon.</p>
          </div>
        ) : null}

        {state === 'error' ? (
          <div className={styles.stateBox}>
            <p>Could not load stories. Please try again.</p>
          </div>
        ) : null}

        {state === 'ready' && visible.length > 0 ? (
          <div className={styles.articleGrid}>
            {visible.map((a) => {
              const summary = cleanSummary(a.summary);
              return (
                <a
                  key={a.id}
                  className={styles.articleCard}
                  href={`/article/${a.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    openArticle(a);
                  }}
                >
                  <div className={styles.cardImgWrap}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.image}
                      alt={a.title || ''}
                      loading="lazy"
                      onError={() =>
                        setHiddenIds((prev) => {
                          const next = new Set(prev);
                          next.add(String(a.id));
                          return next;
                        })
                      }
                    />
                    <span className={styles.cardBadge}>Hope Restored</span>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardTitle}>{a.title || ''}</div>
                    {summary ? <div className={styles.cardSummary}>{summary}</div> : null}
                    <div className={styles.cardReadMore}>
                      Read Story
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        ) : null}
      </main>
    </>
  );
}

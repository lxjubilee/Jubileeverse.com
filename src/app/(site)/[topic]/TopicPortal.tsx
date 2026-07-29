'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import StoryCard from '@/components/content/StoryCard';
import { api } from '@/lib/api';
import type { NavSubcategory } from '@/lib/cdn';
import type { Story } from '@/lib/types';
import styles from './topic.module.css';

/** Named portals with dedicated backend endpoints (/api/portal/:slug). */
const PORTAL_SLUGS = new Set([
  'encouragement',
  'faith-builders',
  'hope-restored',
  'lets-celebrate',
  'purpose-driven',
  'live-inspired',
]);

interface RawArticle {
  id?: number | string;
  title?: string;
  headline?: string;
  summary?: string;
  excerpt?: string;
  image?: string;
  cached_image_path?: string;
  image_url?: string;
  category?: string;
  topic?: string;
  slug?: string;
}

function toStory(a: RawArticle): Story {
  return {
    id: a.id ?? a.slug ?? '',
    headline: a.title || a.headline || '',
    title: a.title || a.headline || '',
    excerpt: a.summary || a.excerpt || '',
    cached_image_path: a.cached_image_path || a.image || null,
    image_url: a.image_url || null,
    category: a.category || a.topic || '',
    topic: a.topic || a.category || '',
  };
}

function humanize(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface TaxNode {
  id: number;
  slug: string;
}

/**
 * Category portal page. Mirrors the original category routes:
 *  - named portals -> /api/portal/:slug
 *  - taxonomy slugs -> resolve node id then /api/search?taxonomy_node_id=...
 *
 * `subcategories` come from the CDN articles catalog and are resolved by the
 * server component in page.tsx (the catalog is large and CORS-less, so it must
 * not be fetched from the browser).
 */
export default function TopicPortal({ subcategories }: { subcategories: NavSubcategory[] }) {
  const { topic } = useParams<{ topic: string }>();
  const [stories, setStories] = useState<Story[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    if (!topic) return;
    let cancelled = false;

    (async () => {
      setStatus('loading');
      try {
        let articles: RawArticle[] = [];

        if (PORTAL_SLUGS.has(topic)) {
          const data = await api.get<{ articles?: RawArticle[] }>(`/api/portal/${topic}`, {
            auth: false,
          });
          articles = data.articles || [];
        } else {
          // Resolve the taxonomy node id for this slug, then search its articles.
          const tax = await api.get<{ nodes?: TaxNode[] }>('/api/taxonomy/all?type=topics', {
            auth: false,
          });
          const node = (tax.nodes || []).find((n) => n.slug === topic);
          if (node) {
            const data = await api.get<{
              items?: RawArticle[];
              results?: RawArticle[];
              articles?: RawArticle[];
            }>(`/api/search?taxonomy_node_id=${node.id}&limit=150&order=random&type=article`, {
              auth: false,
            });
            // /api/search responds { items, total, limit, offset, facets }.
            articles = data.items || data.results || data.articles || [];
          }
        }

        const mapped = articles.filter((a) => a.title || a.headline).map(toStory);
        if (cancelled) return;
        setStories(mapped);
        setStatus(mapped.length ? 'ready' : 'empty');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [topic]);

  const title = humanize(topic || '');

  return (
    <>
      <div className={styles.hero}>
        <div className={styles.eyebrow}>JubileeVerse · Faith Portal</div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>Stories and encouragement from the {title} collection.</p>
      </div>

      <main className="main-content">
        {subcategories.length > 0 ? (
          <section className={styles.subcategories} aria-label={`${title} subcategories`}>
            <h2 className={styles.subcategoriesTitle}>Explore {title}</h2>
            <ul className={styles.subcategoryList}>
              {subcategories.map((sub) => (
                <li key={sub.slug} className={styles.subcategoryChip}>
                  <span className={styles.subcategoryName}>{sub.label}</span>
                  {sub.tier ? <span className={styles.subcategoryTier}>{sub.tier}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {status === 'loading' ? (
          <div className={styles.state}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            Loading articles…
          </div>
        ) : status === 'error' ? (
          <div className={styles.state}>Could not load articles.</div>
        ) : status === 'empty' ? (
          <div className={styles.state}>No articles found in this category.</div>
        ) : (
          <div className="content-grid">
            {stories.map((story) => (
              <StoryCard key={String(story.id)} story={story} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

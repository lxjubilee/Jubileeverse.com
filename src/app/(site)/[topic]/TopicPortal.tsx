'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import StoryCard from '@/components/content/StoryCard';
import { api } from '@/lib/api';
import type { CatalogArticle, NavSubcategory } from '@/lib/cdn';
import type { Story } from '@/lib/types';
import styles from './topic.module.css';

/**
 * jubileeinspire.com portals, which have dedicated backend endpoints
 * (/api/portal/:slug) and are not published in the CDN articles catalog. Their
 * responses are small (~100 KB) and carry no article bodies, so these still
 * load on the client.
 */
const PORTAL_SLUGS = new Set([
  'encouragement',
  'faith-builders',
  'hope-restored',
  'lets-celebrate',
  'purpose-driven',
  'live-inspired',
]);

/** One row from /api/portal/:slug. */
interface PortalArticle {
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

/** Catalog article -> the Story shape StoryCard renders. */
function toStory(a: CatalogArticle): Story {
  return {
    id: a.id,
    headline: a.title,
    title: a.title,
    cached_image_path: a.image,
    image_url: null,
    category: a.pillar,
    topic: a.pillar,
    published_at: a.created,
  };
}

/** /api/portal/:slug row -> the Story shape StoryCard renders. */
function portalToStory(a: PortalArticle): Story {
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

/**
 * Category portal page. Two sources, by category:
 *
 *  - **Five-fold categories** (covenant-identity, teshuvah-restoration, …) are
 *    authored as markdown on the CDN and are not rows in the Express content
 *    tables. Their cards come from the CDN articles catalog, resolved by the
 *    server component in page.tsx and server-rendered from `articles` — no
 *    client-side fetch, and nothing large crossing to the browser.
 *  - **Named jubileeinspire portals** keep their existing /api/portal/:slug
 *    fetch, which the catalog does not cover.
 */
export default function TopicPortal({
  subcategories,
  categoryLabel,
  articles,
  /** Slug path below the category, when rendering a drilled-down node. */
  subPath = [],
  /** Ancestor links shown above the chips; empty at the category root. */
  trail = [],
}: {
  subcategories: NavSubcategory[];
  categoryLabel?: string | null;
  articles: CatalogArticle[];
  subPath?: string[];
  trail?: { label: string; href: string }[];
}) {
  const { topic } = useParams<{ topic: string }>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const isNamedPortal = !!topic && PORTAL_SLUGS.has(topic);
  const [portalStories, setPortalStories] = useState<Story[] | null>(null);

  useEffect(() => {
    if (!topic || !PORTAL_SLUGS.has(topic)) return;
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      try {
        const data = await api.get<{ articles?: PortalArticle[] }>(`/api/portal/${topic}`, {
          auth: false,
          signal: ac.signal,
        });
        if (cancelled) return;
        setPortalStories(
          (data.articles || []).filter((a) => a.title || a.headline).map(portalToStory),
        );
      } catch {
        if (!cancelled) setPortalStories([]);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [topic]);

  // The catalog publishes the display name ("Covenant & Identity"); humanizing
  // the slug is only a fallback for categories it doesn't carry.
  const title = categoryLabel || humanize(topic || '');
  const stories = isNamedPortal ? portalStories : articles.map(toStory);
  const visible = (stories || []).filter((s) => !hidden.has(String(s.id)));

  const hideStory = (id: string | number) =>
    setHidden((prev) => new Set(prev).add(String(id)));

  return (
    <>
      <main className="main-content">
        {trail.length > 0 ? (
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            {trail.map((step) => (
              <span key={step.href}>
                <Link href={step.href} className={styles.breadcrumbLink}>
                  {step.label}
                </Link>
                <span className={styles.breadcrumbSep} aria-hidden="true">
                  ›
                </span>
              </span>
            ))}
            <span className={styles.breadcrumbCurrent}>{title}</span>
          </nav>
        ) : null}

        {subcategories.length > 0 ? (
          <section className={styles.subcategories} aria-label={`${title} subcategories`}>
            <h2 className={styles.subcategoriesTitle}>Explore {title}</h2>
            <ul className={styles.subcategoryList}>
              {subcategories.map((sub) => (
                <li key={sub.slug}>
                  <Link
                    href={`/${topic}/${[...subPath, sub.slug].join('/')}`}
                    className={styles.subcategoryChip}
                  >
                    <span className={styles.subcategoryName}>{sub.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className={styles.separator} aria-hidden="true" />
          </section>
        ) : null}

        {stories === null ? (
          <div className={styles.state}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            Loading articles…
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.state}>No articles published here yet.</div>
        ) : (
          <section>
            <div className="section-header">
              <h2 className={`section-title ${styles.sectionTitle}`}>{title}</h2>
            </div>
            <div className="content-grid">
              {visible.map((story) => (
                <StoryCard
                  key={String(story.id)}
                  story={story}
                  category={title}
                  articleType="article"
                  showActions
                  onHide={hideStory}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

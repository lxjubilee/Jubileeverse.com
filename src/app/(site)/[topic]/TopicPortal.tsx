'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import StoryCard from '@/components/content/StoryCard';
import { api } from '@/lib/api';
import type { SiteArticle } from '@/lib/articles';
import { isFeatured } from '@/lib/featuredLayout';
import {
  addHidden,
  onPrefsChanged,
  readHidden,
  readPrefs,
  topicSlugOf,
  type FeedPrefs,
} from '@/lib/feedPrefs';
import { NAMED_PORTAL_SLUGS as PORTAL_SLUGS } from '@/lib/portals';
import type { Story } from '@/lib/types';
import styles from './topic.module.css';

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

/** Published article -> the Story shape StoryCard renders. */
function toStory(a: SiteArticle): Story {
  return {
    id: a.id,
    headline: a.title,
    title: a.title,
    cached_image_path: a.image,
    image_url: null,
    category: a.category,
    topic: a.category,
    source_name: a.author,
    published_at: a.created,
    // Must be explicit: storeSelectedArticle() defaults a missing value to
    // true, which would tag these as current events, put "JubileeVerse" in the
    // byline badge instead of the author, and file reactions under the wrong
    // namespace.
    isCurrentEvent: false,
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
 *    authored as markdown and published as article bundles. Their cards are
 *    resolved by the server component in page.tsx and server-rendered from
 *    `articles` — no client-side fetch, and nothing large crossing to the
 *    browser. These bundles are flat, so the portal has no subcategory level.
 *  - **Named jubileeinspire portals** keep their existing /api/portal/:slug
 *    fetch, which the bundles do not cover.
 */
export default function TopicPortal({
  categoryLabel,
  articles,
}: {
  categoryLabel?: string | null;
  articles: SiteArticle[];
}) {
  const { topic } = useParams<{ topic: string }>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [prefs, setPrefs] = useState<FeedPrefs>({ following: [], blocked: [] });
  const isNamedPortal = !!topic && PORTAL_SLUGS.has(topic);
  const [portalStories, setPortalStories] = useState<Story[] | null>(null);

  // The portal used to ignore both of these: a hidden card came back on reload,
  // and blocking a topic here changed nothing that was visible.
  useEffect(() => {
    const sync = () => {
      setPrefs(readPrefs());
      setHidden(readHidden());
    };
    sync();
    return onPrefsChanged(sync);
  }, []);

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

  // The bundle publishes the display name ("Covenant & Identity"); humanizing
  // the slug is only a fallback for categories that have no bundle.
  const title = categoryLabel || humanize(topic || '');
  const stories = isNamedPortal ? portalStories : articles.map(toStory);

  // Blocked topics are filtered out here as they are on the home feed — except
  // this portal's own topic. The reader navigated here deliberately, and
  // blanking the page they are looking at reads as the site breaking rather
  // than as a preference being honoured.
  const blocked = new Set(prefs.blocked.map((s) => s.toLowerCase()));
  const visible = (stories || []).filter((s) => {
    if (hidden.has(String(s.id))) return false;
    const slug = topicSlugOf(s);
    return !(slug && slug !== topic && blocked.has(slug));
  });

  const hideStory = (id: string | number) => setHidden((prev) => addHidden(id, prev));

  return (
    <>
      <main className="main-content">
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
            {/* Published category cards run 10% shorter than the global card;
                the named jubileeinspire portals keep the standard height. */}
            <div className={`content-grid${isNamedPortal ? '' : ` ${styles.compactGrid}`}`}>
              {/* The five published categories carry the same featured rhythm as
                  the home feed: a large card two columns wide, moving one place
                  right on each row. The named jubileeinspire portals are left
                  as an even row of cards, since only the compact grid above is
                  measured for it. */}
              {visible.map((story, i) => (
                <StoryCard
                  key={String(story.id)}
                  story={story}
                  className={!isNamedPortal && isFeatured(i) ? styles.featured : undefined}
                  category={title}
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

'use client';

import { useEffect, useState } from 'react';
import StoryCard from '@/components/content/StoryCard';
import type { Story } from '@/lib/types';
import { getRelatedStories } from './relatedSource';
import styles from './RelatedArticlesGrid.module.css';

/**
 * What the grid shows before "View All". Nine fills two complete rows at the
 * widest layout, where the lead card takes two of the five columns.
 */
const PREVIEW = 9;
/** How deep into the cached feed "View All" is willing to go. */
const POOL = 32;

/** End-of-article "More Good News" grid (same-category first). */
export default function RelatedArticlesGrid({
  currentId,
  category,
}: {
  currentId: string | number;
  category?: string;
}) {
  const [stories, setStories] = useState<Story[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setStories(getRelatedStories(currentId, category, POOL));
    // A different article starts collapsed again.
    setExpanded(false);
  }, [currentId, category]);

  if (stories.length === 0) return null;

  const visible = expanded ? stories : stories.slice(0, PREVIEW);
  const canExpand = stories.length > PREVIEW;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.title}>More Good News</h2>
        {canExpand ? (
          <button
            type="button"
            className={`${styles.viewAll}${expanded ? ` ${styles.open}` : ''}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? 'Show Less' : 'View All'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        ) : null}
      </div>
      <div className={styles.grid}>
        {visible.map((s) => (
          <StoryCard key={String(s.id)} story={s} />
        ))}
      </div>
    </section>
  );
}

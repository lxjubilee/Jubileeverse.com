'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { handleImgError, resolveImageUrl } from '@/lib/api';
import { storeSelectedArticle, storyHref, trackingIdOf, trackView } from '@/lib/article';
import type { Story } from '@/lib/types';
import { getRelatedStories } from './relatedSource';
import styles from './widgets.module.css';

/** "Related Stories" sidebar list, same-category first. */
export default function RelatedStories({
  currentId,
  category,
}: {
  currentId: string | number;
  category?: string;
}) {
  const router = useRouter();
  const [stories, setStories] = useState<Story[]>([]);

  useEffect(() => {
    setStories(getRelatedStories(currentId, category, 6));
  }, [currentId, category]);

  if (stories.length === 0) return null;

  // Same routing rules as StoryCard: CDN news is read at /<slug>, and its
  // slug id is not something /article/[id] or the tracking tables can take.
  const open = (story: Story) => {
    storeSelectedArticle(story);
    trackView(trackingIdOf(story));
    router.push(storyHref(story));
  };

  return (
    <section className={styles.widget}>
      <div className={styles.widgetTitle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        Related Stories
      </div>
      {stories.map((s) => {
        const img = resolveImageUrl(s);
        return (
          <div key={String(s.id)} className={styles.relatedItem} onClick={() => open(s)}>
            {img ? (
              <img className={styles.relatedImg} src={img} alt="" loading="lazy" onError={handleImgError} />
            ) : null}
            <div className={styles.relatedInfo}>
              <div className={styles.relatedTitle}>{s.headline || s.title}</div>
              {s.topic || s.category ? <div className={styles.relatedCat}>{s.topic || s.category}</div> : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

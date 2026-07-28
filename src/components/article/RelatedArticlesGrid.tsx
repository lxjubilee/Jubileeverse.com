'use client';

import { useEffect, useState } from 'react';
import StoryCard from '@/components/content/StoryCard';
import type { Story } from '@/lib/types';
import { getRelatedStories } from './relatedSource';

/** End-of-article "More Good News" grid (same-category first). */
export default function RelatedArticlesGrid({
  currentId,
  category,
}: {
  currentId: string | number;
  category?: string;
}) {
  const [stories, setStories] = useState<Story[]>([]);

  useEffect(() => {
    setStories(getRelatedStories(currentId, category, 8));
  }, [currentId, category]);

  if (stories.length === 0) return null;

  return (
    <section style={{ marginTop: 'var(--space-2xl)' }}>
      <div className="section-header">
        <h2 className="section-title">More Good News</h2>
      </div>
      <div className="content-grid">
        {stories.map((s) => (
          <StoryCard key={String(s.id)} story={s} />
        ))}
      </div>
    </section>
  );
}

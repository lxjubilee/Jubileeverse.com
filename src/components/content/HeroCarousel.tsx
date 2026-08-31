'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { handleImgError, resolveImageUrl } from '@/lib/api';
import {
  storeSelectedArticle,
  trackView,
  storyHref,
  trackingIdOf,
} from '@/lib/article';
import type { Story } from '@/lib/types';
import styles from '@/app/(site)/home.module.css';

// 5s display + 2s cross-fade = 7s per slide (matches the original index.html).
const DISPLAY_MS = 7000;

/** Lifecycle of the hero placement fetch on the home page. */
export type HeroStatus = 'loading' | 'ready' | 'empty' | 'error';

interface Props {
  stories: Story[];
  /**
   * Optional fetch status. When omitted the carousel infers it from `stories`
   * (so existing callers keep their old behavior): non-empty ⇒ ready, empty ⇒
   * a perpetual loading spinner. When provided, the carousel renders explicit
   * empty/error cards once loading is done instead of spinning forever.
   */
  status?: HeroStatus;
  /** Re-run the placement fetch (wired to the error-state retry button). */
  onRetry?: () => void;
}

/** Auto-rotating hero carousel for the top stories (matches index.html hero). */
export default function HeroCarousel({ stories, status, onRetry }: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(0);

  // Re-running on `index` restarts the timer after every slide change — so a
  // manual dot click also resets the countdown (matches the original).
  useEffect(() => {
    if (stories.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % stories.length), DISPLAY_MS);
    return () => clearInterval(t);
  }, [stories.length, index]);

  const open = (story: Story) => {
    storeSelectedArticle(story);
    trackView(trackingIdOf(story));
    router.push(storyHref(story));
  };

  // Resolve the effective status. Without an explicit prop, fall back to the
  // legacy inference (empty stories ⇒ still loading).
  const effective: HeroStatus = status ?? (stories.length > 0 ? 'ready' : 'loading');

  if (stories.length === 0) {
    if (effective === 'error') {
      return (
        <div className={styles.heroLoading}>
          <div className={styles.heroStateIcon}>⚠️</div>
          <div className={styles.heroStateTitle}>Couldn&apos;t load stories</div>
          {onRetry ? (
            <button type="button" className={styles.heroRetryBtn} onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      );
    }
    if (effective === 'empty') {
      return (
        <div className={styles.heroLoading}>
          <div className={styles.heroStateIcon}>📰</div>
          <div className={styles.heroStateTitle}>No top stories available</div>
          <div className={styles.heroLoadingText}>Please check back soon.</div>
        </div>
      );
    }
    // 'loading' (explicit or inferred): keep the spinner.
    return (
      <div className={styles.heroLoading}>
        <div className="spinner" />
        <div className={styles.heroLoadingText}>Loading top stories...</div>
      </div>
    );
  }

  return (
    <>
      {stories.map((story, i) => {
        const img = resolveImageUrl(story);
        const title = story.headline || story.title || '';
        const excerpt = story.excerpt ? `${story.excerpt.substring(0, 200)}...` : '';
        // The badge names the story's section (Finance, Entertainment, …) the
        // same way StoryCard does. A story that carries neither gets no badge
        // rather than an empty accent chip or an invented label.
        const label = story.topic || story.category || '';
        return (
          <div
            key={story.id}
            className={`${styles.heroSlide}${i === index ? ` ${styles.active}` : ''}`}
            onClick={() => open(story)}
          >
            {img ? <img src={img} alt={title} onError={handleImgError} /> : null}
            <div className={styles.heroOverlay}>
              {label ? <span className={styles.heroCategory}>{label}</span> : null}
              <h2 className={styles.heroTitle}>{title}</h2>
              {excerpt ? <p className={styles.heroExcerpt}>{excerpt}</p> : null}
              <button
                className={styles.heroReadMore}
                onClick={(e) => {
                  e.stopPropagation();
                  open(story);
                }}
              >
                Read More →
              </button>
            </div>
          </div>
        );
      })}
      <div className={styles.heroProgress}>
        {stories.map((_, i) => (
          <button
            key={i}
            className={`${styles.heroDot}${i === index ? ` ${styles.active}` : ''}`}
            onClick={() => setIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </>
  );
}

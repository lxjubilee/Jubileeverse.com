'use client';

import { stripHtml } from './scanEngine';
import type { ScannerStory } from './scannerData';
import styles from '@/app/(admin)/scanner/scanner.module.css';

const RANK_LABELS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

function rankClass(rank: number): string {
  if (rank === 1) return styles.rank1;
  if (rank === 2) return styles.rank2;
  if (rank === 3) return styles.rank3;
  return '';
}

interface StoryCardProps {
  story: ScannerStory;
  rank: number;
  onOpen: () => void;
}

/** One of the top-3 transformed story cards in the grid. */
export default function StoryCard({ story, rank, onOpen }: StoryCardProps) {
  const excerptText = `${stripHtml(story.rewrittenContent || '').substring(0, 120)}...`;
  const sourceClass = styles[story.source] ?? '';

  return (
    <div
      className={`${styles.topStoryCard} ${rankClass(rank)}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={styles.topStoryImage}>
        {story.downloadedImage ? (
          // External / backend image paths are kept as-is.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={story.downloadedImage} alt="Article" />
        ) : (
          <div className={styles.topStoryImagePlaceholder}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>No image</span>
          </div>
        )}

        <div className={`${styles.topStoryBadge} ${rankClass(rank)}`}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          {RANK_LABELS[rank]} Story
        </div>

        <div className={`${styles.sourceBadgeOverlay} ${sourceClass}`}>{story.sourceName}</div>

        {story.imageStatus === 'success' ? (
          <div className={`${styles.imageStatusIndicator} ${styles.success}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Verified
          </div>
        ) : story.imageStatus === 'pending' ? (
          <div className={`${styles.imageStatusIndicator} ${styles.pending}`}>
            <div className={`${styles.loadingSpinner} ${styles.small}`} />
          </div>
        ) : (
          <div className={`${styles.imageStatusIndicator} ${styles.failed}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </div>
        )}
      </div>

      <div className={styles.topStoryContent}>
        <h2 className={styles.topStoryTitle}>{story.rewrittenTitle}</h2>
        <p className={styles.topStoryExcerpt}>{excerptText}</p>
        <div className={styles.topStoryMeta}>
          <div className={styles.topStoryScore}>
            <div className={styles.scoreCircle}>{story.score.normalized}</div>
            <div className={styles.scoreLabel}>Score</div>
          </div>
          <div className={styles.topStoryCta}>
            Read More
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { formatRelativeTime } from './scanEngine';
import type { DownloadLogEntry, ScannerStory } from './scannerData';
import styles from '@/app/(admin)/scanner/scanner.module.css';

const RANK_LABELS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

function logItemClass(entry: DownloadLogEntry): string {
  const statusClass = styles[entry.status] ?? '';
  const googleClass = entry.source === 'Google Images' ? styles.google : '';
  return `${styles.downloadLogItem} ${statusClass} ${googleClass}`.trim();
}

interface ArticlePanelProps {
  story: ScannerStory | null;
  open: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}

/** Slide-over detail view: hero image, rewritten article, source + image log. */
export default function ArticlePanel({
  story,
  open,
  onClose,
  onApprove,
  onReject,
}: ArticlePanelProps) {
  const sourceClass = story ? (styles[story.source] ?? '') : '';
  const rankLabel = story?.rank ? RANK_LABELS[story.rank] : '';

  return (
    <>
      <div
        className={`${styles.panelOverlay} ${open ? styles.visible : ''}`}
        onClick={onClose}
      />
      <aside className={`${styles.slidePanel} ${open ? styles.open : ''}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Article Detail</h2>
          <button className={styles.panelClose} onClick={onClose} title="Close (ESC)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.panelBody}>
          {story ? (
            <>
              <div className={styles.panelHeroImage}>
                {story.downloadedImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={story.downloadedImage} alt="Article" />
                ) : (
                  <div className={styles.panelHeroPlaceholder}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span>No image available</span>
                  </div>
                )}
              </div>

              <div className={styles.panelArticle}>
                <div className={styles.panelArticleHeader}>
                  <div className={`${styles.panelArticleSource} ${sourceClass}`}>
                    {story.sourceName} • {rankLabel} Most Prominent
                  </div>
                  <h1 className={styles.panelArticleTitle}>{story.rewrittenTitle}</h1>
                  <div className={styles.panelArticleMeta}>
                    <span>Prominence: {story.score.normalized}%</span>
                    <span>Category: {story.storyCluster || 'General'}</span>
                    <span>{formatRelativeTime(story.timestamp)}</span>
                  </div>
                </div>

                {/* Rewritten content is trusted, app-authored HTML (template set). */}
                <div
                  className={styles.panelArticleBody}
                  dangerouslySetInnerHTML={{ __html: story.rewrittenContent || '' }}
                />
              </div>

              <div className={styles.panelSection}>
                <h3 className={styles.panelSectionTitle}>Original Source</h3>
                <div className={styles.panelOriginalStory}>
                  <div className={styles.panelOriginalTitle}>{story.originalTitle}</div>
                  <a
                    href={story.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.panelOriginalLink}
                  >
                    {story.originalUrl}
                  </a>
                </div>
              </div>

              {story.imageDownloadLog.length > 0 ? (
                <div className={styles.panelSection}>
                  <h3 className={styles.panelSectionTitle}>Image Acquisition Log</h3>
                  <div className={styles.downloadLog}>
                    {story.imageDownloadLog.map((log, i) => (
                      <div key={i} className={logItemClass(log)}>
                        <strong>{log.source}:</strong>
                        <span>{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className={styles.panelFooter}>
          <button className={`${styles.btn} ${styles.btnReject}`} onClick={onReject}>
            <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Reject
          </button>
          <button className={`${styles.btn} ${styles.btnApprove}`} onClick={onApprove}>
            <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Approve &amp; Publish
          </button>
        </div>
      </aside>
    </>
  );
}

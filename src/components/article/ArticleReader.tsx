'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ReactionBar from '@/components/content/ReactionBar';
import ReadAloud from '@/components/article/ReadAloud';
import TranslateArticle from '@/components/article/TranslateArticle';
import ShareStory from '@/components/article/ShareStory';
import DailyVerseWidget from '@/components/article/DailyVerseWidget';
import RelatedStories from '@/components/article/RelatedStories';
import RelatedArticlesGrid from '@/components/article/RelatedArticlesGrid';
import ReviewerTools from '@/components/article/ReviewerTools';
import RegenerateImageButton from '@/components/admin/RegenerateImageButton';
import { regenTargetFor, trackView } from '@/lib/article';
import styles from './ArticleReader.module.css';

const FALLBACK_IMG =
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&h=600&fit=crop';

const TOPIC_LABELS: Record<string, string> = {
  'christian-watch-us': 'Christian Watch — US',
  'church-us': 'Church — United States',
  'church-global': 'Church — Global',
  faith: 'Faith',
  finance: 'Finance',
  technology: 'Technology',
  health: 'Health & Wellness',
  social: 'Social',
  entertainment: 'Entertainment',
};

export interface ArticleReaderProps {
  /** Identity used for related-story exclusion and the reviewer endpoints. */
  id: string | number;
  /**
   * Integer id for the paths that store `article_id` as INTEGER — views,
   * reactions and the translation cache. CDN news supplies a hashed integer
   * because its id is a slug. Defaults to `id`.
   */
  trackingId?: string | number;
  title: string;
  content: string;
  image?: string | null;
  category?: string;
  sourceName?: string;
  sourceUrl?: string;
  isCurrentEvent?: boolean;
  faithCommentary?: string;
  /** Byline shown in the hero meta line. Omitted for sources that have none. */
  author?: string;
  /** Publication date (`YYYY-MM-DD` or ISO) shown beside the byline. */
  date?: string;
  /** Small print rendered under the source link (e.g. an AI-assistance note). */
  footerNote?: ReactNode;
  /** Reviewer controls need backend article endpoints; off for CDN articles. */
  showReviewerTools?: boolean;
}

function estimateReadTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

/** `2026-07-31` / ISO -> `July 31, 2026`. Fixed to UTC so the day never shifts. */
function formatDate(value: string): string {
  const day = value.slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The article reading experience: full-bleed hero with the title over it, the
 * formatted body, and the sticky widget sidebar (Read Aloud, Translate, Share,
 * Daily Verse, Related Stories).
 *
 * Presentation only — every source hands it the same normalised props, so
 * `/article/[id]` (backend + published bundles) and `/<slug>` (CDN news at the
 * root segment) render one identical reader rather than two drifting copies.
 */
export default function ArticleReader({
  id,
  trackingId,
  title,
  content,
  image,
  category = '',
  sourceName = '',
  sourceUrl = '',
  isCurrentEvent = false,
  faithCommentary = '',
  author = '',
  date = '',
  footerNote,
  showReviewerTools = true,
}: ArticleReaderProps) {
  const router = useRouter();
  const reactionId = trackingId ?? id;

  // Translation swap (null = show the original).
  const [tTitle, setTTitle] = useState<string | null>(null);
  const [tContent, setTContent] = useState<string | null>(null);
  // Live content override (e.g. reviewer "rewrite").
  const [overrideContent, setOverrideContent] = useState<string | null>(null);
  // Hero replaced by an admin regeneration, shown without waiting for a reload.
  const [freshImage, setFreshImage] = useState<string | null>(null);

  const articleType: 'current_event' | 'article' = isCurrentEvent ? 'current_event' : 'article';

  // Track the view once per article.
  useEffect(() => {
    trackView(reactionId, 'view', articleType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionId]);

  // Article body container — Read Aloud highlights blocks inside it as it reads.
  const proseRef = useRef<HTMLElement | null>(null);

  // What to display (translation/override take precedence over the original).
  const displayTitle = tTitle ?? title;
  const rawContent = overrideContent ?? tContent ?? content;

  // Strip a leading "# h1" already shown in the hero overlay.
  const body = useMemo(() => rawContent.replace(/^#[^\n]*\n/, ''), [rawContent]);

  // Stored editorial/JV articles can be raw HTML; detect and render verbatim
  // instead of through the markdown renderer (which would escape the tags).
  const isHtmlContent = useMemo(
    () => /<\/?(p|h[1-6]|div|ul|ol|li|blockquote|table|br|img|figure|section|article)\b/i.test(rawContent),
    [rawContent],
  );

  useEffect(() => {
    if (displayTitle) document.title = `${displayTitle} - JubileeVerse`;
  }, [displayTitle]);

  const categoryLabel = TOPIC_LABELS[category] || category;
  const publishedOn = date ? formatDate(date) : '';

  return (
    <>
      {/* Outside .main-content so the hero spans the full window width rather
          than being inset by that container's max-width gutters. */}
      <section className={styles.hero}>
        <img
          src={freshImage || image || FALLBACK_IMG}
          alt={displayTitle}
          className={styles.heroImage}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_IMG)}
        />
        {/* Offset so it clears the Back button in the same corner. */}
        <RegenerateImageButton
          target={regenTargetFor(id, date)}
          onRegenerated={setFreshImage}
          offset
        />
        <button
          className={styles.backBtn}
          onClick={() => {
            // Only use history when we arrived from this site; otherwise go home
            // (matches the original goBack referrer guard).
            try {
              if (document.referrer && new URL(document.referrer).host === window.location.host) {
                router.back();
                return;
              }
            } catch {
              /* fall through */
            }
            router.push('/');
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
        </button>
        {showReviewerTools ? (
          <ReviewerTools
            articleId={id}
            isCurrentEvent={isCurrentEvent}
            onRewritten={(c) => setOverrideContent(c)}
          />
        ) : null}
        <div className={styles.heroOverlay}>
          <div>
            <div className={styles.metaTop}>
              <span className={styles.sourceBadge}>
                {isCurrentEvent ? 'JubileeVerse' : sourceName || 'Good News'}
              </span>
              {categoryLabel ? <span className={styles.category}>{categoryLabel}</span> : null}
            </div>
            <h1 className={styles.heroTitle}>{displayTitle}</h1>
            <div className={styles.metaBottom}>
              {author ? <span>{author}</span> : null}
              {publishedOn ? <time dateTime={date.slice(0, 10)}>{publishedOn}</time> : null}
              <span>{estimateReadTime(body)} min read</span>
            </div>
          </div>
        </div>
      </section>

      <main className="main-content">
        <div className={styles.layout}>
          <div className={styles.main}>
            <article className={styles.prose} ref={proseRef}>
              {isHtmlContent ? (
                // Legacy/editorial articles are stored as raw HTML; render as-is
                // (mirrors the original formatArticleContent passthrough).
                <div dangerouslySetInnerHTML={{ __html: body }} />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
              )}
            </article>

            <div className={styles.hopeCallout}>
              {faithCommentary ? (
                <>
                  <strong>A Christian Perspective</strong>
                  <p>{faithCommentary}</p>
                </>
              ) : (
                <>
                  <strong>A Word of Encouragement</strong>
                  <p>
                    &ldquo;For I know the plans I have for you,&rdquo; declares the Lord, &ldquo;plans to
                    prosper you and not to harm you, plans to give you hope and a future.&rdquo;
                  </p>
                </>
              )}
            </div>

            <ReactionBar articleId={reactionId} articleType={articleType} />

            {sourceUrl ? (
              <a className={styles.sourceLink} href={sourceUrl} target="_blank" rel="noopener noreferrer">
                Read the original source →
              </a>
            ) : null}

            {footerNote ? <p className={styles.footerNote}>{footerNote}</p> : null}
          </div>

          <aside className={styles.sidebar}>
            <ReadAloud text={rawContent} contentRef={proseRef} />
            <TranslateArticle
              articleId={reactionId}
              fallbackTitle={title}
              fallbackContent={content}
              onTranslated={(t, c) => {
                setTTitle(t);
                setTContent(c);
              }}
              onRestore={() => {
                setTTitle(null);
                setTContent(null);
              }}
            />
            <ShareStory title={displayTitle} />
            <DailyVerseWidget />
            <RelatedStories currentId={id} category={category} />
          </aside>
        </div>

        <div className={styles.container} style={{ maxWidth: 'var(--max-width)' }}>
          <RelatedArticlesGrid currentId={id} category={category} />
        </div>
      </main>
    </>
  );
}

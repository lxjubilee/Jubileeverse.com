'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ReadAloud from '@/components/article/ReadAloud';
import TranslateArticle from '@/components/article/TranslateArticle';
import ShareStory from '@/components/article/ShareStory';
import DailyVerseWidget from '@/components/article/DailyVerseWidget';
import RelatedStories from '@/components/article/RelatedStories';
import RelatedArticlesGrid from '@/components/article/RelatedArticlesGrid';
import ReviewerTools from '@/components/article/ReviewerTools';
import RegenerateImageButton from '@/components/admin/RegenerateImageButton';
import { canRegenerateImage, regenTargetFor, trackView } from '@/lib/article';
import { hasInAppHistory } from '@/lib/navigation';
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
  isCurrentEvent = false,
  faithCommentary = '',
  date = '',
  showReviewerTools = true,
}: ArticleReaderProps) {
  const router = useRouter();
  const reactionId = trackingId ?? id;

  // Translation swap (null = show the original).
  const [tTitle, setTTitle] = useState<string | null>(null);
  const [tContent, setTContent] = useState<string | null>(null);
  // The language the body is currently in, reported by the translate widget.
  // Read Aloud speaks in it, so a translated article is not read in English.
  const [lang, setLang] = useState('en-US');
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
  const regenTarget = regenTargetFor(id, date);

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
        {/* Offset so it clears the Back button in the same corner. Hidden on
            news, whose picture comes from the originating outlet and so has
            nothing to regenerate; category articles still render theirs. */}
        {canRegenerateImage(regenTarget) ? (
          <RegenerateImageButton
            target={regenTarget}
            onRegenerated={setFreshImage}
            offset
          />
        ) : null}
        <button
          className={styles.backBtn}
          onClick={() => {
            // Return to whatever the reader was on before. Home is only the
            // fallback for a cold arrival — a shared link or a search hit —
            // where history holds nothing of ours to go back to.
            if (hasInAppHistory()) {
              router.back();
              return;
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
          <div className={styles.heroContent}>
            <div className={styles.metaTop}>
              <span className={styles.sourceBadge}>
                {isCurrentEvent ? 'JubileeVerse' : sourceName || 'Good News'}
              </span>
              {categoryLabel ? <span className={styles.category}>{categoryLabel}</span> : null}
            </div>
            <h1 className={styles.heroTitle}>{displayTitle}</h1>
            <div className={styles.metaBottom}>
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
          </div>

          <aside className={styles.sidebar}>
            <ReadAloud text={rawContent} lang={lang} contentRef={proseRef} />
            <TranslateArticle
              articleId={reactionId}
              fallbackTitle={title}
              fallbackContent={content}
              // The setter itself, not an arrow: it is referentially stable, so
              // the widget's reporting effect cannot re-run every render.
              onLanguageChange={setLang}
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

        {/* Widths and gutters live in the grid's own module so its heading, rule
            and first card line up with the reader above. */}
        <RelatedArticlesGrid currentId={id} category={category} />
      </main>
    </>
  );
}

'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { api } from '@/lib/api';
import { readSelectedArticle, trackView, type SelectedArticle } from '@/lib/article';
import { useAuth } from '@/lib/auth';
import styles from './article.module.css';

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

interface ArticleView {
  id: string | number;
  title: string;
  content: string;
  image: string;
  category: string;
  sourceName: string;
  sourceUrl: string;
  isCurrentEvent: boolean;
  faithCommentary: string;
}

function toView(a: SelectedArticle): ArticleView {
  return {
    id: a.id,
    title: a.rewrittenTitle || a.originalTitle || '',
    content: a.rewrittenContent || '',
    image: a.downloadedImage || a.imageUrl || '',
    category: a.category || a.storyCluster || '',
    sourceName: a.sourceName || '',
    sourceUrl: a.originalUrl || '',
    isCurrentEvent: a.isCurrentEvent,
    faithCommentary: a.faithCommentary || '',
  };
}

function estimateReadTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

export default function ArticlePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { refresh } = useAuth();
  const id = params.id;
  const [article, setArticle] = useState<ArticleView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Translation swap (null = show the original).
  const [tTitle, setTTitle] = useState<string | null>(null);
  const [tContent, setTContent] = useState<string | null>(null);
  // Live content override (e.g. reviewer "rewrite").
  const [overrideContent, setOverrideContent] = useState<string | null>(null);

  // Sync the user's role on load (so reviewer tools reflect the current DB role).
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = (view: ArticleView) => {
      if (!cancelled) {
        setArticle(view);
        setLoading(false);
      }
    };

    // 1) Instant render from the stashed story when ids match.
    const stored = readSelectedArticle();
    if (stored && String(stored.id) === String(id)) {
      hydrate(toView(stored));
    }

    // 2) Fetch fresh editorial/JV content where an endpoint exists. (Current
    //    events have no public single-fetch endpoint, so they render from the
    //    stashed story passed by the feed.)
    (async () => {
      const endpoints = [`/api/public/article/${id}`, `/api/articles/${id}`];
      for (const url of endpoints) {
        try {
          const data = await api.get<Record<string, unknown>>(url, { auth: false });
          const a = (data.article || data) as Record<string, unknown>;
          const content =
            (a.full_article as string) ||
            (a.content as string) ||
            ((a.extension_data as Record<string, unknown>)?.body as string) ||
            (a.summary as string) ||
            '';
          const title = (a.headline as string) || (a.title as string) || stored?.rewrittenTitle || '';
          if (content || title) {
            hydrate({
              id,
              title: title || stored?.rewrittenTitle || '',
              content: content || stored?.rewrittenContent || '',
              image:
                (a.cached_image_path as string) ||
                (a.image_url as string) ||
                (a.image as string) ||
                stored?.downloadedImage ||
                stored?.imageUrl ||
                '',
              category: (a.topic as string) || (a.category as string) || stored?.category || '',
              sourceName: (a.source_name as string) || stored?.sourceName || '',
              sourceUrl: (a.source_url as string) || stored?.originalUrl || '',
              isCurrentEvent: stored?.isCurrentEvent ?? false,
              faithCommentary: (a.faith_reflection as string) || stored?.faithCommentary || '',
            });
            return;
          }
        } catch {
          /* try next endpoint */
        }
      }
      if (!cancelled && !stored) {
        setNotFound(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const articleType: 'current_event' | 'article' = article?.isCurrentEvent ? 'current_event' : 'article';

  // Track the view once we know the article + its type.
  useEffect(() => {
    if (article) trackView(article.id, 'view', articleType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id]);

  // Article body container — Read Aloud highlights blocks inside it as it reads.
  const proseRef = useRef<HTMLElement | null>(null);

  // What to display (translation/override take precedence over the original).
  const displayTitle = tTitle ?? article?.title ?? '';
  const rawContent = overrideContent ?? tContent ?? article?.content ?? '';

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

  if (loading && !article) {
    return (
      <main className="main-content">
        <div className={styles.loading}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          Loading article…
        </div>
      </main>
    );
  }

  if (notFound || !article) {
    return (
      <main className="main-content">
        <div className={styles.error}>
          <h2>Article not found</h2>
          <p style={{ marginTop: 12 }}>
            <Link href="/" style={{ color: 'var(--accent-gold)' }}>
              ← Back to home
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const categoryLabel = TOPIC_LABELS[article.category] || article.category;

  return (
    <>
      {/* Outside .main-content so the hero spans the full window width rather
          than being inset by that container's max-width gutters. */}
      <section className={styles.hero}>
        <img
          src={article.image || FALLBACK_IMG}
          alt={displayTitle}
          className={styles.heroImage}
          onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_IMG)}
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
        <ReviewerTools
          articleId={article.id}
          isCurrentEvent={article.isCurrentEvent}
          onRewritten={(c) => setOverrideContent(c)}
        />
        <div className={styles.heroOverlay}>
          <div>
            <div className={styles.metaTop}>
              <span className={styles.sourceBadge}>
                {article.isCurrentEvent ? 'JubileeVerse' : article.sourceName || 'Good News'}
              </span>
              {categoryLabel ? <span className={styles.category}>{categoryLabel}</span> : null}
            </div>
            <h1 className={styles.heroTitle}>{displayTitle}</h1>
            <div className={styles.metaBottom}>
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
              {article.faithCommentary ? (
                <>
                  <strong>A Christian Perspective</strong>
                  <p>{article.faithCommentary}</p>
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

            <ReactionBar articleId={article.id} articleType={articleType} />

            {article.sourceUrl ? (
              <a className={styles.sourceLink} href={article.sourceUrl} target="_blank" rel="noopener noreferrer">
                Read the original source →
              </a>
            ) : null}
          </div>

          <aside className={styles.sidebar}>
            <ReadAloud text={rawContent} contentRef={proseRef} />
            <TranslateArticle
              articleId={article.id}
              fallbackTitle={article.title}
              fallbackContent={article.content}
              onTranslated={(title, content) => {
                setTTitle(title);
                setTContent(content);
              }}
              onRestore={() => {
                setTTitle(null);
                setTContent(null);
              }}
            />
            <ShareStory title={displayTitle} />
            <DailyVerseWidget />
            <RelatedStories currentId={article.id} category={article.category} />
          </aside>
        </div>

        <div className={styles.container} style={{ maxWidth: 'var(--max-width)' }}>
          <RelatedArticlesGrid currentId={article.id} category={article.category} />
        </div>
      </main>
    </>
  );
}

'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import ArticleReader from '@/components/article/ArticleReader';
import styles from '@/components/article/ArticleReader.module.css';
import { api } from '@/lib/api';
import { readSelectedArticle, type SelectedArticle } from '@/lib/article';
import { parseArticleId } from '@/lib/articleId';
import { useAuth } from '@/lib/auth';

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

/**
 * The article reader for backend stories and published markdown bundles.
 *
 * This page only resolves the article; the reading experience itself lives in
 * <ArticleReader>, which the root segment renders too so CDN news at /<slug>
 * looks and behaves identically.
 */
export default function ArticlePage() {
  const params = useParams<{ id: string }>();
  const { refresh } = useAuth();
  const id = params.id;
  const [article, setArticle] = useState<ArticleView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
    //
    //    Markdown-authored articles are published as bundles rather than stored
    //    in the backend, so they resolve through /article-source instead — a
    //    Next route, because the CDN sends no CORS headers and the browser
    //    cannot read the bundle itself.
    (async () => {
      const published = parseArticleId(String(id));
      const endpoints = published
        ? [`/article-source/${published.categorySlug}/${published.slug}`]
        : [`/api/public/article/${id}`, `/api/articles/${id}`];
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
              // Published articles carry a byline rather than a syndication
              // source; it fills the same badge.
              sourceName:
                (a.source_name as string) || (a.author as string) || stored?.sourceName || '',
              sourceUrl: (a.source_url as string) || stored?.originalUrl || '',
              // A parsed id is authoritative: this came from a published .md
              // bundle, so it is never a current event whatever the stashed
              // story claimed on the way in.
              isCurrentEvent: published ? false : (stored?.isCurrentEvent ?? false),
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

  return (
    <ArticleReader
      id={article.id}
      title={article.title}
      content={article.content}
      image={article.image}
      category={article.category}
      sourceName={article.sourceName}
      sourceUrl={article.sourceUrl}
      isCurrentEvent={article.isCurrentEvent}
      faithCommentary={article.faithCommentary}
    />
  );
}

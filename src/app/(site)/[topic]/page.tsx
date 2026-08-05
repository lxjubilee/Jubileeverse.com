import { permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import ArticleReader from '@/components/article/ArticleReader';
import TopicPortal from './TopicPortal';
import {
  fetchCategoryArticles,
  fetchCategoryLabel,
  isNavCategorySlug,
  isPublishedCategory,
} from '@/lib/articles';
import { reactionIdForSlug } from '@/lib/homeFeed';
import { fetchNewsArticleBySlug, parseNewsId, toReaderBody } from '@/lib/news';
import { NAMED_PORTAL_SLUGS } from '@/lib/portals';
import { rotateForWindow } from '@/lib/rotation';

/**
 * The root segment: category portals and news articles share it.
 *
 * Articles are read at `/<slug>` — `/seouls-chip-stocks-jump-18-percent` — and
 * categories at `/<category>`, which Next cannot express as two dynamic routes
 * at the same level. So one route resolves both, in an order that keeps
 * navigation authoritative:
 *
 *   1. a nav category, a named portal, or a published bundle -> the portal;
 *   2. otherwise a published news slug -> the article reader;
 *   3. otherwise the portal's own empty state, exactly as before.
 *
 * Navigation winning matters: a category slug is structural, and a news article
 * that happened to slugify onto one must never take the nav's page away. The
 * nav and portal slugs are answered from the configured lists with no I/O, and
 * the bundle check is memoised for five minutes, so an article URL costs no
 * extra round trip.
 *
 * Articles come from the CDN bundle and categories from the published article
 * bundles; both resolve on the server because the CDN sends no CORS headers.
 *
 * A portal's cards are re-ordered once every six PST hours — see the render
 * below. Articles resolve by id, so the order a reader arrives on never affects
 * where a card leads.
 */

/**
 * The article for this segment, or null when the segment is navigation.
 *
 * `cache()` keeps generateMetadata and the render to one resolution per request
 * rather than fetching the manifest and body twice.
 */
const resolveArticle = cache(async (slug: string) => {
  if (NAMED_PORTAL_SLUGS.has(slug)) return null;
  if (isNavCategorySlug(slug)) return null;
  if (await isPublishedCategory(slug)) return null;
  return fetchNewsArticleBySlug(slug);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const article = await resolveArticle(topic);
  // Categories keep the site-wide defaults from the root layout.
  if (!article) return {};

  return {
    title: `${article.title} — JubileeVerse`,
    description: article.summary,
    alternates: { canonical: `/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.summary,
      images: article.image ? [article.image] : undefined,
      type: 'article',
      publishedTime: article.created,
    },
  };
}

export default async function RootSegmentPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;

  // Articles published before slug URLs existed were addressed as
  // `<YYYY-MM-DD>__<slug>`, and /news/<that> now lands here. Send it on to the
  // canonical URL rather than 404 a link someone may already have shared.
  const legacy = parseNewsId(topic);
  if (legacy) permanentRedirect(`/${legacy.slug}`);

  const article = await resolveArticle(topic);

  if (article) {
    return (
      <ArticleReader
        id={article.slug}
        // Views, reactions and the translation cache key on an INTEGER
        // article_id, which a slug cannot supply; news carries a stable hashed
        // id instead.
        trackingId={reactionIdForSlug(article.slug)}
        title={article.title}
        // The hero is the only picture the reader shows; the body's images —
        // hero included — are trimmed out of the prose.
        content={toReaderBody(article.content)}
        image={article.image}
        category={article.topic}
        sourceName={article.sourceName}
        sourceUrl={article.sourceUrl}
        isCurrentEvent
        author={article.writer}
        date={article.date}
        // The reviewer endpoints act on backend rows; a CDN article has none.
        showReviewerTools={false}
      />
    );
  }

  const [categoryLabel, articles] = await Promise.all([
    fetchCategoryLabel(topic),
    fetchCategoryArticles(topic),
  ]);

  // Re-order every six PST hours so a portal that publishes rarely still reads
  // differently through the day. Seeded on the window and the category, so
  // every reader sees one order within a window, each category rotates
  // independently, and the server render matches its hydration.
  //
  // Deliberately here and not in fetchCategoryArticles(): the Home page's
  // faith-based inserts come from the same call and take the newest articles
  // first, which is rotation the Home page already does its own way.
  return (
    <TopicPortal categoryLabel={categoryLabel} articles={rotateForWindow(articles, topic)} />
  );
}

/**
 * Home page feed — the daily CDN news, in the shape the Home page already uses.
 *
 * The Home page is a client component and the CDN sends no CORS headers, so the
 * browser cannot read the news manifests itself. This route does it server-side
 * and hands back the same `{ success, hero, sidebar, topicCards }` envelope the
 * old PostgreSQL `/api/homepage-placement` returned, so the page needed only a
 * URL change.
 *
 * Deliberately NOT under `/api`: next.config.mjs rewrites `/api/:path*` to the
 * Express backend. Filesystem routes currently win over that rewrite, but it is
 * a subtle ordering detail one `beforeFiles` edit away from silently proxying
 * this to Express. `/news-feed` sits alongside the existing `/article-source`
 * and `/article-files` CDN handlers.
 */
import { NextResponse } from 'next/server';
import { CATEGORY_ROUTES, fetchCategoryArticles, type SiteArticle } from '@/lib/articles';
import { fetchLatestNews } from '@/lib/news';
import { buildHomeFeed, categoryArticleToStory, rotateCategories } from '@/lib/homeFeed';
import type { Story } from '@/lib/types';

/** Days of history to surface on the Home page. */
const DAYS = 7;

/** Upper bound on cards, matching the old portal capacity. */
const LIMIT = 58;

/**
 * Faith-based articles offered for insertion into the feed.
 *
 * Generous enough to cover the longest feed the limit above can produce (one
 * insert per four cards), so the page never runs short of them. They come from
 * manifests this process already memoises for five minutes, so the extra reads
 * cost nothing after the first.
 */
const CATEGORY_POOL = 20;

/** Re-read the CDN at most this often; `news.ts` also memoises manifests 5 min. */
export const revalidate = 60;

/**
 * The five categories' newest articles, taken one category at a time.
 *
 * Imageless articles are dropped before the rotation, so a category with a
 * pending image contributes its next article rather than a placeholder card —
 * the same hard exclusion the news side applies.
 *
 * Never throws: a category that fails to resolve simply contributes nothing,
 * and an empty pool leaves the feed exactly as it was before this existed.
 */
async function fetchCategoryPool(): Promise<Story[]> {
  const perCategory = await Promise.all(
    CATEGORY_ROUTES.map((slug) => fetchCategoryArticles(slug).catch(() => [] as SiteArticle[])),
  );
  return rotateCategories(
    perCategory.map((articles) => articles.filter((a) => a.image).map(categoryArticleToStory)),
    CATEGORY_POOL,
  );
}

export async function GET() {
  try {
    const [articles, categoryCards] = await Promise.all([
      fetchLatestNews(DAYS, LIMIT),
      fetchCategoryPool(),
    ]);
    const feed = buildHomeFeed(articles, categoryCards);

    return NextResponse.json(feed, {
      headers: {
        // Short public cache: the pipeline republishes hourly, and the day
        // manifest itself is served with max-age=60.
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    // Never 500 the Home page. The old endpoint returned empty arrays on
    // failure rather than an error, and the page renders that state fine.
    console.error('[news-feed]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: true, hero: [], sidebar: [], topicCards: [], categoryCards: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

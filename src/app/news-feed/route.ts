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
import { FEED_WINDOW_DAYS, fetchNewsWindow } from '@/lib/news';
import {
  PAGE_SIZE, buildHomeFeed, categoryArticleToStory, intParam, rotateCategories,
} from '@/lib/homeFeed';
import type { Story } from '@/lib/types';

/**
 * Days of history to surface on the Home page.
 *
 * Was 7, but paired with a 58-card cap it showed one day: the pipeline
 * publishes 60 articles a day, so today alone filled every slot and nothing
 * older was ever reached. The window and the page size are now independent —
 * the window says how far back the feed goes, the page size says how much of it
 * travels in one response.
 */
const DAYS = FEED_WINDOW_DAYS;

/**
 * Faith-based articles offered for insertion into the feed.
 *
 * One insert per four grid cards, so a month-deep window needs far more of them
 * than the old single-page feed did. They come from manifests this process
 * already memoises for five minutes, so the extra reads cost nothing after the
 * first, and `rotateCategories` keeps any one category from dominating.
 */
const CATEGORY_POOL = 200;

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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Bounded so a crafted `?limit=100000` cannot turn one request into a
  // month-long payload, which is the whole thing paging exists to avoid.
  const offset = intParam(params.get('offset'), 0, 100_000);
  const pageSize = intParam(params.get('limit'), PAGE_SIZE, 200) || PAGE_SIZE;

  try {
    const [articles, categoryCards] = await Promise.all([
      fetchNewsWindow(DAYS),
      fetchCategoryPool(),
    ]);
    const feed = buildHomeFeed(articles, categoryCards, { offset, pageSize });

    return NextResponse.json(feed, {
      headers: {
        // Short public cache: the pipeline republishes every six hours, and the
        // day manifest itself is served with max-age=60. Pages past the first
        // are keyed by their query string, so each caches independently.
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    // Never 500 the Home page. The old endpoint returned empty arrays on
    // failure rather than an error, and the page renders that state fine.
    console.error('[news-feed]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        success: true, hero: [], sidebar: [], topicCards: [], categoryCards: [],
        total: 0, offset, hasMore: false,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

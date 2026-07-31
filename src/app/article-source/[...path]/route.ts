import { fetchArticle } from '@/lib/articles';

/**
 * One published article as JSON, for the reader at /article/<category>/<slug>.
 *
 * The reader is a client component, and the CDN sends no CORS headers, so the
 * browser cannot fetch the markdown itself in production. This route reads it
 * server-side from whichever source is active and hands back just the fields
 * the page renders.
 *
 * Deliberately *not* under /api: next.config.mjs rewrites `/api/:path*` to the
 * Express backend, which would shadow this handler.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const [categorySlug, slug] = segments || [];

  if (!categorySlug || !slug || segments.length !== 2) {
    return Response.json({ error: 'Expected /article-source/<category>/<slug>' }, { status: 400 });
  }

  const article = await fetchArticle(categorySlug, slug);
  if (!article) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json(
    { article },
    { headers: { 'Cache-Control': 'no-cache' } },
  );
}

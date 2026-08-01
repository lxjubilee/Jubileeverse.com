import { articlesCdnUrl } from '@/lib/articles';

/**
 * Legacy asset path for published article bundles.
 *
 * It existed to serve hero images out of a local working folder that sat
 * outside the Next public directory. Bundles are now read from the CDN only
 * (see @/lib/articles), so nothing generates these URLs any more — the route
 * stays as a permanent redirect so links already in the wild, or in a page a
 * browser still has cached, keep resolving.
 *
 * Deliberately *not* under /api: next.config.mjs rewrites `/api/:path*` to the
 * Express backend, which would shadow this handler.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const relPath = (segments || []).join('/');
  if (!relPath) return new Response('Not found', { status: 404 });

  // 308 keeps the method and tells caches the move is permanent.
  return Response.redirect(articlesCdnUrl(relPath), 308);
}

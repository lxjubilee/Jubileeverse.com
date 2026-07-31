import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ARTICLES_LOCAL_ROOT,
  articlesCdnUrl,
  articlesSource,
} from '@/lib/articles';

/**
 * Serves published article assets (hero images) while developing.
 *
 * The working folder sits outside the Next public directory — on another drive
 * entirely — so it cannot be served statically. Once the bundles are on the CDN
 * the portals link there directly and this route only ever redirects.
 *
 * Deliberately *not* under /api: next.config.mjs rewrites `/api/:path*` to the
 * Express backend, which would shadow this handler.
 */

/** Only content types that belong to an article bundle are served. */
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const relPath = (segments || []).join('/');
  if (!relPath) return new Response('Not found', { status: 404 });

  // Published assets live on the CDN; keep the URL working by pointing at it.
  if ((await articlesSource()) === 'cdn') {
    return Response.redirect(articlesCdnUrl(relPath), 307);
  }

  const extension = path.extname(relPath).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) return new Response('Not found', { status: 404 });

  // Resolve, then confirm the result is still inside the articles root — a
  // segment like ".." must never reach outside it.
  const root = path.resolve(ARTICLES_LOCAL_ROOT);
  const target = path.resolve(root, relPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const file = await fs.readFile(target);
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': contentType,
        // Local files change as articles are regenerated; revalidate each time.
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

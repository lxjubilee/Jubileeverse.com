/**
 * CDN origin for everything the site reads: published article bundles, the
 * daily news bundle, and their images.
 *
 * The nav categories used to come from a large `articles_catalog.json` at the
 * CDN root. That file is not published, so the nav rendered empty; the category
 * list now comes from the five published bundles instead — see
 * `fetchNavCategories` in @/lib/articles, which owns those manifests. Nothing
 * here fetches anything any more.
 *
 * Configure with:
 *   CDN_BASE_URL   default https://cdn.jubileeverse.com
 */

export const CDN_BASE_URL = (process.env.CDN_BASE_URL || 'https://cdn.jubileeverse.com').replace(
  /\/+$/,
  '',
);

/** Join a path onto the configured CDN origin. */
export function cdnUrl(path: string): string {
  return `${CDN_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

/**
 * A nav entry as consumed by the client components.
 *
 * Declared here rather than beside the fetcher so the client components that
 * only need the type do not import the server-side articles module.
 */
export interface NavCategory {
  slug: string;
  label: string;
}

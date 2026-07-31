/**
 * CDN-backed site configuration.
 *
 * The five-fold nav categories come from the published articles catalog on the
 * CDN rather than from the `jv_taxonomy` table. The catalog is large (~2.6 MB)
 * and is served without CORS headers, so it is fetched **server-side only** —
 * from the (site) layout — and just the handful of fields the nav needs are
 * passed to the client. Never fetch this URL from the browser.
 *
 * Scope note: this catalog now supplies the **nav only**. Article listings and
 * bodies come from the published article bundles instead — see @/lib/articles.
 * The catalog still carries an older, larger set of articles under a four-level
 * subcategory tree; none of it is rendered.
 *
 * Configure with:
 *   CDN_BASE_URL              default https://cdn.jubileeverse.com
 *   CDN_ARTICLES_CATALOG_PATH default /articles/articles_catalog.json
 */

export const CDN_BASE_URL = (process.env.CDN_BASE_URL || 'https://cdn.jubileeverse.com').replace(
  /\/+$/,
  '',
);

export const CDN_ARTICLES_CATALOG_PATH =
  process.env.CDN_ARTICLES_CATALOG_PATH || '/articles/articles_catalog.json';

/** Join a path onto the configured CDN origin. */
export function cdnUrl(path: string): string {
  return `${CDN_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

/** How long (seconds) a fetched catalog stays fresh before revalidation. */
const CATALOG_REVALIDATE_SECONDS = 3600;

/** Give up rather than hanging every page render on a slow CDN. */
const CATALOG_TIMEOUT_MS = 8000;

/** A nav entry as consumed by the client components. */
export interface NavCategory {
  slug: string;
  label: string;
}

/** Shape of one `categories[]` entry in articles_catalog.json. */
interface CatalogCategory {
  slug?: string;
  name?: string;
}

interface Catalog {
  categories?: CatalogCategory[];
}

/**
 * The catalog publishes "torah-hebraic", but the category portal (`/[topic]`)
 * resolves its slug against `jv_taxonomy`, which stores
 * "torah-hebraic-insights" — linking to the catalog slug would land on an empty
 * portal. Remap here until the two agree, then delete this.
 *
 * @/lib/articles carries the inverse mapping, since the published bundle is
 * named for the catalog slug rather than the route.
 */
const SLUG_ALIASES: Record<string, string> = {
  'torah-hebraic': 'torah-hebraic-insights',
};

/** The route slug used for a catalog category. */
const routeSlugFor = (catalogSlug: string): string => SLUG_ALIASES[catalogSlug] ?? catalogSlug;

/**
 * Parsed catalog, memoised in the server process.
 *
 * Next's data cache cannot hold this response — it rejects entries over 2 MB
 * ("Failed to set Next.js data cache … items over 2MB can not be cached"), so
 * `next: { revalidate }` silently re-downloaded the whole catalog on every
 * call. Memoising the parsed object avoids that, and `inFlight` is held while a
 * request is open so concurrent callers share it instead of racing.
 *
 * Note this is process state, not the Next cache: `next dev` re-instantiates
 * server modules per request, so the window below only spans a single render
 * there (measured). Under `next start` the process is long-lived and it spans
 * requests.
 */
let cache: { at: number; catalog: Catalog | null } | null = null;
let inFlight: Promise<Catalog | null> | null = null;

/**
 * Fetch and parse the catalog, reusing the in-process copy while it is fresh.
 * Returns null on any failure; callers degrade rather than throw.
 */
async function loadCatalog(): Promise<Catalog | null> {
  if (cache && Date.now() - cache.at < CATALOG_REVALIDATE_SECONDS * 1000) {
    return cache.catalog;
  }
  if (inFlight) return inFlight;

  const url = cdnUrl(CDN_ARTICLES_CATALOG_PATH);
  inFlight = (async () => {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error(`[cdn] ${url} -> HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as Catalog;
    } catch (err) {
      console.error(`[cdn] ${url} fetch failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  })();

  try {
    const catalog = await inFlight;
    // Only a good response earns the full window; a failure retries next call.
    if (catalog) cache = { at: Date.now(), catalog };
    return catalog;
  } finally {
    inFlight = null;
  }
}

/**
 * Read the five-fold categories from the CDN catalog, in catalog order.
 * Returns [] on any failure — the nav is chrome, not critical content.
 */
export async function fetchNavCategories(): Promise<NavCategory[]> {
  const categories = (await loadCatalog())?.categories;
  if (!Array.isArray(categories)) return [];
  return categories
    .filter((c): c is CatalogCategory & { slug: string; name: string } => !!c?.slug && !!c?.name)
    .map((c) => ({ slug: routeSlugFor(c.slug), label: c.name.toUpperCase() }));
}

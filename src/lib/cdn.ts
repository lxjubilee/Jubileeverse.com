/**
 * CDN-backed site configuration.
 *
 * The five-fold nav categories come from the published articles catalog on the
 * CDN rather than from the `jv_taxonomy` table. The catalog is large (~2.6 MB)
 * and is served without CORS headers, so it is fetched **server-side only** —
 * from the (site) layout — and just the handful of fields the nav needs are
 * passed to the client. Never fetch this URL from the browser.
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

/** A direct child of a category, shown on that category's portal page. */
export interface NavSubcategory {
  slug: string;
  label: string;
  tier?: string;
}

/** Shape of one `categories[].subcategories[]` entry. */
interface CatalogSubcategory {
  slug?: string;
  name?: string;
  tier?: string;
  rank?: number;
}

/** Shape of one `categories[]` entry in articles_catalog.json. */
interface CatalogCategory {
  slug?: string;
  name?: string;
  subcategories?: CatalogSubcategory[];
}

interface Catalog {
  categories?: CatalogCategory[];
}

/**
 * The catalog publishes "torah-hebraic", but the category portal (`/[topic]`)
 * resolves its slug against `jv_taxonomy`, which stores
 * "torah-hebraic-insights" — linking to the catalog slug would land on an empty
 * portal. Remap here until the two agree, then delete this.
 */
const SLUG_ALIASES: Record<string, string> = {
  'torah-hebraic': 'torah-hebraic-insights',
};

/** The route slug used for a catalog category. */
const routeSlugFor = (catalogSlug: string): string => SLUG_ALIASES[catalogSlug] ?? catalogSlug;

/**
 * Fetch and parse the catalog. Both callers below use identical fetch options,
 * so Next dedupes them into a single request per revalidation window — the
 * 2.6 MB body is not downloaded twice per render.
 */
async function loadCatalog(): Promise<Catalog | null> {
  const url = cdnUrl(CDN_ARTICLES_CATALOG_PATH);
  try {
    const res = await fetch(url, {
      next: { revalidate: CATALOG_REVALIDATE_SECONDS },
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

/**
 * Direct (level-1) subcategories of one category, by its route slug, ordered by
 * the catalog's `rank`. Returns [] for slugs the catalog doesn't publish — the
 * portal simply renders without a subcategory row.
 */
export async function fetchSubcategories(routeSlug: string): Promise<NavSubcategory[]> {
  const categories = (await loadCatalog())?.categories;
  if (!Array.isArray(categories)) return [];

  const match = categories.find((c) => c?.slug && routeSlugFor(c.slug) === routeSlug);
  if (!Array.isArray(match?.subcategories)) return [];

  return match.subcategories
    .filter((s): s is CatalogSubcategory & { slug: string; name: string } => !!s?.slug && !!s?.name)
    .slice()
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((s) => ({ slug: s.slug, label: s.name, tier: s.tier }));
}

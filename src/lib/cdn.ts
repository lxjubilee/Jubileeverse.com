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
}

/** One published article, as rendered on a category portal. */
export interface CatalogArticle {
  /** `topic_path` — unique per article and stable across catalog publishes. */
  id: string;
  title: string;
  /** Category display name ("Covenant & Identity"). */
  pillar: string;
  /** Absolute CDN URL of the first generated image, or null while pending. */
  image: string | null;
  created: string;
}

/**
 * One level of the drill-down: where you are, what sits under it, and what to
 * render there. `null` from the resolver means the path is not in the catalog.
 */
export interface SubcategoryView {
  /** Display name of the node itself. */
  label: string;
  /** Ancestors, nearest-last, each linkable. Excludes the node itself. */
  trail: { label: string; href: string }[];
  /** Direct children, in catalog rank order. */
  children: NavSubcategory[];
  /** Articles published anywhere beneath this node. */
  articles: CatalogArticle[];
}

/** Shape of one `categories[].subcategories[]` entry. Nests to 4 levels. */
interface CatalogSubcategory {
  slug?: string;
  name?: string;
  tier?: string;
  rank?: number;
  subcategories?: CatalogSubcategory[];
}

/** Shape of one `categories[]` entry in articles_catalog.json. */
interface CatalogCategory {
  slug?: string;
  name?: string;
  subcategories?: CatalogSubcategory[];
}

/** Shape of one `articles[]` entry in articles_catalog.json. */
interface CatalogArticleRow {
  title?: string;
  writer?: string;
  pillar?: string;
  /** Catalog slug of the owning category, e.g. "covenant-identity". */
  category_path?: string;
  /** Full slug path, unique per article. */
  topic_path?: string;
  /**
   * Canonical published URL. This — not `topic_path` — is what places an article
   * in the subcategory tree: its path is `<category>/<l1>/…/<article-slug>`.
   * (`topic_path` is only `<category>/<slug>` for 376 of 384 articles, so it
   * cannot be used to resolve a node.)
   */
  url?: string;
  /** Markdown source, relative to /articles on the CDN. */
  file?: string;
  status?: string;
  created?: string;
  /** Image paths relative to /articles on the CDN; empty while pending. */
  images?: string[];
  image_status?: string;
}

interface Catalog {
  categories?: CatalogCategory[];
  articles?: CatalogArticleRow[];
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

/** The catalog slug behind a route slug — the inverse of the aliases above. */
const CATALOG_SLUGS: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_ALIASES).map(([catalog, route]) => [route, catalog]),
);
const catalogSlugFor = (routeSlug: string): string => CATALOG_SLUGS[routeSlug] ?? routeSlug;

/**
 * An article's position in the subcategory tree, as a `/`-joined slug path
 * relative to the articles root — e.g.
 * "covenant-identity/hebrew-meaning-of-your-name/…/scriptural-precedent-for-renaming".
 * Derived from `url`, which is the only field that carries the full hierarchy.
 */
function articleTreePath(a: CatalogArticleRow): string {
  return (a.url || '')
    .replace(/^https?:\/\/[^/]+\/articles\//, '')
    .replace(/\/+$/, '');
}

/** Every article published at or beneath a `<category>/<…>` slug prefix. */
function articlesUnder(articles: CatalogArticleRow[], prefix: string): CatalogArticle[] {
  return articles
    .filter(
      (a): a is CatalogArticleRow & { title: string; topic_path: string } =>
        !!a?.title && !!a?.topic_path && articleTreePath(a).startsWith(prefix),
    )
    .map((a) => ({
      id: a.topic_path,
      title: a.title,
      pillar: a.pillar || '',
      image: a.images?.[0] ? cdnUrl(`articles/${a.images[0]}`) : null,
      created: a.created || '',
    }))
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** Direct children of a node, in catalog rank order. */
function childrenOf(node: { subcategories?: CatalogSubcategory[] }): NavSubcategory[] {
  if (!Array.isArray(node.subcategories)) return [];
  return node.subcategories
    .filter((s): s is CatalogSubcategory & { slug: string; name: string } => !!s?.slug && !!s?.name)
    .slice()
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((s) => ({ slug: s.slug, label: s.name }));
}

/**
 * Parsed catalog, memoised in the server process.
 *
 * Next's data cache cannot hold this response — it rejects entries over 2 MB
 * ("Failed to set Next.js data cache … items over 2MB can not be cached"), so
 * `next: { revalidate }` silently re-downloaded the whole catalog for every
 * helper call: three downloads to render one portal page. Memoising the parsed
 * object collapses that to one, and `inFlight` is held while a request is open
 * so concurrent callers share it instead of racing.
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

/**
 * The catalog's display name for one category, by its route slug — e.g.
 * "Covenant & Identity" for "covenant-identity". Returns null for slugs the
 * catalog doesn't publish, so callers can fall back to humanizing the slug.
 */
export async function fetchCategoryLabel(routeSlug: string): Promise<string | null> {
  const categories = (await loadCatalog())?.categories;
  if (!Array.isArray(categories)) return null;

  const match = categories.find((c) => c?.slug && routeSlugFor(c.slug) === routeSlug);
  return match?.name || null;
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
  return match ? childrenOf(match) : [];
}

/**
 * Articles published under one category, by its route slug, newest first.
 *
 * The catalog is the source of truth for editorial articles — they are authored
 * as markdown on the CDN and are not rows in the Express content tables, so the
 * portal must not look for them in /api/search. Returns [] for categories the
 * catalog doesn't publish yet.
 *
 * Image paths in the catalog are relative to /articles on the CDN; they are
 * resolved to absolute URLs here so the browser loads them straight from the CDN.
 */
export async function fetchCategoryArticles(routeSlug: string): Promise<CatalogArticle[]> {
  const articles = (await loadCatalog())?.articles;
  if (!Array.isArray(articles)) return [];
  return articlesUnder(articles, `${catalogSlugFor(routeSlug)}/`);
}

/**
 * Resolve one level of the subcategory drill-down.
 *
 * `segments` are the subcategory slugs below the category, so
 * `["hebrew-meaning-of-your-name", "supreme-name-above-every-name"]` under
 * "covenant-identity" resolves that node, its five children, and every article
 * published beneath it. The catalog nests exactly four levels under each
 * category (5 / 25 / 125 / 625 nodes), so the deepest level has no children and
 * renders as articles only.
 *
 * Articles are collected recursively by slug-path prefix, not just the ones
 * sitting exactly at this node — most nodes hold their articles further down, so
 * an exact match would show an empty portal on the way in.
 *
 * Returns null when the path is not in the catalog, so the route can 404.
 */
export async function fetchSubcategoryView(
  routeSlug: string,
  segments: string[],
): Promise<SubcategoryView | null> {
  const catalog = await loadCatalog();
  const categories = catalog?.categories;
  if (!Array.isArray(categories) || !segments.length) return null;

  const category = categories.find((c) => c?.slug && routeSlugFor(c.slug) === routeSlug);
  if (!category) return null;

  // Walk the requested path, collecting ancestors for the breadcrumb.
  const trail: { label: string; href: string }[] = [
    { label: category.name || routeSlug, href: `/${routeSlug}` },
  ];
  let node: CatalogSubcategory = category;
  for (const [i, segment] of segments.entries()) {
    const next = (node.subcategories || []).find((s) => s?.slug === segment);
    if (!next) return null;
    // The node itself is the current page, so it is not part of the trail.
    if (i < segments.length - 1) {
      trail.push({
        label: next.name || segment,
        href: `/${routeSlug}/${segments.slice(0, i + 1).join('/')}`,
      });
    }
    node = next;
  }

  const prefix = `${catalogSlugFor(routeSlug)}/${segments.join('/')}/`;
  return {
    label: node.name || segments[segments.length - 1],
    trail,
    children: childrenOf(node),
    articles: articlesUnder(catalog?.articles || [], prefix),
  };
}

/**
 * Published-articles source for the five-fold category portals.
 *
 * Articles are authored as markdown and published as a per-category bundle,
 * read from the CDN and nowhere else:
 *
 *   <CDN_BASE_URL>/articles/<category>/articles.json     manifest — the list
 *   <CDN_BASE_URL>/articles/<category>/<slug>.md         frontmatter + body
 *   <CDN_BASE_URL>/articles/<category>/images/<file>     hero image
 *
 * One source, everywhere: localhost renders exactly what production renders,
 * so nothing depends on a working drive being mounted and no environment can
 * quietly serve different content. Authoring still happens in a working folder
 * and reaches the site by being published to the CDN.
 *
 * The manifest is the source of truth: a category with `"articles": []` renders
 * as empty even if stray files sit beside it. Anything not listed there — and
 * anything still in the old CDN articles catalog — is not published.
 *
 * **Server-side only.** The CDN is served without CORS headers, so the browser
 * can never read these files itself: the portals are server components, images
 * are linked straight to the CDN, and the reader goes through /article-source.
 */
import { makeArticleId } from './articleId';
import { CDN_BASE_URL, type NavCategory } from './cdn';

/** Where the published article bundles live. */
export const ARTICLES_CDN_ROOT = `${CDN_BASE_URL}/articles`;

/** Give up rather than hanging a page render on a slow CDN. */
const FETCH_TIMEOUT_MS = 8000;

/** How long a fetched manifest stays fresh. */
const MANIFEST_TTL_MS = 5 * 60 * 1000;

/**
 * Route slug -> published folder name, where the two differ. The nav links to
 * "torah-hebraic-insights" (the taxonomy slug) but the bundle is published as
 * "torah-hebraic"; without this the portal would resolve to nothing.
 */
const FOLDER_BY_ROUTE: Record<string, string> = {
  'torah-hebraic-insights': 'torah-hebraic',
};

/** The published folder backing a route slug. */
export function folderForRoute(routeSlug: string): string {
  return FOLDER_BY_ROUTE[routeSlug] ?? routeSlug;
}

/**
 * The five category route slugs, in reading order.
 *
 * The nav resolves its categories from the CDN catalog, but anything that has
 * to walk the whole library (the Backstage index) needs the list without a
 * network round trip, so it is stated once here.
 */
export const CATEGORY_ROUTES = [
  'covenant-identity',
  'teshuvah-restoration',
  'shalom-salvation',
  'celebration-mishpakhah',
  'torah-hebraic-insights',
] as const;

/** One entry in a category manifest's `articles[]`. */
interface ManifestArticle {
  slug?: string;
  title?: string;
  file?: string;
  author?: string;
  date_updated?: string;
  status?: string;
  image_file?: string;
  image_status?: string;
}

/** Shape of `<category>/articles.json`. */
interface Manifest {
  category?: string;
  category_slug?: string;
  updated?: string;
  articles?: ManifestArticle[];
}

/** One published article, as rendered on a category portal. */
export interface SiteArticle {
  /** Stable id, and the single path segment used in /article/<id>. */
  id: string;
  slug: string;
  /** Route slug of the owning category. */
  categorySlug: string;
  title: string;
  author: string;
  /** Category display name ("Covenant & Identity"). */
  category: string;
  /** Resolved image URL, or null while the image is still pending. */
  image: string | null;
  created: string;
}

/** A single article with its body, for the reader. */
export interface SiteArticleDetail extends SiteArticle {
  summary: string;
  /** Markdown body with the frontmatter block removed. */
  content: string;
}

/** Strip leading slashes so a relative path can be joined onto the root. */
const clean = (relPath: string) => relPath.replace(/^[\\/]+/, '');

/** Absolute CDN URL for a path relative to the articles root. */
export const articlesCdnUrl = (relPath: string) => `${ARTICLES_CDN_ROOT}/${clean(relPath)}`;

/**
 * Read one file from the published bundle. Returns null when it is missing —
 * callers degrade to an empty portal rather than throwing.
 */
export async function readArticleFile(relPath: string): Promise<string | null> {
  const url = articlesCdnUrl(relPath);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 404 is normal for a category that is not published yet.
      if (res.status !== 404) console.error(`[articles] ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`[articles] ${url} fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * The URL a browser should use for a published asset (hero images).
 *
 * Straight to the CDN, so images keep edge caching and never round-trip
 * through this server.
 */
export const articleAssetUrl = articlesCdnUrl;

const manifestCache = new Map<string, { at: number; manifest: Manifest | null }>();

/** Parsed `<folder>/articles.json`, or null when the category is not published. */
async function readManifest(folder: string): Promise<Manifest | null> {
  const cached = manifestCache.get(folder);
  if (cached && Date.now() - cached.at < MANIFEST_TTL_MS) return cached.manifest;

  const raw = await readArticleFile(`${folder}/articles.json`);
  let manifest: Manifest | null = null;
  if (raw) {
    try {
      manifest = JSON.parse(raw) as Manifest;
    } catch (err) {
      console.error(
        `[articles] ${folder}/articles.json is not valid JSON:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Negative results are cached too: an unpublished category must not cost a
  // CDN round trip on every render, and the root segment asks about every
  // unknown slug that reaches it.
  manifestCache.set(folder, { at: Date.now(), manifest });
  return manifest;
}

/** Manifest entry -> the shape the portals render. */
function toSiteArticle(
  entry: ManifestArticle & { slug: string; title: string },
  routeSlug: string,
  folder: string,
  categoryLabel: string,
): SiteArticle {
  // An image is only linked once it has actually been generated; otherwise the
  // card renders its placeholder rather than a broken <img>.
  const hasImage = entry.image_status === 'generated' && !!entry.image_file;
  return {
    id: makeArticleId(routeSlug, entry.slug),
    slug: entry.slug,
    categorySlug: routeSlug,
    title: entry.title,
    author: entry.author || '',
    category: categoryLabel,
    image: hasImage ? articleAssetUrl(`${folder}/images/${entry.image_file}`) : null,
    created: entry.date_updated || '',
  };
}

/** Published entries of a manifest, newest first. */
function publishedEntries(manifest: Manifest): (ManifestArticle & { slug: string; title: string })[] {
  return (manifest.articles || [])
    .filter(
      (a): a is ManifestArticle & { slug: string; title: string } =>
        !!a?.slug && !!a?.title && a.status === 'published',
    )
    .slice()
    .sort((a, b) => (b.date_updated || '').localeCompare(a.date_updated || ''));
}

/**
 * Every published article in one category, newest first. Returns [] for a
 * category that is not published or has an empty manifest.
 */
export async function fetchCategoryArticles(routeSlug: string): Promise<SiteArticle[]> {
  const folder = folderForRoute(routeSlug);
  const manifest = await readManifest(folder);
  if (!manifest) return [];

  const label = manifest.category || '';
  return publishedEntries(manifest).map((entry) => toSiteArticle(entry, routeSlug, folder, label));
}

/**
 * The published display name for a category ("Covenant & Identity"), or null
 * when the category has no bundle — callers fall back to humanising the slug.
 */
export async function fetchCategoryLabel(routeSlug: string): Promise<string | null> {
  return (await readManifest(folderForRoute(routeSlug)))?.category || null;
}

/** Whether a route slug is backed by a published article bundle. */
export async function isPublishedCategory(routeSlug: string): Promise<boolean> {
  return (await readManifest(folderForRoute(routeSlug))) !== null;
}

/**
 * Whether a slug is one of the five categories the nav links to.
 *
 * Answered from the configured structure alone, with no I/O: the root segment
 * asks this about every slug that reaches it, article URLs included.
 */
export function isNavCategorySlug(slug: string): boolean {
  return (CATEGORY_ROUTES as readonly string[]).includes(slug);
}

/** "torah-hebraic-insights" -> "Torah Hebraic Insights". */
function humanize(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The five nav categories, in reading order.
 *
 * Built from the category structure itself — `CATEGORY_ROUTES` names the five
 * bundles, and each one's manifest supplies the display name ("Covenant &
 * Identity"). Nothing is listed or discovered at the CDN root: object storage
 * serves no directory index, so a folder can only be found by asking for a file
 * inside it, which is exactly what reading the five manifests does.
 *
 * All five are always returned. The nav is structural — a slow CDN or a
 * momentarily missing manifest must not make a category disappear from the site
 * — so a category whose label cannot be read falls back to its humanised slug
 * and still links to its portal.
 *
 * The manifests are the same ones the portals render from and are memoised for
 * five minutes, so the nav usually costs no request at all.
 */
export async function fetchNavCategories(): Promise<NavCategory[]> {
  const labels = await Promise.all(
    CATEGORY_ROUTES.map((slug) => fetchCategoryLabel(slug).catch(() => null)),
  );
  return CATEGORY_ROUTES.map((slug, i) => ({
    slug,
    label: (labels[i] || humanize(slug)).toUpperCase(),
  }));
}

/**
 * Split a `---` frontmatter block off the top of an article.
 *
 * Only scalar `key: value` pairs are read — enough for the few fields the
 * reader needs. List and nested values are skipped rather than half-parsed, so
 * no YAML dependency is pulled in for this.
 */
function splitFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const value = pair[2].trim();
    if (!value || value.startsWith('[') || value.startsWith('{')) continue;
    data[pair[1]] = value.replace(/^["']|["']$/g, '');
  }
  return { data, body: raw.slice(match[0].length) };
}

/**
 * One article with its body, or null when the category or slug is not
 * published. The manifest is checked first so an unlisted markdown file left in
 * the folder is not readable.
 */
export async function fetchArticle(
  routeSlug: string,
  slug: string,
): Promise<SiteArticleDetail | null> {
  const folder = folderForRoute(routeSlug);
  const manifest = await readManifest(folder);
  if (!manifest) return null;

  const entry = publishedEntries(manifest).find((a) => a.slug === slug);
  if (!entry) return null;

  const raw = await readArticleFile(`${folder}/${entry.file || `${slug}.md`}`);
  if (raw === null) return null;

  const { data, body } = splitFrontmatter(raw);
  const base = toSiteArticle(entry, routeSlug, folder, manifest.category || '');
  return {
    ...base,
    title: data.title || base.title,
    author: data.author || base.author,
    summary: data.summary || '',
    content: body.trim(),
  };
}

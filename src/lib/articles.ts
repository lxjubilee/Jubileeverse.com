/**
 * Published-articles source for the five-fold category portals.
 *
 * Articles are authored as markdown and published as a per-category bundle:
 *
 *   <root>/<category>/articles.json       manifest — the authoritative list
 *   <root>/<category>/<slug>.md           article source: frontmatter + body
 *   <root>/<category>/images/<file>.jpg   generated hero image
 *
 * `<root>` is the working folder while developing and the CDN once published:
 *
 *   local      ARTICLES_LOCAL_ROOT   default J:/jubileeverse.com/articles
 *   deployed   <CDN_BASE_URL>/articles
 *
 * The local root is used when it exists and the CDN otherwise, so a checkout
 * without the drive mounted still renders published content. Pin it explicitly
 * with ARTICLES_SOURCE=local|cdn.
 *
 * The manifest is the source of truth: a category with `"articles": []` renders
 * as empty even if stray files sit beside it. Anything not listed there — and
 * anything still in the old CDN articles catalog — is not published.
 *
 * **Server-side only.** The CDN is served without CORS headers, so the browser
 * can never read these files itself: the portals are server components, and the
 * reader goes through the /article-source route.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeArticleId } from './articleId';
import { CDN_BASE_URL } from './cdn';

/** Where the article bundles live while developing. */
export const ARTICLES_LOCAL_ROOT = (
  process.env.ARTICLES_LOCAL_ROOT || 'J:/jubileeverse.com/articles'
).replace(/[\\/]+$/, '');

/** Where they live once published. */
export const ARTICLES_CDN_ROOT = `${CDN_BASE_URL}/articles`;

/** Give up rather than hanging a page render on a slow CDN. */
const FETCH_TIMEOUT_MS = 8000;

/** How long a CDN-fetched manifest stays fresh. Local reads are never cached. */
const MANIFEST_TTL_MS = 5 * 60 * 1000;

type Source = 'local' | 'cdn';

const PINNED_SOURCE: Source | null = (() => {
  const value = (process.env.ARTICLES_SOURCE || '').trim().toLowerCase();
  return value === 'local' || value === 'cdn' ? value : null;
})();

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

/**
 * Which source is in play. Memoised: the answer cannot change within a process,
 * and this is called on every portal render.
 */
let sourcePromise: Promise<Source> | null = null;
export function articlesSource(): Promise<Source> {
  if (PINNED_SOURCE) return Promise.resolve(PINNED_SOURCE);
  if (!sourcePromise) {
    sourcePromise = fs
      .access(ARTICLES_LOCAL_ROOT)
      .then(() => 'local' as const)
      .catch(() => 'cdn' as const);
  }
  return sourcePromise;
}

/** Strip leading slashes so a relative path can be joined onto either root. */
const clean = (relPath: string) => relPath.replace(/^[\\/]+/, '');

/** Absolute CDN URL for a path relative to the articles root. */
export const articlesCdnUrl = (relPath: string) => `${ARTICLES_CDN_ROOT}/${clean(relPath)}`;

/**
 * Read one file from whichever source is active. Returns null when it is
 * missing — callers degrade to an empty portal rather than throwing.
 */
export async function readArticleFile(relPath: string): Promise<string | null> {
  if ((await articlesSource()) === 'local') {
    try {
      return await fs.readFile(path.join(ARTICLES_LOCAL_ROOT, clean(relPath)), 'utf8');
    } catch {
      return null;
    }
  }

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
 * Published assets are served straight off the CDN so they keep edge caching;
 * local ones go through /article-files, since the working folder sits outside
 * the Next public directory and cannot be served statically.
 */
export async function articleAssetUrl(relPath: string): Promise<string> {
  return (await articlesSource()) === 'local'
    ? `/article-files/${clean(relPath)}`
    : articlesCdnUrl(relPath);
}

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

  // Local files are re-read every time so edits show up without a restart.
  if ((await articlesSource()) === 'cdn') {
    manifestCache.set(folder, { at: Date.now(), manifest });
  }
  return manifest;
}

/** Manifest entry -> the shape the portals render. */
async function toSiteArticle(
  entry: ManifestArticle & { slug: string; title: string },
  routeSlug: string,
  folder: string,
  categoryLabel: string,
): Promise<SiteArticle> {
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
    image: hasImage ? await articleAssetUrl(`${folder}/images/${entry.image_file}`) : null,
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
  return Promise.all(
    publishedEntries(manifest).map((entry) => toSiteArticle(entry, routeSlug, folder, label)),
  );
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
  const base = await toSiteArticle(entry, routeSlug, folder, manifest.category || '');
  return {
    ...base,
    title: data.title || base.title,
    author: data.author || base.author,
    summary: data.summary || '',
    content: body.trim(),
  };
}

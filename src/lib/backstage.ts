/**
 * Backstage — the whole article library in one place, and the read side of the
 * long-form article page.
 *
 * Ported from JubiLujah's Backstage section. The technology is what carries
 * over, not the content: JubiLujah compiles its own library into a JSON file,
 * whereas here the source is the published article bundles this site already
 * has (see @/lib/articles). Nothing from that catalog is imported.
 *
 * The reason this exists alongside the reader at /article/[id] is the shape of
 * the page. This module feeds **server components**, so an article's body is
 * rendered into the HTML on the server. The older reader is a client component
 * that fetches its body after mount, which is the part that fails when the
 * request does not land.
 *
 * Server-only: reads the filesystem through @/lib/articles. Import from Server
 * Components.
 */
import {
  CATEGORY_ROUTES,
  fetchArticle,
  fetchCategoryArticles,
  type SiteArticle,
  type SiteArticleDetail,
} from './articles';

/** One library entry, with the category it came from. */
export interface BackstagePiece extends SiteArticle {
  /** Route slug of the owning category, for links and grouping. */
  category_slug: string;
}

/** A single piece with its body, for the article page. */
export interface BackstagePieceDetail extends SiteArticleDetail {
  category_slug: string;
}

/**
 * Every published article across all five categories, newest first.
 *
 * The five reads run concurrently and each is individually degradable: a
 * category whose bundle is missing contributes nothing rather than failing the
 * page.
 */
export async function listBackstage(): Promise<BackstagePiece[]> {
  const perCategory = await Promise.all(
    CATEGORY_ROUTES.map(async (routeSlug) => {
      const articles = await fetchCategoryArticles(routeSlug);
      return articles.map((a) => ({ ...a, category_slug: routeSlug }));
    }),
  );

  return perCategory.flat().sort((a, b) => b.created.localeCompare(a.created));
}

/**
 * Resolve a bare slug to its article, searching every category.
 *
 * Slugs are unique across the library, so a flat /backstage/<slug> URL is
 * unambiguous. Categories are searched in parallel and the first hit wins;
 * null means the slug is not published anywhere.
 */
export async function getBackstagePiece(slug: string): Promise<BackstagePieceDetail | null> {
  const found = await Promise.all(
    CATEGORY_ROUTES.map(async (routeSlug) => {
      const article = await fetchArticle(routeSlug, slug);
      return article ? { ...article, category_slug: routeSlug } : null;
    }),
  );

  return found.find(Boolean) ?? null;
}

/**
 * "More from Backstage" for a given piece. Same-author pieces come first, since
 * a reader who just finished a Zev Inspire article most wants his others, then
 * the rest of the library fills up to `limit`. The piece itself is excluded.
 */
export async function relatedBackstage(slug: string, limit = 4): Promise<BackstagePiece[]> {
  const all = await listBackstage();
  const current = all.find((p) => p.slug === slug);
  const rest = all.filter((p) => p.slug !== slug);
  if (!current) return rest.slice(0, limit);

  const sameAuthor = rest.filter((p) => p.author === current.author);
  const others = rest.filter((p) => p.author !== current.author);
  return [...sameAuthor, ...others].slice(0, limit);
}

/** Every published slug, for static generation and link checking. */
export async function backstageSlugs(): Promise<string[]> {
  return (await listBackstage()).map((p) => p.slug);
}

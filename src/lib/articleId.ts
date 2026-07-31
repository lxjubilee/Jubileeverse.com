/**
 * Ids for published (markdown-authored) articles.
 *
 * An article is addressed by its category and slug, but the id has to survive
 * as a **single URL path segment**: it is interpolated into `/article/<id>` and
 * into the backend's `/api/articles/<id>/translate`, so a `/` would silently
 * shift those routes by a segment and 404. Hence a `__` separator, which the
 * kebab-case slugs on both sides never contain.
 *
 * Kept free of Node imports so client components can parse an id without
 * pulling the filesystem-backed @/lib/articles into the browser bundle.
 */

const SEPARATOR = '__';

/** Slug shape on both sides of the separator. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/** The id for one published article. */
export function makeArticleId(categorySlug: string, slug: string): string {
  return `${categorySlug}${SEPARATOR}${slug}`;
}

/**
 * Split an id back into its parts, or null when it is not one of ours — a
 * numeric current-event id or a UUID falls through to the backend endpoints.
 */
export function parseArticleId(id: string): { categorySlug: string; slug: string } | null {
  const parts = String(id ?? '').split(SEPARATOR);
  if (parts.length !== 2) return null;
  const [categorySlug, slug] = parts;
  if (!SLUG.test(categorySlug) || !SLUG.test(slug)) return null;
  return { categorySlug, slug };
}

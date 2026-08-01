/**
 * Article hand-off + view tracking helpers.
 *
 * Cards across the site stash the selected story under sessionStorage
 * ["selectedArticle"] and navigate to /article/[id]; the article page reads it
 * for an instant render and falls back to fetching by id. This mirrors
 * openCurrentEventArticle() from the original index.html.
 */
import { parseArticleId } from './articleId';
import type { Story } from './types';

/**
 * Which published article an admin image regeneration should act on.
 *
 * Only the two CDN-published kinds can be regenerated: their images and
 * manifests live in storage the site controls. A legacy numeric PostgreSQL id
 * has no CDN image to replace, so it resolves to null and the button stays off
 * the page.
 */
export interface RegenTarget {
  kind: 'news' | 'category';
  slug: string;
  categorySlug?: string;
  date?: string;
}

/** The regeneration target for an article id, or null when it has none. */
export function regenTargetFor(
  id: string | number | undefined,
  date?: string,
): RegenTarget | null {
  const raw = String(id ?? '');
  if (!raw) return null;

  // `<category>__<slug>` is a published bundle article.
  const published = parseArticleId(raw);
  if (published) {
    return { kind: 'category', slug: published.slug, categorySlug: published.categorySlug };
  }

  // A slug plus the day it was published is CDN news — the same pair that
  // makes storyHref() route it to the site root.
  if (date && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(raw)) {
    return { kind: 'news', slug: raw, date };
  }
  return null;
}

/** The regeneration target for a feed story, or null. */
export function regenTargetOf(story: Pick<Story, 'id' | 'slug' | 'date'>): RegenTarget | null {
  return regenTargetFor(story.slug || story.id, story.date);
}

/**
 * Where a story is read.
 *
 * CDN news articles live at the root, /<slug> — a real, server-rendered,
 * deep-linkable page, resolved by the root segment alongside the category
 * portals. Sending them to /article/<id> would break twice over: the id is a
 * slug, and /article treats a `a__b` id as `<category>__<slug>`, so a news id
 * would resolve to a five-fold category bundle that does not exist.
 *
 * Everything else keeps the existing /article/<id> behaviour.
 *
 * This is the single place article URLs are built — the home page, hero
 * carousel, cards, search results and related lists all route through it — so
 * the shape only ever has to change here.
 */
export function storyHref(story: Pick<Story, 'id' | 'slug' | 'date'>): string {
  if (story.slug && story.date) return `/${story.slug}`;
  return `/article/${story.id}`;
}

/**
 * The id to use for reactions and view tracking.
 *
 * `article_reactions.article_id` and `article_views.article_id` are INTEGER, so
 * a slug cannot be stored there; CDN news carries a stable hashed integer in
 * `reaction_id` instead.
 */
export function trackingIdOf(story: Pick<Story, 'id' | 'reaction_id'>): string | number {
  return story.reaction_id ?? story.id;
}

export interface SelectedArticle {
  id: string | number;
  rewrittenTitle: string;
  rewrittenContent: string;
  downloadedImage: string | null;
  imageUrl: string | null;
  storyCluster: string;
  category: string;
  sourceName: string;
  originalUrl: string;
  originalTitle: string;
  timestamp: number;
  isCurrentEvent: boolean;
  categoryId: number | null;
  /** Positive, faith-based Christian commentary for this article (from faith_reflection). */
  faithCommentary: string;
}

export function storeSelectedArticle(story: Story): SelectedArticle {
  const article: SelectedArticle = {
    id: story.id,
    rewrittenTitle: story.headline || story.title || '',
    rewrittenContent: story.full_article || story.excerpt || '',
    downloadedImage: story.cached_image_path || null,
    imageUrl: story.image_url || null,
    storyCluster: story.topic || '',
    category: story.topic || story.category || '',
    sourceName: story.source_name || '',
    originalUrl: story.source_url || '',
    originalTitle: story.headline || story.title || '',
    timestamp: story.pub_date ? new Date(story.pub_date).getTime() : Date.now(),
    isCurrentEvent: story.isCurrentEvent ?? true,
    categoryId: (story.category_id as number) ?? null,
    faithCommentary: story.faith_reflection || '',
  };
  try {
    sessionStorage.setItem('selectedArticle', JSON.stringify(article));
  } catch {
    /* ignore quota errors */
  }
  return article;
}

export function readSelectedArticle(): SelectedArticle | null {
  try {
    const raw = sessionStorage.getItem('selectedArticle');
    return raw ? (JSON.parse(raw) as SelectedArticle) : null;
  } catch {
    return null;
  }
}

function getSessionId(): string {
  let sid = sessionStorage.getItem('_jv_sid');
  if (!sid) {
    sid = 'sid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    sessionStorage.setItem('_jv_sid', sid);
  }
  return sid;
}

/**
 * Fire-and-forget article view/click tracking (matches /api/track/view).
 *
 * `article_views.article_id` is an INTEGER column, but taxonomy-portal articles
 * come from `jv_content_objects` and carry UUID ids. Posting one makes Postgres
 * raise 22P02 inside an unguarded `await` in the route, which takes the whole
 * Express process down — so skip tracking for ids the table cannot store.
 */
export function trackView(
  articleId: string | number,
  eventType: 'click' | 'view' = 'click',
  articleType = 'current_event',
): void {
  if (!/^\d+$/.test(String(articleId))) return;
  try {
    fetch('/api/track/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id: articleId,
        article_type: articleType,
        event_type: eventType,
        session_id: getSessionId(),
      }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

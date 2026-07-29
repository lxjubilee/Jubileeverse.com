/**
 * Article hand-off + view tracking helpers.
 *
 * Cards across the site stash the selected story under sessionStorage
 * ["selectedArticle"] and navigate to /article/[id]; the article page reads it
 * for an instant render and falls back to fetching by id. This mirrors
 * openCurrentEventArticle() from the original index.html.
 */
import type { Story } from './types';

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

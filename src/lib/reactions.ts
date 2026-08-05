/**
 * Reactions client — matches the unchanged Express contract exactly:
 *   POST /api/reactions            { article_id, article_type, reaction_type:'like'|'dislike' }  (Bearer required)
 *                                  -> { success, reaction:'like'|'dislike'|null, counts:{likes,dislikes} }
 *   GET  /api/reactions/counts?ids=ce:1,a:2   -> { success, counts:{ "ce:1":{likes,dislikes} } }
 *   GET  /api/reactions/user?ids=...          -> { success, reactions:{ "ce:1":"like" } }
 *
 * Keys are `<prefix>:<id>`; prefixes map to article types (ce=current_event, a=article, …).
 */
import { api } from './api';
import type { Story } from './types';

export type ReactionType = 'like' | 'dislike';

export interface ReactionCounts {
  likes: number;
  dislikes: number;
}

/** Article-type → key prefix (mirrors the backend prefix map). */
const TYPE_TO_PREFIX: Record<string, string> = {
  current_event: 'ce',
  article: 'a',
  content: 'enc',
  devotional: 'dev',
  music: 'mus',
  radio: 'rad',
  prayer: 'pra',
};

export function articleTypeOf(story: Pick<Story, 'isCurrentEvent'>): 'current_event' | 'article' {
  return story.isCurrentEvent === false ? 'article' : 'current_event';
}

export function reactionKey(id: string | number, articleType: string): string {
  return `${TYPE_TO_PREFIX[articleType] || 'a'}:${id}`;
}

export async function fetchCounts(keys: string[]): Promise<Record<string, ReactionCounts>> {
  if (keys.length === 0) return {};
  const data = await api.get<{ success: boolean; counts: Record<string, ReactionCounts> }>(
    `/api/reactions/counts?ids=${encodeURIComponent(keys.join(','))}`,
    { auth: false },
  );
  return data.counts || {};
}

export async function fetchUserReactions(keys: string[]): Promise<Record<string, ReactionType>> {
  if (keys.length === 0) return {};
  const data = await api.get<{ success: boolean; reactions: Record<string, ReactionType> }>(
    `/api/reactions/user?ids=${encodeURIComponent(keys.join(','))}`,
  );
  return data.reactions || {};
}

export async function postReaction(
  articleId: string | number,
  articleType: 'current_event' | 'article',
  reactionType: ReactionType,
): Promise<{ reaction: ReactionType | null; counts: ReactionCounts }> {
  const data = await api.post<{ reaction: ReactionType | null; counts: ReactionCounts }>(
    '/api/reactions',
    { article_id: articleId, article_type: articleType, reaction_type: reactionType },
  );
  return { reaction: data.reaction, counts: data.counts || { likes: 0, dislikes: 0 } };
}

/* ---------------------------------------------------------------------------
 * Slug-keyed reactions (jv_article_slug_reactions).
 *
 * The endpoints above key on an INTEGER article_id, which CDN news articles do
 * not have — the feed hashes each slug into a synthetic integer purely to have
 * something to send. The endpoints below store the slug itself, which is what
 * the site already routes on, so a reaction can be read back and understood.
 *
 *   POST /api/reactions/slug              { slug, reaction }   (Bearer required)
 *                                         -> { success, reaction, counts }
 *   GET  /api/reactions/slug/counts?slugs=a,b   -> { success, counts:{ slug:{likes,dislikes} } }
 *   GET  /api/reactions/slug/user?slugs=a,b     -> { success, reactions:{ slug:'like' } }
 * ------------------------------------------------------------------------- */

/**
 * The identifier a reaction is stored against.
 *
 * News articles carry a real `slug`. The published category articles do not, but
 * their `id` is already `<category>__<slug>` — unique, stable and the same shape
 * — so it serves as the slug for them. Both are accepted by the backend's slug
 * pattern, which allows the double underscore.
 */
export function reactionSlugOf(story: Pick<Story, 'slug' | 'id'>): string {
  return story.slug || String(story.id ?? '');
}

/** Public like/dislike totals for a page of cards. */
export async function fetchSlugCounts(
  slugs: string[],
): Promise<Record<string, ReactionCounts>> {
  if (slugs.length === 0) return {};
  const data = await api.get<{ success: boolean; counts: Record<string, ReactionCounts> }>(
    `/api/reactions/slug/counts?slugs=${encodeURIComponent(slugs.join(','))}`,
    { auth: false },
  );
  return data.counts || {};
}

/**
 * The signed-in reader's own reactions. Slugs they have not reacted to are
 * absent from the map rather than present as null.
 */
export async function fetchUserSlugReactions(
  slugs: string[],
): Promise<Record<string, ReactionType>> {
  if (slugs.length === 0) return {};
  const data = await api.get<{ success: boolean; reactions: Record<string, ReactionType> }>(
    `/api/reactions/slug/user?slugs=${encodeURIComponent(slugs.join(','))}`,
  );
  return data.reactions || {};
}

/**
 * Set this reader's reaction to one article. Pressing the reaction they already
 * hold withdraws it, and the response comes back with `reaction: null`.
 */
export async function postSlugReaction(
  slug: string,
  reaction: ReactionType,
): Promise<{ reaction: ReactionType | null; counts: ReactionCounts }> {
  const data = await api.post<{ reaction: ReactionType | null; counts: ReactionCounts }>(
    '/api/reactions/slug',
    { slug, reaction },
  );
  return { reaction: data.reaction, counts: data.counts || { likes: 0, dislikes: 0 } };
}

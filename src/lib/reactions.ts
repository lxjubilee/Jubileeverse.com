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

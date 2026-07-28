'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  fetchCounts,
  fetchUserReactions,
  postReaction,
  reactionKey,
  type ReactionCounts,
  type ReactionType,
} from '@/lib/reactions';

interface Props {
  articleId: string | number;
  articleType?: 'current_event' | 'article';
}

/**
 * Like / dislike bar backed by /api/reactions (like|dislike only, Bearer
 * required). Posting requires sign-in; unauthenticated clicks route to /signin.
 */
export default function ReactionBar({ articleId, articleType = 'current_event' }: Props) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const key = reactionKey(articleId, articleType);
  const [counts, setCounts] = useState<ReactionCounts>({ likes: 0, dislikes: 0 });
  const [mine, setMine] = useState<ReactionType | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await fetchCounts([key]);
        if (!cancelled) setCounts(c[key] || { likes: 0, dislikes: 0 });
      } catch {
        /* ignore */
      }
      if (isAuthenticated) {
        try {
          const r = await fetchUserReactions([key]);
          if (!cancelled) setMine(r[key] || null);
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, isAuthenticated]);

  const react = async (reaction: ReactionType) => {
    if (!isAuthenticated) {
      router.push(`/signin?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    try {
      const res = await postReaction(articleId, articleType, reaction);
      setCounts(res.counts);
      setMine(res.reaction);
    } catch {
      /* best-effort */
    }
  };

  return (
    <div className="content-card-reactions" style={{ gap: 24, marginTop: 24 }}>
      <button
        className={`reaction-btn like-btn${mine === 'like' ? ' active' : ''}`}
        onClick={() => react('like')}
        aria-pressed={mine === 'like'}
      >
        <svg viewBox="0 0 24 24">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
        <span className="reaction-count">{counts.likes || 0}</span>
      </button>
      <button
        className={`reaction-btn dislike-btn${mine === 'dislike' ? ' active' : ''}`}
        onClick={() => react('dislike')}
        aria-pressed={mine === 'dislike'}
      >
        <svg viewBox="0 0 24 24">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
        </svg>
        <span className="reaction-count">{counts.dislikes || 0}</span>
      </button>
    </div>
  );
}

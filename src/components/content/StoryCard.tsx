'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import RegenerateImageButton from '@/components/admin/RegenerateImageButton';
import { handleImgError, resolveImageUrl } from '@/lib/api';
import { storeSelectedArticle, trackView, storyHref, trackingIdOf, regenTargetOf } from '@/lib/article';
import { useAuth } from '@/lib/auth';
import { postReaction, type ReactionCounts, type ReactionType } from '@/lib/reactions';
import type { Story } from '@/lib/types';

interface Props {
  story: Story;
  /** Optional label shown above the title (defaults to the topic). */
  category?: string;
  /** Opt-in like/dislike footer. Defaults to false so other pages are unaffected. */
  showReactions?: boolean;
  /** Seed counts (from a batched fetchCounts on the parent). */
  initialCounts?: ReactionCounts;
  /** The signed-in user's existing reaction (from a batched fetchUserReactions). */
  initialMine?: ReactionType | null;
  /** Which backend reaction namespace this story belongs to. */
  articleType?: 'current_event' | 'article';
  /** Opt-in hide (✕) + "more" menu (follow/block/share). Default false. */
  showActions?: boolean;
  /** Called when the reader hides this story. */
  onHide?: (id: string | number) => void;
  /** Where the card links. Defaults to `/article/<id>`. */
  href?: string;
}

const PREFS_KEY = 'jubileeVersePrefs';
const PREFS_CHANGED_EVENT = 'jubilee:prefs-changed';

/** Add a topic slug to following/blocked in localStorage["jubileeVersePrefs"]. */
function updatePrefs(kind: 'follow' | 'block', slug: string) {
  if (!slug) return;
  try {
    const data = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    const following = new Set<string>(Array.isArray(data.following) ? data.following : []);
    const blocked = new Set<string>(Array.isArray(data.blocked) ? data.blocked : []);
    if (kind === 'follow') {
      following.add(slug);
      blocked.delete(slug);
    } else {
      blocked.add(slug);
      following.delete(slug);
    }
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ following: [...following], blocked: [...blocked] }),
    );
    window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Standard content card used in feeds/grids. Clicking stashes the story and
 * navigates to the article (by default /article/[id]).
 *
 * Pass `href` when the story lives somewhere else — CDN news articles are read
 * at the root, /<slug>, and routing them to /article/[id] would misfire, since
 * a news id parses as a category slug there.
 *
 * When `showReactions` is true it renders a like/dislike footer wired to
 * /api/reactions. Reaction clicks stop propagation so they never open the
 * article; posting requires sign-in (otherwise routes to /signin).
 */
export default function StoryCard({
  story,
  category,
  showReactions = false,
  initialCounts,
  initialMine = null,
  articleType = 'current_event',
  showActions = false,
  onHide,
  href,
}: Props) {
  const router = useRouter();
  const target = href ?? storyHref(story);
  // Reactions and views are stored against an INTEGER article_id, so a slug id
  // cannot be used directly. CDN news supplies a stable hashed integer.
  const trackingId = trackingIdOf(story);
  const { isAuthenticated } = useAuth();
  // An admin regeneration swaps the picture in place; until then this is the
  // published one exactly as before.
  const [freshImg, setFreshImg] = useState<string | null>(null);
  const img = freshImg ?? resolveImageUrl(story);
  const title = story.headline || story.title || '';
  const label = category || story.topic || story.category || '';
  const slug = (story.topic || story.category || '').toLowerCase();

  const [counts, setCounts] = useState<ReactionCounts>(
    initialCounts || { likes: 0, dislikes: 0 },
  );
  const [mine, setMine] = useState<ReactionType | null>(initialMine);
  const [menuOpen, setMenuOpen] = useState(false);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const hide = (e: React.MouseEvent) => {
    e.stopPropagation();
    onHide?.(story.id);
  };

  const share = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    const url = `${window.location.origin}${target}`;
    if (navigator.share) navigator.share({ url, title }).catch(() => {});
    else navigator.clipboard?.writeText(url).catch(() => {});
  };

  const open = () => {
    storeSelectedArticle(story);
    trackView(trackingId);
    router.push(target);
  };

  const react = async (e: React.MouseEvent, reaction: ReactionType) => {
    // Never open the article when the reaction control is clicked.
    e.stopPropagation();
    if (!isAuthenticated) {
      router.push('/signin');
      return;
    }
    try {
      const res = await postReaction(trackingId, articleType, reaction);
      setCounts(res.counts);
      setMine(res.reaction);
    } catch {
      /* best-effort */
    }
  };

  return (
    <article className="content-card" onClick={open}>
      {showActions ? (
        <div className="content-card-actions" onClick={stop}>
          <button
            type="button"
            className="content-card-action"
            onClick={hide}
            title="Hide this story"
            aria-label="Hide this story"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <div className="content-card-menu-wrap">
            <button
              type="button"
              className="content-card-action"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="More"
              aria-label="More options"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            {menuOpen ? (
              <div className="content-card-menu" onClick={stop}>
                <button type="button" onClick={(e) => { stop(e); setMenuOpen(false); updatePrefs('follow', slug); }}>
                  Follow {label || 'topic'}
                </button>
                <button type="button" onClick={(e) => { stop(e); setMenuOpen(false); updatePrefs('block', slug); onHide?.(story.id); }}>
                  Block {label || 'topic'}
                </button>
                <button type="button" onClick={share}>Share</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="content-card-image">
        <RegenerateImageButton target={regenTargetOf(story)} onRegenerated={setFreshImg} />
        {img ? (
          <img src={img} alt={title} loading="lazy" onError={handleImgError} />
        ) : (
          <div className="content-card-image-placeholder" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>
      <div className="content-card-body">
        {label ? <span className="content-card-category">{label}</span> : null}
        <h3 className="content-card-title">{title}</h3>
        <div className="content-card-meta">
          {story.source_name ? <span>{story.source_name}</span> : null}
        </div>
        {showReactions ? (
          <div className="content-card-reactions">
            <button
              type="button"
              className={`reaction-btn like-btn${mine === 'like' ? ' active' : ''}`}
              onClick={(e) => react(e, 'like')}
              aria-pressed={mine === 'like'}
              aria-label="Like"
            >
              <svg viewBox="0 0 24 24">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
              </svg>
              <span className="reaction-count">{counts.likes || 0}</span>
            </button>
            <button
              type="button"
              className={`reaction-btn dislike-btn${mine === 'dislike' ? ' active' : ''}`}
              onClick={(e) => react(e, 'dislike')}
              aria-pressed={mine === 'dislike'}
              aria-label="Dislike"
            >
              <svg viewBox="0 0 24 24">
                <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
              </svg>
              <span className="reaction-count">{counts.dislikes || 0}</span>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

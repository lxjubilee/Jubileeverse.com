'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import RegenerateImageButton from '@/components/admin/RegenerateImageButton';
import { handleImgError, resolveImageUrl } from '@/lib/api';
import {
  storeSelectedArticle, trackView, storyHref, trackingIdOf, regenTargetOf, canRegenerateImage,
} from '@/lib/article';
import { useAuth } from '@/lib/auth';
import {
  onPrefsChanged,
  readPrefs,
  setTopicPref,
  topicSlugOf,
} from '@/lib/feedPrefs';
import {
  postSlugReaction,
  reactionSlugOf,
  type ReactionCounts,
  type ReactionType,
} from '@/lib/reactions';
import type { Story } from '@/lib/types';

interface Props {
  story: Story;
  /** Optional label shown above the title (defaults to the topic). */
  category?: string;
  /** Opt-in like/dislike footer. Defaults to false so other pages are unaffected. */
  showReactions?: boolean;
  /** Seed counts, keyed by slug, from a batched fetchSlugCounts on the parent. */
  initialCounts?: ReactionCounts;
  /** The signed-in reader's stored reaction (batched fetchUserSlugReactions). */
  initialMine?: ReactionType | null;
  /** Opt-in hide (✕) + "more" menu (follow/block/share). Default false. */
  showActions?: boolean;
  /** Called when the reader hides this story. */
  onHide?: (id: string | number) => void;
  /** Where the card links. Defaults to `/article/<id>`. */
  href?: string;
  /** Admin-only regenerate-image control on the thumbnail. Default true. */
  showRegenerate?: boolean;
  /**
   * Extra class on the card root, alongside `content-card`. The home feed uses
   * it to mark the featured cards it renders at double width.
   */
  className?: string;
}

/** How long the ⋯ menu's confirmation line stays on the card. */
const FLASH_MS = 2200;

/**
 * Standard content card used in feeds/grids. Clicking stashes the story and
 * navigates to the article (by default /article/[id]).
 *
 * Pass `href` when the story lives somewhere else — CDN news articles are read
 * at the root, /<slug>, and routing them to /article/[id] would misfire, since
 * a news id parses as a category slug there.
 *
 * When `showReactions` is true it renders a like/dislike footer wired to
 * /api/reactions/slug, which stores the reaction against the reader and the
 * article's slug. Reaction clicks stop propagation so they never open the
 * article; posting requires sign-in (otherwise routes to /signin).
 */
export default function StoryCard({
  story,
  category,
  showReactions = false,
  initialCounts,
  initialMine = null,
  showActions = false,
  onHide,
  href,
  showRegenerate = true,
  className,
}: Props) {
  const router = useRouter();
  const target = href ?? storyHref(story);
  // Views are stored against an INTEGER article_id, so a slug id cannot be used
  // directly there; CDN news supplies a stable hashed integer for that path.
  const trackingId = trackingIdOf(story);
  // Reactions, by contrast, are keyed by the article's own slug — see
  // reactionSlugOf. Named apart from `slug` below, which is the TOPIC slug used
  // by follow/block.
  const reactionSlug = reactionSlugOf(story);
  const { isAuthenticated } = useAuth();
  // An admin regeneration swaps the picture in place; until then this is the
  // published one exactly as before.
  const [freshImg, setFreshImg] = useState<string | null>(null);

  // `canRegenerateImage` excludes news: its picture comes from the originating
  // outlet, so there is nothing to regenerate. `showRegenerate` remains an
  // additional per-surface opt-out.
  const regenTarget = regenTargetOf(story);
  const canRegenerate = showRegenerate && canRegenerateImage(regenTarget);
  const img = freshImg ?? resolveImageUrl(story);
  const title = story.headline || story.title || '';
  const label = category || story.topic || story.category || '';
  const slug = topicSlugOf(story);

  const [counts, setCounts] = useState<ReactionCounts>(
    initialCounts || { likes: 0, dislikes: 0 },
  );
  const [mine, setMine] = useState<ReactionType | null>(initialMine);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Short confirmation shown on the card — following a topic is otherwise invisible. */
  const [flash, setFlash] = useState('');
  /** Whether this card's topic is currently followed, so the menu can say so. */
  const [isFollowing, setIsFollowing] = useState(false);

  // Reflect the stored preference in the menu, and keep it right when the
  // Personalize popup or another card changes the same topic.
  useEffect(() => {
    if (!slug) return;
    const sync = () =>
      setIsFollowing(readPrefs().following.some((s) => s.toLowerCase() === slug));
    sync();
    return onPrefsChanged(sync);
  }, [slug]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  // The parent fetches counts and the reader's stored reaction in one batch for
  // the whole grid, so both arrive AFTER the cards have first rendered. Seeding
  // useState alone would freeze every card at zero with no reaction showing —
  // the initial value is only read on mount. Re-running on identity means a
  // reader's own click is not overwritten by a re-render carrying the same
  // props.
  useEffect(() => {
    if (initialCounts) setCounts(initialCounts);
  }, [initialCounts]);

  useEffect(() => {
    setMine(initialMine);
  }, [initialMine]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const hide = (e: React.MouseEvent) => {
    e.stopPropagation();
    onHide?.(story.id);
  };

  const topicName = label || 'topic';

  /** Follow is a toggle: tapping it while already following clears the choice. */
  const follow = (e: React.MouseEvent) => {
    stop(e);
    setMenuOpen(false);
    if (!slug) return;
    if (isFollowing) {
      setTopicPref('clear', slug);
      setFlash(`Unfollowed ${topicName}`);
    } else {
      setTopicPref('follow', slug);
      setFlash(`Following ${topicName}`);
    }
  };

  const block = (e: React.MouseEvent) => {
    stop(e);
    setMenuOpen(false);
    if (slug) setTopicPref('block', slug);
    onHide?.(story.id);
  };

  /**
   * Share, and say so. Every outcome used to be swallowed: on desktop the
   * clipboard fallback usually runs and gave the reader nothing to indicate it
   * had worked, and on an insecure origin neither API exists so the button did
   * nothing at all, silently.
   */
  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    const url = `${window.location.origin}${target}`;
    try {
      if (navigator.share) {
        await navigator.share({ url, title });
        return; // The OS sheet is its own confirmation.
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setFlash('Link copied');
        return;
      }
      setFlash('Sharing unavailable');
    } catch (err) {
      // Dismissing the OS share sheet is a cancellation, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setFlash('Could not share');
    }
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
    if (!reactionSlug) return;
    try {
      const res = await postSlugReaction(reactionSlug, reaction);
      setCounts(res.counts);
      // null when the reader pressed the reaction they already held, which
      // withdraws it.
      setMine(res.reaction);
    } catch {
      /* best-effort */
    }
  };

  return (
    <article className={`content-card${className ? ` ${className}` : ''}`} onClick={open}>
      {flash ? (
        <div className="content-card-flash" role="status" aria-live="polite">
          {flash}
        </div>
      ) : null}
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
                <button type="button" onClick={follow} aria-pressed={isFollowing}>
                  {isFollowing ? `✓ Following ${topicName}` : `Follow ${topicName}`}
                </button>
                <button type="button" onClick={block}>
                  Block {topicName}
                </button>
                <button type="button" onClick={share}>Share</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="content-card-image">
        {canRegenerate ? (
          <RegenerateImageButton target={regenTarget} onRegenerated={setFreshImg} />
        ) : null}
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

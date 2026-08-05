'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useTaxonomyNav } from '@/hooks/useTaxonomyNav';
import { readPrefs, writePrefs } from '@/lib/feedPrefs';
import styles from './PersonalizePopup.module.css';

/**
 * Re-exported for existing importers. The definition lives in @/lib/feedPrefs,
 * with the storage key and the slug derivation it has to agree with.
 */
export { PREFS_CHANGED_EVENT } from '@/lib/feedPrefs';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Feed personalization. For each taxonomy topic the reader can choose to follow
 * it (surface first) and/or block it (hide from the feed). The selection
 * persists to localStorage["jubileeVersePrefs"] as
 * `{ following: string[], blocked: string[] }` (slugs) — the same key/shape the
 * home feed reads. Saving dispatches a window event so an open home page picks
 * up the change without a reload.
 */
export default function PersonalizePopup({ open, onClose }: Props) {
  const taxonomyLinks = useTaxonomyNav();
  const [following, setFollowing] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  /**
   * Customized topics that are not in the nav list, captured once when the
   * popup opens. Deriving this from `following`/`blocked` as they change would
   * make a row disappear the moment the reader cleared it — exactly when they
   * are still looking at it.
   */
  const [customized, setCustomized] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const prefs = readPrefs();
    setFollowing(prefs.following);
    setBlocked(prefs.blocked);
    setCustomized([...new Set([...prefs.following, ...prefs.blocked])].filter(Boolean).sort());
  }, [open]);

  const toggleFollow = (slug: string) => {
    setFollowing((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
    // Following and blocking a topic are mutually exclusive.
    setBlocked((prev) => prev.filter((s) => s !== slug));
  };

  const toggleBlock = (slug: string) => {
    setBlocked((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
    setFollowing((prev) => prev.filter((s) => s !== slug));
  };

  const save = () => {
    writePrefs({ following, blocked });
    onClose();
  };

  /**
   * Topics the reader has customized that this list would not otherwise show.
   *
   * The list above is the five-fold ministry nav, but the ⋯ menu on a news card
   * follows and blocks by the story's own topic (finance, technology, health …)
   * — a vocabulary with no overlap. Blocking one from a card therefore removed
   * every card carrying it, leaving nothing to click to undo, and no entry here
   * either: a one-way door. Surfacing them keeps every choice reversible.
   */
  const known = new Set(taxonomyLinks.map((l) => l.slug));
  const extraSlugs = customized.filter((s) => !known.has(s));

  return (
    <Modal
      open={open}
      title="Personalize your feed"
      onClose={onClose}
      footer={
        <>
          <button className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.btnPrimary} onClick={save}>
            Save preferences
          </button>
        </>
      }
    >
      <p className={styles.help}>
        Follow the topics you want surfaced first, and block the ones you would rather not see.
      </p>
      <div className={styles.list}>
        {taxonomyLinks.length === 0 ? (
          <p className={styles.empty}>Topics are loading…</p>
        ) : (
          taxonomyLinks.map((link) => {
            const isFollowed = following.includes(link.slug);
            const isBlocked = blocked.includes(link.slug);
            return (
              <div key={link.id} className={styles.row}>
                <span className={styles.rowLabel}>{link.label}</span>
                <div className={styles.toggles}>
                  <button
                    type="button"
                    className={`${styles.toggle} ${isFollowed ? styles.toggleFollowActive : ''}`}
                    aria-pressed={isFollowed}
                    onClick={() => toggleFollow(link.slug)}
                  >
                    {isFollowed ? 'Following' : 'Follow'}
                  </button>
                  <button
                    type="button"
                    className={`${styles.toggle} ${isBlocked ? styles.toggleBlockActive : ''}`}
                    aria-pressed={isBlocked}
                    onClick={() => toggleBlock(link.slug)}
                  >
                    {isBlocked ? 'Blocked' : 'Block'}
                  </button>
                </div>
              </div>
            );
          })
        )}

        {extraSlugs.length > 0 ? (
          <>
            <p className={styles.help} style={{ marginTop: 14 }}>
              Other topics you have chosen from a story&rsquo;s ⋯ menu.
            </p>
            {extraSlugs.map((slug) => {
              const isFollowed = following.includes(slug);
              const isBlocked = blocked.includes(slug);
              return (
                <div key={slug} className={styles.row}>
                  <span className={styles.rowLabel}>{humanize(slug)}</span>
                  <div className={styles.toggles}>
                    <button
                      type="button"
                      className={`${styles.toggle} ${isFollowed ? styles.toggleFollowActive : ''}`}
                      aria-pressed={isFollowed}
                      onClick={() => toggleFollow(slug)}
                    >
                      {isFollowed ? 'Following' : 'Follow'}
                    </button>
                    <button
                      type="button"
                      className={`${styles.toggle} ${isBlocked ? styles.toggleBlockActive : ''}`}
                      aria-pressed={isBlocked}
                      onClick={() => toggleBlock(slug)}
                    >
                      {isBlocked ? 'Blocked' : 'Block'}
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/** `church-us` -> `Church Us`. Only a fallback label for slugs with no nav entry. */
function humanize(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

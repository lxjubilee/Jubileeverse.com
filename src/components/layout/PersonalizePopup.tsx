'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useTaxonomyNav } from '@/hooks/useTaxonomyNav';
import styles from './PersonalizePopup.module.css';

const PREFS_KEY = 'jubileeVersePrefs';
/** Same-tab signal so the home feed can re-read prefs when the popup saves. */
export const PREFS_CHANGED_EVENT = 'jubilee:prefs-changed';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FeedPrefs {
  following: string[];
  blocked: string[];
}

function readPrefs(): FeedPrefs {
  try {
    const data = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      following: Array.isArray(data.following) ? data.following : [],
      blocked: Array.isArray(data.blocked) ? data.blocked : [],
    };
  } catch {
    return { following: [], blocked: [] };
  }
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

  useEffect(() => {
    if (!open) return;
    const prefs = readPrefs();
    setFollowing(prefs.following);
    setBlocked(prefs.blocked);
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
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ following, blocked, ts: Date.now() }),
      );
      window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT));
    } catch {
      /* ignore — storage may be unavailable */
    }
    onClose();
  };

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
      </div>
    </Modal>
  );
}

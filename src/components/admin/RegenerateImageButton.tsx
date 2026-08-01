'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import type { RegenTarget } from '@/lib/article';
import { useAuth } from '@/lib/auth';
import styles from './RegenerateImageButton.module.css';

interface Props {
  target: RegenTarget | null;
  /** Called with the new image URL once the CDN has it. */
  onRegenerated?: (url: string) => void;
  /** Nudges the overlay clear of another control in the same corner. */
  offset?: boolean;
}

/**
 * Admin-only "regenerate this image" overlay.
 *
 * Sits in the top-left of an article's featured image and re-renders it when the
 * generated one has visible defects — six fingers, two heads, a distorted face.
 * Hidden for everyone else: the check here keeps it off the page, and the
 * endpoint requires an admin role of its own accord, so a crafted request from
 * a signed-in reader is refused by the server too.
 *
 * One request at a time per button, and the server holds its own per-article
 * lock, so a double click cannot start two renders of the same article.
 */
/**
 * Regeneration renders three candidates, scores each structurally, and has a
 * vision model rank them, retrying with a new composition if none pass. That is
 * one to three minutes of real work, so the button says so rather than leaving
 * the admin wondering whether the click registered.
 */
const BUSY_TITLE = 'Regenerating image — this takes 1-3 minutes…';

export default function RegenerateImageButton({ target, onRegenerated, offset = false }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  if (user?.role !== 'admin' || !target) return null;

  const regenerate = async (e: React.MouseEvent) => {
    // The overlay sits on a card that navigates when clicked.
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setNote(null);
    try {
      const data = await api.post<{ url: string; safety: string }>(
        '/api/admin/regenerate-image',
        target,
      );
      onRegenerated?.(data.url);
      setNote({ text: data.safety === 'unscanned' ? 'New image (unscanned)' : 'New image ready', ok: true });
      // The manifest changed, so every server-rendered listing of this article
      // — home, category portals, the reader — should pick the new URL up.
      router.refresh();
    } catch (err) {
      // ApiError's `message` is the response's machine-readable `error` field;
      // the sentence meant for a person rides alongside it in `message`.
      const body = err instanceof ApiError ? (err.body as { message?: string } | null) : null;
      const text = body?.message || (err instanceof Error ? err.message : '') || 'Regeneration failed';
      setNote({ text: text.slice(0, 110), ok: false });
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 6000);
    }
  };

  return (
    <div className={`${styles.wrap}${offset ? ` ${styles.offset}` : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={styles.button}
        onClick={regenerate}
        disabled={busy}
        title={busy ? BUSY_TITLE : 'Regenerate image (Admin)'}
        aria-label="Regenerate image"
        aria-busy={busy}
      >
        {busy ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-4.59" />
          </svg>
        )}
      </button>
      {note ? (
        <span className={`${styles.note} ${note.ok ? styles.ok : styles.bad}`} role="status">
          {note.text}
        </span>
      ) : null}
    </div>
  );
}

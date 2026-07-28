'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Props {
  articleId: string | number;
  isCurrentEvent: boolean;
  onRewritten?: (content: string) => void;
}

const btn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(0,0,0,0.65)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

/**
 * Reviewer-only inline tools on the article hero: delete (current events),
 * regenerate image, rewrite article. Visible only when the signed-in user's
 * role is 'reviewer' (the backend enforces the same via requireReviewer).
 */
export default function ReviewerTools({ articleId, isCurrentEvent, onRewritten }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  if (user?.role !== 'reviewer') return null;

  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(''), 2500);
  };

  const del = async () => {
    if (!confirm('Delete this article? This cannot be undone.')) return;
    setBusy('delete');
    try {
      await api.delete(`/api/current-events/${articleId}`);
      router.push('/');
    } catch {
      flash('Delete failed');
      setBusy('');
    }
  };

  const regen = async () => {
    setBusy('regen');
    try {
      const path = isCurrentEvent
        ? `/api/current-events/${articleId}/regenerate-image`
        : `/api/articles/${articleId}/regenerate-image`;
      await api.post(path);
      flash('Image regeneration queued');
    } catch {
      flash('Regeneration failed');
    } finally {
      setBusy('');
    }
  };

  const rewrite = async () => {
    setBusy('rewrite');
    try {
      const data = await api.post<{ full_article?: string }>(
        `/api/current-events/${articleId}/rewrite-article`,
      );
      if (data.full_article && onRewritten) onRewritten(data.full_article);
      flash('Article rewritten');
    } catch {
      flash('Rewrite failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 6 }}>
      {note ? (
        <span style={{ background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 12, padding: '6px 10px', borderRadius: 6, alignSelf: 'center' }}>
          {note}
        </span>
      ) : null}
      <button style={btn} onClick={regen} disabled={!!busy} title="Regenerate image (Reviewer)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.59" />
        </svg>
      </button>
      {isCurrentEvent ? (
        <button style={btn} onClick={rewrite} disabled={!!busy} title="Rewrite article (Reviewer)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      ) : null}
      {isCurrentEvent ? (
        <button style={{ ...btn, background: 'rgba(209,52,56,0.85)' }} onClick={del} disabled={!!busy} title="Delete article (Reviewer)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
